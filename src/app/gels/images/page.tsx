import { prisma } from '@/lib/prisma';
import { ImageIcon } from 'lucide-react';
import GelImportPanel from '@/components/GelImportPanel';

export const dynamic = 'force-dynamic';

export default async function GelImagesPage() {
  const [images, tasks] = await Promise.all([
    prisma.gelImage.findMany({
      orderBy: { capturedAt: 'desc' },
      include: { task: { select: { id: true, title: true } } },
    }),
    prisma.task.findMany({
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ImageIcon size={28} /> Gel Images
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
          Import and manage gel documentation images. Attach images to tasks for structured experiment records.
        </p>
      </div>
      <GelImportPanel images={images as any} tasks={tasks} />
    </div>
  );
}
