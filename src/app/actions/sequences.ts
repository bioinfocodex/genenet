'use server'
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { calcTm, calcGC, parseFasta, parseGenBank } from '@/lib/simulation';
import { requireUser } from '@/lib/auth-guard';
import { recordLineage } from '@/lib/lineage';
import { addParts } from '@/lib/feature-library';
import {
  parseSequenceText, countFastaRecords, type ImportedSequence,
} from '@/lib/sequence-import';
import { isSnapGene, parseSnapGene } from '@/lib/snapgene';
import { fetchAccession } from '@/lib/accession';

export async function createSequence(data: FormData) {
  const name = (data.get('name') as string).trim();
  const type = data.get('type') as string;
  const description = (data.get('description') as string | null)?.trim() || null;
  const rawSeq = data.get('sequence') as string;
  const tags = (data.get('tags') as string | null)?.trim() || null;

  // Normalize: uppercase, strip whitespace/numbers
  const sequence = rawSeq.toUpperCase().replace(/[^ACGTRYMKSWHBVDN]/g, '');

  if (sequence.length === 0) throw new Error('Sequence must contain valid nucleotides.');

  await prisma.geneSequence.create({
    data: { name, type, description, sequence, size: sequence.length, tags },
  });

  revalidatePath('/sequences');
  redirect('/sequences');
}

export async function deleteSequence(id: string) {
  await prisma.geneSequence.delete({ where: { id } });
  revalidatePath('/sequences');
}

// FormData version safe for use from client components (no .bind needed)
export async function deleteSequenceAction(formData: FormData) {
  const id = formData.get('id') as string;
  if (!id) return;
  await prisma.geneSequence.delete({ where: { id } });
  revalidatePath('/sequences');
}

export async function saveFeatures(formData: FormData) {
  const id = formData.get('id') as string;
  const featuresJson = formData.get('features') as string;
  if (!id || !featuresJson) return;
  await prisma.geneSequence.update({
    where: { id },
    data: { features: featuresJson },
  });
  revalidatePath('/sequences');
}

// ─── Import from FASTA / GenBank ──────────────────────────────────────────────

/**
 * Import a sequence from pasted text, an uploaded file, or an accession.
 *
 * The format is detected from the content rather than trusted from a dropdown:
 * someone who pastes GenBank with "FASTA" selected should still get their
 * plasmid, and someone who pastes a bare sequence with no header should get
 * that too -- which previously failed silently, because the FASTA reader
 * required a ">" line.
 */
export async function importSequence(formData: FormData) {
  // This action was the one mutation in this file with no guard. Server actions
  // are callable endpoints; it also means the audit trail can attribute the
  // import to whoever made it.
  await requireUser();

  const accession = ((formData.get('accession') as string) ?? '').trim();
  const upload = formData.get('file');
  const raw = ((formData.get('raw') as string) ?? '').trim();

  let parsed: ImportedSequence | null = null;
  let note = '';

  if (accession) {
    const r = await fetchAccession(accession);
    if (!r.ok) throw new Error(r.error);
    parsed = r.sequence;
  } else if (upload instanceof File && upload.size > 0) {
    const bytes = new Uint8Array(await upload.arrayBuffer());
    if (isSnapGene(bytes)) {
      parsed = parseSnapGene(bytes, upload.name.replace(/\.dna$/i, ''));
    } else {
      parsed = parseSequenceText(new TextDecoder().decode(bytes));
      if (parsed && parsed.name === 'Imported sequence') {
        parsed.name = upload.name.replace(/\.[^.]+$/, '');
      }
    }
    if (!parsed) throw new Error(`Could not read ${upload.name}. Supported: GenBank, FASTA, SnapGene .dna, or a plain sequence.`);
  } else if (raw) {
    const records = countFastaRecords(raw);
    parsed = parseSequenceText(raw);
    if (!parsed) throw new Error('Could not read that. Paste GenBank, FASTA, or just the sequence.');
    if (records > 1) note = ` (first of ${records} records)`;
  } else {
    throw new Error('Provide a sequence, a file, or an accession number.');
  }

  await prisma.geneSequence.create({
    data: {
      name: parsed.name + note,
      description: parsed.description || null,
      // Circularity is not a column, so it goes where the viewer already looks.
      type: parsed.circular ? 'plasmid' : (parsed.sequence.length > 3000 ? 'plasmid' : 'gene'),
      sequence: parsed.sequence,
      size: parsed.sequence.length,
      tags: null,
      features: JSON.stringify(parsed.features ?? []),
    },
  });

  revalidatePath('/sequences');
  redirect('/sequences');
}

// ─── Primer CRUD ──────────────────────────────────────────────────────────────

export async function addPrimer(formData: FormData) {
  const geneSequenceId = formData.get('geneSequenceId') as string;
  const name = (formData.get('name') as string).trim();
  const rawSeq = (formData.get('sequence') as string).trim();
  const direction = (formData.get('direction') as string) || 'forward';
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!geneSequenceId || !name || !rawSeq) return;

  const sequence = rawSeq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!sequence) return;

  const tm = calcTm(sequence);
  const gcContent = calcGC(sequence);

  await prisma.primer.create({
    data: { name, sequence, direction, tm, gcContent, notes, geneSequenceId },
  });

  revalidatePath(`/sequences/${geneSequenceId}`);
}

