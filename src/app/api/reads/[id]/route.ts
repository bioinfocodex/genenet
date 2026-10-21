import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiUser } from '@/lib/auth-guard';

/** GET /api/reads/:id -- the stored .ab1 file, for drawing its trace. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const { id } = await params;

  const read = await prisma.sequencingRead.findUnique({ where: { id }, select: { data: true, fileName: true } });
  if (!read) return NextResponse.json({ error: 'No such read.' }, { status: 404 });

  return new NextResponse(new Uint8Array(read.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${read.fileName.replace(/["\\\r\n]/g, '_')}"`,
      // The bytes of a stored read never change; a new upload is a new id.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
