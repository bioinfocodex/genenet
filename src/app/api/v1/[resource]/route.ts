import { NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';
import { RESOURCES, listResource, createResource } from '@/lib/api-resources';

function spec(name: string) {
  const s = RESOURCES[name];
  if (!s) {
    throw new Error(
      `Unknown resource "${name}". Available: ${Object.keys(RESOURCES).join(', ')}.`,
    );
  }
  return s;
}

export const GET = withApiAuth('read', async (req, { params }) => {
  const s = spec(params.resource);
  const url = new URL(req.url);
  // A caller that asks for everything should get a page, not the whole table.
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
  const q = url.searchParams.get('q') ?? undefined;

  return NextResponse.json(await listResource(s, { limit, offset, q }));
});

export const POST = withApiAuth('write', async (req, { actor, params }) => {
  const s = spec(params.resource);
  const body = await req.json().catch(() => { throw new Error('Body must be valid JSON.'); });
  const created = await createResource(s, body, actor.userId);
  return NextResponse.json(created, { status: 201 });
});
