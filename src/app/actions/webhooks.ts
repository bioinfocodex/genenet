'use server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth-guard';
import { isEvent, problemWithUrl, sign, EVENTS } from '@/lib/webhooks';
import { sendDue, attempt } from '@/lib/webhook-sender';

/**
 * Configuring where events go.
 *
 * Admin only, because an endpoint is two things at once: an outbound
 * connection from this server, and a copy of the lab's data going somewhere
 * nobody else can see.
 */

export async function createWebhook(fd: FormData) {
  await requireAdmin();
  const name = String(fd.get('name') ?? '').trim();
  const url = String(fd.get('url') ?? '').trim();
  const events = String(fd.get('events') ?? '').split(',').map(e => e.trim()).filter(Boolean);

  if (!name) return { error: 'Give it a name, so the list means something later.' };
  const problem = problemWithUrl(url, { allowLocal: process.env.WEBHOOK_ALLOW_LOCAL === '1' });
  if (problem) return { error: problem };
  if (events.length === 0) return { error: 'Choose at least one event, or it will never fire.' };
  const unknown = events.filter(e => !isEvent(e));
  if (unknown.length) return { error: `This does not send ${unknown.join(', ')}.` };

  /*
   * Shown once, now, and never again -- the same way every other secret here
   * is handled. A receiver that loses it gets a new one; a list that keeps
   * showing it is a list that leaks it.
   */
  const secret = `whsec_${randomBytes(24).toString('hex')}`;

  const created = await prisma.webhook.create({
    data: { name, url, events: events.join(','), secret },
    select: { id: true },
  });

  revalidatePath('/webhooks');
  return { ok: true as const, id: created.id, secret };
}

export async function setWebhookActive(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get('id') ?? '');
  const active = String(fd.get('active') ?? '') === 'true';
  if (!id) return { error: 'No webhook.' };
  await prisma.webhook.update({ where: { id }, data: { active } });
  revalidatePath('/webhooks');
  return { ok: true as const };
}

export async function deleteWebhook(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get('id') ?? '');
  if (!id) return { error: 'No webhook.' };
  await prisma.webhook.delete({ where: { id } });
  revalidatePath('/webhooks');
  return { ok: true as const };
}

/**
 * Send a test delivery, and say exactly what the endpoint did with it.
 *
 * The useful half of a webhook page. Configuring one and finding out a week
 * later that it has never worked is the normal failure, and it happens
 * because nothing ever tried it while somebody was watching.
 */
export async function testWebhook(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get('id') ?? '');
  const hook = await prisma.webhook.findUnique({ where: { id } });
  if (!hook) return { error: 'That webhook is gone.' };

  const event = hook.events.split(',')[0]?.trim();
  if (!event || !isEvent(event)) return { error: 'It is not listening for anything this sends.' };

  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: hook.id,
      event,
      payload: '{}',
      nextAt: new Date(),
    },
    select: { id: true },
  });

  const payload = JSON.stringify({
    id: delivery.id,
    event,
    at: new Date().toISOString(),
    subject: { kind: 'test', id: delivery.id, label: 'Test delivery' },
    data: { note: 'Sent from the webhooks page to check this endpoint answers.' },
  });
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { payload } });

  await attempt(delivery.id);

  const after = await prisma.webhookDelivery.findUnique({
    where: { id: delivery.id },
    select: { state: true, status: true, note: true, attempts: true },
  });

  revalidatePath('/webhooks');
  return { ok: true as const, result: after };
}

/** Send anything still owed, which is what keeps retries moving. */
export async function flushWebhooks() {
  await requireAdmin();
  const sent = await sendDue();
  revalidatePath('/webhooks');
  return { ok: true as const, sent };
}

/** The signature a receiver should expect, for the page that explains it. */
export async function exampleSignature(body: string, secret: string) {
  await requireAdmin();
  return sign(body, secret);
}

export async function knownEvents() {
  await requireAdmin();
  return [...EVENTS];
}
