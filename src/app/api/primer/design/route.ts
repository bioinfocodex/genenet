import { NextRequest, NextResponse } from 'next/server';
import { calcTm, calcGC, reverseComplement } from '@/lib/simulation';
import { requireApiUser } from '@/lib/auth-guard';

const RE_EXTENSIONS: Record<string, string> = {
  EcoRI: 'GAATTC',
  BamHI: 'GGATCC',
  HindIII: 'AAGCTT',
  NcoI: 'CCATGG',
  NdeI: 'CATATG',
  XhoI: 'CTCGAG',
  NotI: 'GCGGCCGC',
};

function countBindingSites(binding: string, template: string): number {
  const t = template.toUpperCase();
  const rc = reverseComplement(binding);
  let count = 0;
  let idx = t.indexOf(binding);
  while (idx !== -1) { count++; idx = t.indexOf(binding, idx + 1); }
  idx = t.indexOf(rc);
  while (idx !== -1) { count++; idx = t.indexOf(rc, idx + 1); }
  return count;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { binding, reExtension, phospho5, strand, template } = body as {
    binding?: string;
    reExtension?: string;
    phospho5?: boolean;
    strand?: string;
    template?: string;
  };

  if (!binding) return NextResponse.json({ error: 'binding sequence required' }, { status: 400 });

  const clean = binding.toUpperCase().replace(/[^ACGT]/g, '');
  const reTail = reExtension ? (RE_EXTENSIONS[reExtension] ?? '') : '';
  const fullSeq = reTail + clean;
  const tm = calcTm(clean);
  const gc = calcGC(clean);
  const rc = reverseComplement(clean);
  const hairpin = (() => {
    if (clean.length < 12) return false;
    const rcFull = reverseComplement(clean);
    for (let i = 0; i <= clean.length - 6; i++) {
      if (rcFull.includes(clean.substring(i, i + 6))) return true;
    }
    return false;
  })();
  const endWarn = clean.length >= 3 && (clean.slice(-3) === 'GGG' || clean.slice(-3) === 'CCC');
  const bindingSites = template ? countBindingSites(clean, template) : null;

  return NextResponse.json({
    bindingSeq: clean,
    reTail,
    fullSeq,
    phospho5: phospho5 ?? false,
    strand: strand ?? 'forward',
    tm,
    gc,
    length: clean.length,
    totalLength: fullSeq.length,
    reverseComplement: rc,
    hairpinRisk: hairpin,
    endWarn,
    bindingSites,
    warnings: [
      clean.length < 18 && 'Primer too short (< 18 nt)',
      clean.length > 30 && 'Primer too long (> 30 nt)',
      (gc < 40 || gc > 60) && `GC content out of range (${gc}%)`,
      endWarn && "3′ end GGG/CCC run",
      hairpin && 'Potential hairpin structure',
      bindingSites !== null && bindingSites !== 1 && `${bindingSites} binding sites on template (expect 1)`,
    ].filter(Boolean),
  });
}
