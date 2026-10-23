import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/lib/session';
import { configured, discover, exchange, ssoMayCreateAccounts } from '@/lib/oidc-server';
import { decideLink, safeReturnTo } from '@/lib/oidc';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where the provider sends the browser back to.
 *
 * Anybody can call this URL with anything. Everything it believes comes from
 * one of two places: the flow cookie, which only this browser has, and an id
 * token whose signature was checked against the provider's published keys.
 */
export async function GET(req: Request) {
  const config = configured();
  if (!config) return fail('Single sign-on is not configured here.');

  const url = new URL(req.url);
  const jar = await cookies();

  const raw = jar.get('sso_flow')?.value;
  // Single use, whatever happens next. A flow cookie that survives a failed
  // attempt is a state value an attacker gets a second go at.
  jar.delete('sso_flow');

  if (!raw) return fail('That sign-in has expired. Try again.');

  let flow: { state?: string; nonce?: string; codeVerifier?: string; returnTo?: string };
  try {
    flow = JSON.parse(raw);
  } catch {
    return fail('That sign-in could not be read. Try again.');
  }

  const providerError = url.searchParams.get('error');
  if (providerError) {
    const detail = url.searchParams.get('error_description') ?? providerError;
    return fail(`The provider declined: ${detail}`);
  }

  const state = url.searchParams.get('state');
  /*
   * The state check is what stops somebody sending a colleague a callback URL
   * carrying their own code, which would quietly make the colleague's session
   * the attacker's account.
   */
  if (!state || !flow.state || state !== flow.state) {
    return fail('That sign-in did not start here. Try again from the sign-in page.');
  }

  const code = url.searchParams.get('code');
  if (!code) return fail('The provider sent no code back.');
  if (!flow.codeVerifier || !flow.nonce) return fail('That sign-in is incomplete. Try again.');

  const discovery = await discover(config);
  if ('error' in discovery) return fail(discovery.error);

  const result = await exchange(config, discovery, {
    code, codeVerifier: flow.codeVerifier, nonce: flow.nonce,
  });
  if ('error' in result) return fail(result.error);

  const { identity } = result;

  /*
   * Only the accounts that could possibly match are read: the one already
   * linked to this subject, and the one holding this address.
   */
  const candidates = await prisma.user.findMany({
    where: { OR: [{ ssoSubject: identity.subject }, { email: identity.email }] },
    select: { id: true, email: true, status: true, ssoSubject: true },
  });

  const decision = decideLink(identity, candidates, { allowCreate: ssoMayCreateAccounts() });

  let userId: string;
  let role = 'MEMBER';

  if (decision.action === 'refuse') return fail(decision.why);

  if (decision.action === 'create') {
    const created = await prisma.user.create({
      data: {
        name: identity.name,
        email: identity.email,
        ssoSubject: identity.subject,
        ssoLinkedAt: new Date(),
        // No password: this account exists only through the provider, so
        // there is nothing here to guess.
        passwordHash: null,
      },
      select: { id: true, role: true },
    });
    userId = created.id;
    role = created.role;
  } else {
    const updated = await prisma.user.update({
      where: { id: decision.userId },
      data: decision.action === 'link'
        ? { ssoSubject: identity.subject, ssoLinkedAt: new Date() }
        : {},
      select: { id: true, role: true },
    });
    userId = updated.id;
    role = updated.role;
  }

  await createSession(userId, role);
  return Response.redirect(new URL(safeReturnTo(flow.returnTo), url.origin), 302);
}

/** Back to the sign-in page, carrying something a person can act on. */
function fail(why: string): Response {
  const to = new URL('/login', process.env.SERVER_URL || 'http://localhost:3000');
  to.searchParams.set('sso_error', why);
  return Response.redirect(to, 302);
}