export async function deletePrimer(formData: FormData) {
  const id = formData.get('id') as string;
  const geneSequenceId = formData.get('geneSequenceId') as string;
  if (!id) return;
  await prisma.primer.delete({ where: { id } });
  revalidatePath(`/sequences/${geneSequenceId}`);
}

export async function updatePrimer(formData: FormData) {
  const id = formData.get('id') as string;
  const geneSequenceId = formData.get('geneSequenceId') as string;
  const name = (formData.get('name') as string).trim();
  const rawSeq = (formData.get('sequence') as string).trim();
  const direction = (formData.get('direction') as string) || 'forward';
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!id || !name || !rawSeq) return;

  const sequence = rawSeq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!sequence) return;

  const tm = calcTm(sequence);
  const gcContent = calcGC(sequence);

  await prisma.primer.update({
    where: { id },
    data: { name, sequence, direction, tm, gcContent, notes },
  });

  if (geneSequenceId) revalidatePath(`/sequences/${geneSequenceId}`);
}

// ─── Simulation Save ──────────────────────────────────────────────────────────

/**
 * Save an assembled construct as a sequence in its own right.
 *
 * The point of simulating an assembly is that the product becomes a real
 * record -- mappable, digestible, sequenceable-against -- rather than a number
 * on a results panel. The parts it came from are recorded in the description,
 * because a construct whose provenance is lost is a construct nobody trusts.
 */
export type SaveConstructResult = { error: string } | { id: string };

export async function saveConstruct(formData: FormData): Promise<SaveConstructResult> {
  const session = await requireUser();

  const name = (formData.get('name') as string | null)?.trim();
  const sequence = (formData.get('sequence') as string | null)?.toUpperCase().replace(/\s/g, '');
  const method = (formData.get('method') as string | null)?.trim() ?? 'assembly';
  const parts = (formData.get('parts') as string | null)?.trim() ?? '';
  const parentsJson = (formData.get('parents') as string | null) ?? '';
  const topology = (formData.get('topology') as string | null) ?? 'circular';

  if (!name || !sequence) return { error: 'A construct needs a name and a sequence.' };

  const built = await prisma.geneSequence.create({
    data: {
      name,
      description: `Assembled by ${method}${parts ? ` from ${parts}` : ''}.`,
      type: topology === 'circular' ? 'plasmid' : 'gene',
      sequence,
      size: sequence.length,
      features: '[]',
    },
  });

  // Descent, as edges rather than a sentence. The parents are named even when
  // their ids are not known, so a construct assembled from something that is
  // later deleted still says what it was built from.
  // Ids where the caller knows them, so the lineage links rather than only
  // naming. Falling back to names alone keeps a record of descent for callers
  // that cannot supply ids, which is better than none.
  let parents: { id?: string | null; name: string }[] = [];
  try {
    const parsed = parentsJson ? JSON.parse(parentsJson) : null;
    if (Array.isArray(parsed)) {
      parents = parsed
        .filter((p): p is { id?: string; name: string } => !!p && typeof p.name === 'string')
        .map(p => ({ id: p.id ?? null, name: p.name }));
    }
  } catch { /* fall through to names */ }
  if (parents.length === 0 && parts) {
    parents = parts.split(',').map(p => p.trim()).filter(Boolean).map(name => ({ name }));
  }
  await recordLineage(built.id, parents, method, session.id);

  revalidatePath('/sequences');
  return { id: built.id };
}

export async function saveSimulation(formData: FormData) {
  const session = await requireUser();

  const type = formData.get('type') as string;
  const name = (formData.get('name') as string | null) || '';
  const inputData = formData.get('inputData') as string;
  const outputData = formData.get('outputData') as string;
  const geneSequenceId = (formData.get('geneSequenceId') as string | null) || null;

  if (!type || !inputData || !outputData) return;

  await prisma.simulation.create({
    data: {
      type,
      name,
      inputData,
      outputData,
      createdById: session.id,
      geneSequenceId: geneSequenceId || null,
    },
  });

  if (geneSequenceId) revalidatePath(`/sequences/${geneSequenceId}`);
}

export type AddPartsResult = { added: number } | { error: string };

/**
 * Teach the library the parts a person picked out of an imported file.
 *
 * Accepting is deliberate rather than automatic: an annotation is only as good
 * as the file it came from, and a library quietly filled from every import
 * would soon recognise things that are not there.
 */
export async function addFeaturesToLibrary(formData: FormData): Promise<AddPartsResult> {
  const session = await requireUser();

  const sequenceId = (formData.get('sequenceId') as string | null) ?? null;
  const raw = (formData.get('parts') as string | null) ?? '[]';

  let parts: { name: string; type: string; color: string; sequence: string }[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { error: 'Nothing to add.' };
    parts = parsed.filter(
      (p): p is { name: string; type: string; color: string; sequence: string } =>
        !!p && typeof p.name === 'string' && typeof p.sequence === 'string' && p.sequence.length >= 10,
    );
  } catch {
    return { error: 'Could not read the selection.' };
  }
  if (parts.length === 0) return { error: 'Nothing was selected.' };

  const source = sequenceId
    ? await prisma.geneSequence.findUnique({ where: { id: sequenceId }, select: { id: true, name: true } })
    : null;

  const added = await addParts(parts, source, session.id);
  revalidatePath(`/sequences/${sequenceId ?? ''}`);
  return { added };
}
