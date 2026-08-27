import 'server-only';
import { parseGenBankFile, parseFastaFile, type ImportedSequence } from '@/lib/sequence-import';

/**
 * Fetching a sequence by accession.
 *
 * Typing GFP into a search box and getting the sequence is the difference
 * between a tool someone tries and a tool someone uses. NCBI and UniProt both
 * publish plain HTTP endpoints for this and neither needs a key.
 *
 * Runs on the server, not in the browser: a lab install may sit on a network
 * with no route out, and a failed fetch should be one clear message rather than
 * a CORS error in a console nobody has open. It also keeps the outbound request
 * from the lab's server rather than from each scientist's machine.
 */

const NCBI = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
const UNIPROT = 'https://rest.uniprot.org/uniprotkb';

/** NCBI asks callers to identify themselves. */
const UA = 'GeneNet/1.0 (lab notebook; +https://bioinfocodex.com)';

const TIMEOUT_MS = 20_000;

export type AccessionSource = 'ncbi-nucleotide' | 'ncbi-protein' | 'uniprot';

export interface AccessionResult {
  ok: true;
  source: AccessionSource;
  sequence: ImportedSequence;
}
export interface AccessionFailure {
  ok: false;
  error: string;
}

/**
 * Which database an identifier belongs to, from its shape.
 *
 * Deliberately conservative: an unrecognised shape is tried against NCBI
 * nucleotide rather than refused, because NCBI accession formats are numerous
 * and a wrong guess costs one failed request.
 */
export function guessSource(raw: string): AccessionSource {
  const id = raw.trim().toUpperCase();

  // RefSeq accessions are two letters, an underscore and digits. They must be
  // matched before the UniProt entry-name rule below, which also contains an
  // underscore -- otherwise NM_000546 is sent to UniProt, which has never heard
  // of it.
  if (/^(NP|XP|YP|WP|AP)_\d/.test(id)) return 'ncbi-protein';
  if (/^(NM|NR|XM|XR|NC|NG|NT|NW|NZ|AC)_\d/.test(id)) return 'ncbi-nucleotide';

  // UniProt accessions: P12345, Q8N158, A0A022YWF9.
  if (/^[OPQ][0-9][A-Z0-9]{3}[0-9]$/.test(id)) return 'uniprot';
  if (/^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(id)) return 'uniprot';
  // UniProt entry names are NAME_SPECIES; both halves contain letters, which is
  // what separates GFP_AEQVI from an accession like NM_000546.
  if (/^[A-Z0-9]+_[A-Z0-9]*[A-Z][A-Z0-9]*$/.test(id)) return 'uniprot';

  return 'ncbi-nucleotide';
}

function looksLikeAccession(raw: string): boolean {
  return /^[A-Za-z0-9_.]{4,20}$/.test(raw.trim());
}

async function get(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain' },
      signal: controller.signal,
      cache: 'no-store',
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAccession(rawId: string): Promise<AccessionResult | AccessionFailure> {
  const id = rawId.trim();
  if (!id) return { ok: false, error: 'Enter an accession number.' };
  if (!looksLikeAccession(id)) {
    return { ok: false, error: 'That does not look like an accession. Try something like NM_000546, P42212 or CP000819.1.' };
  }

  const source = guessSource(id);

  try {
    if (source === 'uniprot') {
      const { ok, status, body } = await get(`${UNIPROT}/${encodeURIComponent(id)}.fasta`);
      if (!ok) {
        return { ok: false, error: status === 404
          ? `UniProt has no entry ${id}.`
          : `UniProt returned ${status} for ${id}.` };
      }
      const parsed = parseFastaFile(body);
      if (!parsed) return { ok: false, error: `UniProt returned nothing usable for ${id}.` };
      // UniProt FASTA headers are sp|P42212|GFP_AEQVI Green fluorescent protein…
      const header = body.split('\n')[0] ?? '';
      const m = header.match(/^>(?:sp|tr)\|([^|]+)\|(\S+)\s*(.*)$/);
      if (m) {
        parsed.name = m[2];
        parsed.description = (m[3] || '').replace(/\s+(OS|OX|GN|PE|SV)=.*$/, '').trim();
      }
      return { ok: true, source, sequence: parsed };
    }

    // NCBI: GenBank flat file for nucleotides so the features come with it;
    // FASTA for proteins, which have none.
    const db = source === 'ncbi-protein' ? 'protein' : 'nuccore';
    const rettype = source === 'ncbi-protein' ? 'fasta' : 'gbwithparts';
    const url = `${NCBI}?db=${db}&id=${encodeURIComponent(id)}&rettype=${rettype}&retmode=text`;
    const { ok, status, body } = await get(url);

    if (!ok) return { ok: false, error: `NCBI returned ${status} for ${id}.` };
    // eutils answers 200 with an error document for an unknown id.
    if (/<ERROR>|Failed to (?:retrieve|understand)|cannot get document summary/i.test(body.slice(0, 600))) {
      return { ok: false, error: `NCBI has no record ${id}.` };
    }

    const parsed = rettype === 'fasta' ? parseFastaFile(body) : parseGenBankFile(body);
    if (!parsed) return { ok: false, error: `Could not read what NCBI returned for ${id}.` };
    return { ok: true, source, sequence: parsed };
  } catch (e) {
    const who = source === 'uniprot' ? 'UniProt' : 'NCBI';
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: `${who} did not respond within 20 seconds.` };
    }
    // A certificate failure and an absent network need different fixes, and
    // "could not reach it" sends someone looking at the wrong one. Node ships
    // its own CA bundle rather than using the operating system's, so a host
    // whose roots are fine for curl and every browser can still fail here.
    const cause = (e as { cause?: { code?: string } })?.cause?.code ?? '';
    if (/CERT|SSL|TLS|SELF_SIGNED/i.test(cause)) {
      return {
        ok: false,
        error: `Could not verify ${who}'s certificate (${cause}). This is the server's certificate store, not the network. ` +
               'Point NODE_EXTRA_CA_CERTS at your system roots, or start the server with --use-system-ca. ' +
               'Pasting or uploading the sequence works meanwhile.',
      };
    }
    return {
      ok: false,
      error: `Could not reach ${who}. This install may have no route to the internet; you can still paste or upload the sequence.`,
    };
  }
}
