import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/auth-guard';
import { normaliseFeatures } from '@/lib/features';
import { writeSnapGene, snapGeneFilename } from '@/lib/formats/snapgene-write';
import type { ImportedFeature } from '@/lib/sequence-import';

/**
 * Handing a sequence to someone who has not switched.
 *
 * Reading .dna removed the friction of receiving a map. This removes the other
 * half: a collaborator on SnapGene gets a file that opens, with the features
 * and their strands intact, and never has to know what wrote it.
 *
 * The coordinate conversion is the whole risk. Stored features are 1-based
 * inclusive with strand as 1/-1 (the viewer's shape); the writer takes 0-based
 * inclusive with '+'/'-'. Getting the shift wrong at one end only would move
 * every feature by a base, which is exactly the kind of error that survives a
 * glance at the map.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;

  const { id } = await params;
  const record = await prisma.geneSequence.findUnique({
    where: { id },
    select: { name: true, description: true, sequence: true, type: true, features: true },
  });
  if (!record) {
    return NextResponse.json({ error: 'No such sequence.' }, { status: 404 });
  }

  const features: ImportedFeature[] = normaliseFeatures(record.features).map(f => ({
    name: f.name,
    type: f.type,
    // 1-based inclusive in store, 0-based inclusive in the writer. Both ends.
    start: f.start - 1,
    end: f.end - 1,
    strand: f.strand === -1 ? '-' : '+',
    ...(f.segments?.length
      ? { segments: f.segments.map(s => ({ start: s.start - 1, end: s.end - 1 })) }
      : {}),
    ...(f.color ? { color: f.color } : {}),
  }));

  let bytes: Uint8Array;
  try {
    bytes = writeSnapGene({
      name: record.name,
      description: record.description ?? '',
      sequence: record.sequence,
      circular: record.type === 'plasmid',
      features,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not build the file.' },
      { status: 400 },
    );
  }

  const filename = snapGeneFilename(record.name);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/octet-stream',
      // The filename is already restricted to safe characters by
      // snapGeneFilename, so it needs no further quoting games here.
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
    },
  });
}
