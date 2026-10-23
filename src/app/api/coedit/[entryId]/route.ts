import { requireUser } from '@/lib/auth-guard';
import { open, join, submit, touch, sessionFor, announcePeople, type ServerEvent } from '@/lib/coedit-session';
import type { Op } from '@/lib/ot';

/**
 * The live channel for one entry.
 *
 * Server-sent events rather than a WebSocket. This runs as one Node process
 * behind `next start`, where SSE needs no second server, no upgrade handling
 * and no separate port -- and the traffic is one-directional anyway: changes
 * go up as ordinary requests and come back down the stream.
 */

export const dynamic = 'force-dynamic';
/** A stream cannot be rendered on an edge runtime that does not hold it open. */
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const user = await requireUser();
  const { entryId } = await params;
  const url = new URL(_req.url);
  const client = url.searchParams.get('client') ?? '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(client)) {
    return new Response(JSON.stringify({ error: 'A stream has to say which client it is for.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await open(entryId);
  if ('error' in session) {
    return new Response(JSON.stringify({ error: session.error }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let leave: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ServerEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* The stream has gone; the cancel handler cleans up. */
        }
      };

      leave = join(session, { id: client, userId: user.id, name: user.name }, send);

      /*
       * A comment line every fifteen seconds. Proxies and browsers close an
       * idle connection, and an editor that silently stops receiving other
       * people's changes is worse than one that was never live -- it looks
       * like nobody else is typing.
       */
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          /* ditto */
        }
      }, 15_000);
      heartbeat.unref?.();
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      leave?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which holds every event
      // until the buffer fills -- so a live editor updates in bursts minutes
      // apart, or not at all.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** A change, or a heartbeat carrying where somebody's cursor is. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const user = await requireUser();
  const { entryId } = await params;

  const session = sessionFor(entryId);
  if (!session) {
    // Nobody has the entry open, which means this client's stream has died.
    return Response.json({ error: 'This editing session has ended. Reload the page.' }, { status: 409 });
  }

  let body: { base?: number; ops?: Op[]; at?: number; client?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON.' }, { status: 400 });
  }

  /*
   * The client, not the person. Two tabs belonging to one scientist are two
   * editors: they have their own text, their own outstanding changes and
   * their own cursor, and treating them as one means the second tab skips
   * the first tab's changes as its own and silently diverges.
   */
  const client = typeof body.client === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.client)
    ? body.client
    : null;
  if (!client) return Response.json({ error: 'A change has to say which client it came from.' }, { status: 400 });

  touch(session, { id: client, userId: user.id, name: user.name, at: body.at });

  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    announcePeople(session);
    return Response.json({ version: session.version });
  }

  if (typeof body.base !== 'number') {
    return Response.json({ error: 'A change has to say which version it was written against.' }, { status: 400 });
  }

  /*
   * Checked rather than trusted. These positions are applied to text other
   * people are reading, and an op with a negative length or a non-numeric
   * position is either a bug or somebody poking at the endpoint; neither
   * should reach the transform.
   */
  for (const op of body.ops) {
    const at = (op as { at?: unknown }).at;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
      return Response.json({ error: 'An operation needs a whole, non-negative position.' }, { status: 400 });
    }
    if ('insert' in op) {
      if (typeof op.insert !== 'string' || op.insert.length > 100_000) {
        return Response.json({ error: 'That insertion is not text, or is too long.' }, { status: 400 });
      }
    } else if ('remove' in op) {
      if (!Number.isInteger(op.remove) || op.remove < 0) {
        return Response.json({ error: 'A deletion needs a whole, non-negative length.' }, { status: 400 });
      }
    } else {
      return Response.json({ error: 'An operation is either an insertion or a deletion.' }, { status: 400 });
    }
  }

  const result = submit(session, { base: body.base, ops: body.ops, author: client });
  if (result.tooOld) {
    return Response.json(
      { error: 'Your copy is too far behind to merge. Reload the page.', version: result.version },
      { status: 409 },
    );
  }
  return Response.json({ version: result.version });
}
