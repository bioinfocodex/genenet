import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import ProcedureEditor from '@/components/ProcedureEditor';

export const dynamic = 'force-dynamic';

export default async function EditProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const procedure = await prisma.procedure.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { stepNumber: 'asc' } },
      materials: true,
      equipment: true,
    },
  });

  if (!procedure) notFound();

  const initial = {
    id: procedure.id,
    name: procedure.name,
    description: procedure.description ?? '',
    category: procedure.category,
    status: procedure.status,
    safetyNotes: procedure.safetyNotes ?? '',
    reviewer: procedure.reviewer ?? '',
    contributors: procedure.contributors ?? '',
    steps: procedure.steps.map(s => ({ title: s.title, description: s.description })),
    materials: procedure.materials.map(m => ({ name: m.materialName, quantity: m.quantity ?? '', unit: m.unit ?? '' })),
    equipment: procedure.equipment.map(e => e.equipmentName),
  };

  return (
    <div>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>Edit Procedure</h1>
      <ProcedureEditor initial={initial} cancelHref={`/procedures/${procedure.id}`} />
    </div>
  );
}
