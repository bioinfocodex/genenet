import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TOKEN_PREFIX, hashToken, sameHash } from '@/lib/api-token';

export { generateToken, hashToken } from '@/lib/api-token';

/**
 * Bearer-token authentication for the public API.
 *
 * Sessions are for people at a browser. A plate reader has no browser, so the
 * API authenticates with a token instead -- and because the audit trail records
 * who changed a record, a token has to carry an identity too. Every token
 * belongs to a person, and writes made with it are attributed to them.
 *
 * The plaintext token is never stored. A SHA-256 is kept and compared in
 * constant time, on the same reasoning as passwords: a copy of the database
 * must not be a set of working credentials. Unlike a password there is no need
 * for a slow hash here -- a token is 32 random bytes rather than something a
 * person chose, so there is nothing to guess at.
 */

export type Scope = 'read' | 'write';

export interface ApiActor {
  tokenId: string;
  tokenName: string;
  userId: string;
  userEmail: string;
  scope: Scope;
}

/**
 * The actor for the current API request.
 *
 * The audit extension resolves who made a change by reading the session, which
 * an API request does not have. Rather than thread an actor through every
 * query, the authenticated handler runs inside this store and the resolver
 * checks it first.
 */
export const apiActorStore = new AsyncLocalStorage<ApiActor>();

export function currentApiActor(): ApiActor | undefined {
  return apiActorStore.getStore();
}

export type AuthFailure = { error: string; status: number };

/** Resolve a bearer token to its actor, or say why not. */
export async function authenticateToken(header: string | null): Promise<ApiActor | AuthFailure> {
  if (!header) {
    return { error: 'Provide a token: Authorization: Bearer gn_...', status: 401 };
  }
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return { error: 'Malformed Authorization header. Expected: Bearer gn_...', status: 401 };

  const presented = m[1];
  if (!presented.startsWith(TOKEN_PREFIX)) {
    return { error: 'That is not a GeneNet token.', status: 401 };
  }

  const hash = hashToken(presented);
  // Looked up by hash, so the plaintext never has to be compared against a set.
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hash } });
  if (!row || !sameHash(row.tokenHash, hash)) {
    return { error: 'Unknown or revoked token.', status: 401 };
  }
  if (row.revokedAt) return { error: 'That token has been revoked.', status: 401 };
  if (row.expiresAt && row.expiresAt < new Date()) {
    return { error: 'That token has expired.', status: 401 };
  }

  // The owner still has to be an active member: revoking someone's account has
  // to revoke what their scripts can do, or blocking a departing colleague
  // achieves nothing.
  const owner = await prisma.user.findUnique({
    where: { id: row.ownerId },
    select: { id: true, email: true, status: true },
  });
  if (!owner || owner.status !== 'ACTIVE') {
    return { error: 'The account this token belongs to is no longer active.', status: 403 };
  }

  // Best effort: a failed timestamp update must not fail the request.
  prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => { /* not worth failing a request over */ });

  return {
    tokenId: row.id,
    tokenName: row.name,
    userId: owner.id,
    userEmail: owner.email,
    scope: row.scope === 'write' ? 'write' : 'read',
  };
}

export function isFailure(v: ApiActor | AuthFailure): v is AuthFailure {
  return (v as AuthFailure).status !== undefined;
}

type Handler = (req: Request, ctx: { actor: ApiActor; params: Record<string, string> }) => Promise<Response>;

/**
 * Wrap a route handler with authentication, scope checking and the actor store.
 *
 * Errors come back as JSON with a stable shape, because the caller is a script:
 * an HTML error page is not something a plate reader can act on.
 */
export function withApiAuth(required: Scope, handler: Handler) {
  return async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => {
    const auth = await authenticateToken(req.headers.get('authorization'));
    if (isFailure(auth)) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (required === 'write' && auth.scope !== 'write') {
      return NextResponse.json(
        { error: `This token is read-only. ${req.method} needs a token with write scope.` },
        { status: 403 },
      );
    }

    const params = ctx?.params ? await ctx.params : {};

    return apiActorStore.run(auth, async () => {
      try {
        return await handler(req, { actor: auth, params });
      } catch (e) {
        return NextResponse.json({ error: explain(e) }, { status: 400 });
      }
    });
  };
}

/**
 * Turn a thrown error into something a script's author can act on.
 *
 * Prisma's messages are multi-line renderings of the failing query and name
 * columns and models the API deliberately does not expose. Returning one to a
 * caller is both unreadable and a description of the schema.
 */
function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  const missing = raw.match(/Argument `(\w+)` is missing/);
  if (missing) return `Missing required field: ${missing[1]}.`;

  if (/Unique constraint failed/.test(raw)) {
    const field = raw.match(/fields: \((?:`)?(\w+)/)?.[1];
    return field
      ? `Something with that ${field} already exists.`
      : 'That value is already taken.';
  }
  if (/Foreign key constraint/.test(raw)) {
    return 'A referenced record does not exist. Check the ids in the body.';
  }
  if (/Record to update not found|No record was found/.test(raw)) {
    return 'Not found.';
  }
  if (/Invalid `prisma\./.test(raw)) {
    // Anything else from Prisma: say it was rejected, not how the schema looks.
    return 'The request was rejected by the database. Check the field names and types against GET /api/v1.';
  }
  return raw.split('\n')[0] || 'Unexpected error.';
}
