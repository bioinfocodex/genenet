import { NextRequest, NextResponse } from 'next/server';

const ESMFOLD_URL = 'https://esmatlas.com/resources?action=fold';

/**
 * POST /api/protein/fold
 * Body: { sequence: string }   — single-letter AA sequence (max ~400 aa for ESMFold)
 * Returns: { pdb: string } on success, { error: string } on failure.
 *
 * Proxies to the ESMAtlas ESMFold endpoint so the browser avoids CORS.
 */
export async function POST(req: NextRequest) {
  let seq = '';
  try {
    const body = await req.json();
    seq = (body.sequence ?? '').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!seq) return NextResponse.json({ error: 'No valid amino acid sequence provided' }, { status: 400 });
  if (seq.length > 400) return NextResponse.json({ error: 'Sequence too long — ESMFold accepts up to ~400 aa' }, { status: 400 });

  try {
    const resp = await fetch(ESMFOLD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: seq,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return NextResponse.json(
        { error: `ESMFold returned ${resp.status}: ${text.substring(0, 200)}` },
        { status: 502 },
      );
    }

    const pdb = await resp.text();
    return NextResponse.json({ pdb, length: seq.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach ESMFold: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
