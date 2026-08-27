import { NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';
import { RESOURCES, getResource, updateResource } from '@/lib/api-resources';

function spec(name: string) {
  const s = RESOURCES[name];
  if (!s) throw new Error(`Unknown resource "${name}". Available: ${Object.keys(RESOURCES).join(', ')}.`);
  return s;
}

export const GET = withApiAuth('read', async (_req, { params }) => {
  const row = await getResource(spec(params.resource), params.id);
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json(row);
});

export const PATCH = withApiAuth('write', async (req, { params }) => {
  const body = await req.json().catch(() => { throw new Error('Body must be valid JSON.'); });
  const row = await updateResource(spec(params.resource), params.id, body);
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json(row);
});
