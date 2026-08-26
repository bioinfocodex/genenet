import { NextRequest, NextResponse } from 'next/server';
import { calcTm, calcGC } from '@/lib/simulation';

function handle(seq: string) {
  const clean = seq.toUpperCase().replace(/[^ACGT]/g, '');
  if (!clean) return NextResponse.json({ error: 'No valid sequence provided' }, { status: 400 });
  return NextResponse.json({
    tm: calcTm(clean),
    gc: calcGC(clean),
    length: clean.length,
  });
}

export async function GET(req: NextRequest) {
  const seq = req.nextUrl.searchParams.get('seq') ?? '';
  return handle(seq);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(body.seq ?? '');
}
