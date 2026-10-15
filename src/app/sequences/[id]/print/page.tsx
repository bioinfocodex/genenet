import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth-guard';
import { normaliseFeatures } from '@/lib/features';
import { findHost, findStrain } from '@/lib/hosts';
import PrintClient from './client';

export const dynamic = 'force-dynamic';

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const [seq, settings] = await Promise.all([
    prisma.geneSequence.findUnique({ where: { id } }),
    prisma.workspaceSettings.findFirst({ select: { workspaceName: true } }),
  ]);
  if (!seq) notFound();

  return (
    <PrintClient
      workspace={settings?.workspaceName ?? 'GeneNet'}
      seq={{
        id: seq.id,
        name: seq.name,
        type: seq.type,
        sequence: seq.sequence,
        description: seq.description,
        features: normaliseFeatures(seq.features),
        host: findHost(seq.host)?.organism.name ?? null,
        strain: findStrain(seq.strain)?.strain.name ?? null,
      }}
    />
  );
}
