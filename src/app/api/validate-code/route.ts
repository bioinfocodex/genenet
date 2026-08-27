import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  POLICIES, checkLimit, recordFailure, recordSuccess,
  failureDelay, describeWait, clientKey, logAttempt,
} from '@/lib/rate-limit';

/**
 * The one endpoint that has to answer before anyone is signed in: the desktop
 * app posts a connection code here to check it is pointed at the right
 * workspace.
 *
 * That makes it the last unauthenticated guessing target, and the code is five
 * digits -- 90,000 possibilities. Unmetered, a script clears the whole space in
 * minutes, so every wrong answer is counted and repeated wrong answers lock the
 * caller out for a doubling interval.
 */
export async function POST(req: NextRequest) {
  const key = clientKey(req.headers, 'connection-code');

  const gate = checkLimit(key, POLICIES.connectionCode);
  if (!gate.allowed) {
    logAttempt('connection-code', key, 'locked');
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${describeWait(gate.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)) } },
    );
  }

  try {
    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'No code provided.' }, { status: 400 });
    }

    const ws = await prisma.workspaceSettings.findUnique({ where: { id: 'workspace' } });

    if (!ws?.connectionCode || !sameCode(ws.connectionCode, code)) {
      const after = recordFailure(key, POLICIES.connectionCode);
      logAttempt('connection-code', key, after.allowed ? 'failed' : 'locked');
      await failureDelay();
      return NextResponse.json(
        {
          error: after.allowed
            ? 'Invalid connection code.'
            : `Invalid connection code. Too many attempts -- try again in ${describeWait(after.retryAfterMs)}.`,
        },
        { status: after.allowed ? 401 : 429 },
      );
    }

    recordSuccess(key);
    return NextResponse.json({ success: true, workspaceName: ws.workspaceName });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

/**
 * Constant-time comparison, so response time cannot reveal how much of a guess
 * was right. Length is checked first because timingSafeEqual throws on a
 * mismatch; that leaks only the length, which the advertised LAB-##### format
 * already gives away.
 */
function sameCode(expected: string, given: string): boolean {
  const a = Buffer.from(expected.trim().toUpperCase());
  const b = Buffer.from(given.trim().toUpperCase());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
