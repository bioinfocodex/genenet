import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guard';
import { sendDue } from '@/lib/webhook-sender';
import { EVENTS, EVENT_LABELS, examplePayload } from '@/lib/webhooks';
import WebhooksClient from './client';

export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  await requireAdmin();

  /*
   * Anything owed is sent when somebody looks at this page. This deployment
   * has no background worker, and in a lab with people in it an admin opening
   * the page is a more reliable clock than nothing at all.
   */
  await sendDue();

  const hooks = await prisma.webhook.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      deliveries: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, event: true, state: true, status: true, note: true, attempts: true, createdAt: true, nextAt: true },
      },
    },
  });

  return (
    <WebhooksClient
      hooks={hooks.map(h => ({
        id: h.id,
        name: h.name,
        url: h.url,
        events: h.events.split(',').map(e => e.trim()).filter(Boolean),
        active: h.active,
        deliveries: h.deliveries.map(d => ({
          id: d.id, event: d.event, state: d.state, status: d.status,
          note: d.note, attempts: d.attempts,
          createdAt: d.createdAt.toISOString(),
          nextAt: d.nextAt?.toISOString() ?? null,
        })),
      }))}
      events={EVENTS.map(e => ({ id: e, label: EVENT_LABELS[e] }))}
      example={JSON.stringify(examplePayload('sample.used'), null, 2)}
    />
  );
}
