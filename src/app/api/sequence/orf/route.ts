import { NextRequest, NextResponse } from 'next/server';
import { findORFs } from '@/lib/simulation';
import { requireApiUser } from '@/lib/auth-guard';

function handle(seq: string, minLen: number, altStart: boolean) {
  const clean = seq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!clean) return NextResponse.json({ error: 'No valid sequence provided' }, { status: 400 });
  const orfs = findORFs(clean, minLen);
  const filtered = altStart
    ? orfs
    : orfs.filter(o => clean.substring(o.start, o.start + 3).toUpperCase() === 'ATG' || (o.strand === '-' && clean.substring(clean.length - o.end, clean.length - o.end + 3).toUpperCase() === 'ATG'));
  return NextResponse.json({ orfs: filtered, total: filtered.length });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const p = req.nextUrl.searchParams;
  return handle(
    p.get('seq') ?? '',
    parseInt(p.get('minLen') ?? '100'),
    p.get('altStart') === 'true',
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const body = await req.json().catch(() => ({}));
  return handle(body.seq ?? '', body.minLen ?? 100, body.altStart ?? false);
}
