import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/auth-guard';
import { checkReadFile } from '@/lib/reads';
import { revalidatePath } from 'next/cache';

/**
 * POST /api/sequences/:id/reads -- attach .ab1 files to a sequence.
 *
 * A route rather than a server action because a facility's batch of traces
 * runs to megabytes, past the size a server action accepts by default. Each
 * file is checked on its own; one bad file is reported and the rest are kept.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const { id } = await params;

  const sequence = await prisma.geneSequence.findUnique({ where: { id }, select: { id: true } });
  if (!sequence) return NextResponse.json({ error: 'No such sequence.' }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Send the files as multipart form data.' }, { status: 400 });
  }

  const saved: { id: string; fileName: string; sampleName: string | null; runDate: string | null; bases: number }[] = [];
  const rejected: { fileName: string; error: string }[] = [];

  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string') continue;
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const check = checkReadFile(entry.name, bytes);
    if (!check.ok) {
      rejected.push({ fileName: entry.name, error: check.error });
      continue;
    }
    const row = await prisma.sequencingRead.create({
      data: {
        fileName: entry.name,
        sampleName: check.sampleName,
        runDate: check.runDate,
        bases: check.bases,
        data: Buffer.from(bytes),
        geneSequenceId: id,
        uploadedById: auth.user.id,
      },
      select: { id: true, fileName: true, sampleName: true, runDate: true, bases: true },
    });
    saved.push(row);
  }

  revalidatePath(`/sequences/${id}`);
  return NextResponse.json({ saved, rejected });
}
