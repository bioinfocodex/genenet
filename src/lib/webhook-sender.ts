import 'server-only';
import { prisma } from './prisma';
import {
  sign, outcomeOf, isEvent, problemWithUrl, MAX_ATTEMPTS,
  type Delivery, type EventName,
} from './webhooks';

/**
 * Sending the things that happen here to whoever asked to be told.
 *
 * Queued rather than awaited at the point something happens. Signing a
 * notebook entry must not take as long as the slowest endpoint somebody has
 * configured, and an endpoint that is down must not make signing fail -- the
 * entry is the lab's record and the webhook is a courtesy to another system.
 */

const TIMEOUT_MS = 10_000;

/**
 * Whether an endpoint inside this machine or network may be used.
 *
 * Off unless the deployment says otherwise. Somebody writing an integration
 * needs to point a webhook at a script on their own laptop, and refusing that
 * outright pushes them to test against a public endpoint instead -- which is
 * the lab's data going somewhere worse than localhost. So it is an explicit
 * setting rather than a default, and it is read here rather than stored on
 * the webhook, so turning it off closes every existing one at once.
 */
const allowLocal = () => process.env.WEBHOOK_ALLOW_LOCAL === '1';

/** Record that something happened, for every webhook that asked about it. */
export async function emit(
  event: EventName,
  subject: { kind: string; id: string; label: string },
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({ where: { active: true } });
    const wanted = hooks.filter(h => h.events.split(',').map(e => e.trim()).includes(event));
    if (wanted.length === 0) return;

    for (const hook of wanted) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event,
          payload: JSON.stringify(bodyFor(event, subject, data, '')),
          nextAt: new Date(),
        },
        select: { id: true },
      });
      // The id goes inside the payload, so a receiver can tell a retry from a
      // second event. Written after the row exists, because that is when the
      // id exists.
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { payload: JSON.stringify(bodyFor(event, subject, data, delivery.id)) },
      });
      void attempt(delivery.id);
    }
  } catch {
    /*
     * An event that cannot be queued is not allowed to fail the thing that
     * caused it. Somebody signing an entry should not see an error because a
     * webhook table is locked.
     */
  }
}

function bodyFor(
  event: EventName,
  subject: { kind: string; id: string; label: string },
  data: Record<string, unknown>,
  id: string,
): Delivery {
  return { id, event, at: new Date().toISOString(), subject, data };
}

/**
 * Try one delivery, and schedule the next attempt where there should be one.
 *
 * Deliberately not a loop: each attempt updates the row and stops. What drives
 * the next one is `due()`, called from the admin page and from any later
 * emit, so a delivery resumes without a background worker this deployment
 * does not have.
 */
export async function attempt(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery || delivery.state !== 'pending') return;
  if (!isEvent(delivery.event)) return;

  const attemptNo = delivery.attempts + 1;
  const signature = sign(delivery.payload, delivery.webhook.secret);

  let response: { status: number } | { error: string };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Checked again at the moment of sending, not only when it was saved: a
    // name that resolved to a public address last week can resolve inside the
    // network today.
    const problem = problemWithUrl(delivery.webhook.url, { allowLocal: allowLocal() });
    if (problem) throw new Error(problem);

    const res = await fetch(delivery.webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GeneNet-Webhook/1.0',
        'X-GeneNet-Event': delivery.event,
        'X-GeneNet-Delivery': delivery.id,
        'X-GeneNet-Signature': signature,
      },
      body: delivery.payload,
      signal: controller.signal,
      redirect: 'manual',
    });
    response = { status: res.status };
  } catch (e) {
    response = { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }

  const outcome = outcomeOf(response, attemptNo, delivery.id);

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts: attemptNo,
      status: 'status' in outcome ? outcome.status ?? null : null,
      state: outcome.kind === 'delivered' ? 'delivered' : outcome.kind === 'failed' ? 'failed' : 'pending',
      note: outcome.kind === 'delivered' ? null : (outcome as { why: string }).why,
      nextAt: outcome.kind === 'retry' ? new Date(Date.now() + outcome.inMs) : null,
    },
  });
}

/**
 * Send anything that is due.
 *
 * Called when somebody looks at the webhooks page and whenever a new event is
 * emitted, which in a lab with people in it is often enough. A deployment that
 * wants a timer can call this from one.
 */
export async function sendDue(limit = 25): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { state: 'pending', nextAt: { lte: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { nextAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const d of due) await attempt(d.id);
  return due.length;
}
