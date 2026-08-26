import { prisma } from '@/lib/prisma';
import SampleRegistrationModal from '@/components/SampleRegistrationModal';
import SampleNewWrapper from './client';

export const dynamic = 'force-dynamic';

export default async function SampleNewPage() {
  const freezers = await prisma.freezer.findMany({ orderBy: { temperature: 'asc' } });
  const [tasks, projects, sequences] = await Promise.all([
    prisma.task.findMany({ select: { id: true, title: true, projectId: true }, orderBy: { title: 'asc' } }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.geneSequence.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return <SampleNewWrapper freezers={freezers} tasks={tasks} projects={projects} sequences={sequences} />;
}
