'use server'
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMockUser } from './auth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function nextProcedureId(): Promise<string> {
  const count = await prisma.procedure.count();
  return `PROC-${String(count + 1).padStart(4, '0')}`;
}

function bumpVersion(v: string): string {
  const parts = v.replace('v', '').split('.');
  const minor = parseInt(parts[1] ?? '0') + 1;
  return `v${parts[0]}.${minor}`;
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * The shape ProcedureEditor posts, mirrored here so the nested creates below
 * are not written against `any`.
 *
 * This is a description of the contract, not a check on it: the value arrives
 * as JSON from a browser, and JSON.parse validates nothing. It is asserted
 * rather than proven, and a malformed post still throws at the point of use.
 */
interface ProcedurePayload {
  name: string;
  description?: string;
  category: string;
  status: string;
  safetyNotes?: string;
  reviewer?: string;
  contributors?: string;
  changeLog?: string;
  steps: { title: string; description: string }[];
  materials: { name: string; quantity: string; unit: string }[];
  equipment: { name: string }[];
}

export async function createProcedure(formData: FormData) {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const raw = formData.get('data') as string;
  const data = JSON.parse(raw) as ProcedurePayload;

  const procedureId = await nextProcedureId();

  const procedure = await prisma.procedure.create({
    data: {
      procedureId,
      name: data.name,
      description: data.description || null,
      category: data.category,
      status: data.status,
      safetyNotes: data.safetyNotes || null,
      reviewer: data.reviewer || null,
      contributors: data.contributors || null,
      authorId: user.id,
      steps: {
        create: data.steps.map((s, i) => ({
          stepNumber: i + 1,
          title: s.title,
          description: s.description,
        })),
      },
      materials: {
        create: data.materials.map((m) => ({
          materialName: m.name,
          quantity: m.quantity || null,
          unit: m.unit || null,
        })),
      },
      equipment: {
        create: data.equipment.map((e) => ({
          equipmentName: e.name,
        })),
      },
    },
  });

  await prisma.procedureVersion.create({
    data: {
      procedureId: procedure.id,
      versionNumber: 'v1.0',
      changeLog: 'Initial version',
      updatedById: user.id,
    },
  });

  await prisma.activity.create({
    data: { action: 'created procedure', target: data.name, userId: user.id },
  });

  revalidatePath('/procedures');
  redirect('/procedures');
}

// ─── Update (creates new version) ────────────────────────────────────────────

export async function updateProcedure(formData: FormData) {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const id = formData.get('id') as string;
  const raw = formData.get('data') as string;
  const data = JSON.parse(raw) as ProcedurePayload;

  const existing = await prisma.procedure.findUnique({ where: { id } });
  if (!existing) throw new Error('Procedure not found');

  const newVersion = bumpVersion(existing.version);

  // Replace all steps / materials / equipment
  await prisma.procedureStep.deleteMany({ where: { procedureId: id } });
  await prisma.procedureMaterial.deleteMany({ where: { procedureId: id } });
  await prisma.procedureEquipment.deleteMany({ where: { procedureId: id } });

  await prisma.procedure.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description || null,
      category: data.category,
      status: data.status,
      safetyNotes: data.safetyNotes || null,
      reviewer: data.reviewer || null,
      contributors: data.contributors || null,
      version: newVersion,
      steps: {
        create: data.steps.map((s, i) => ({
          stepNumber: i + 1,
          title: s.title,
          description: s.description,
        })),
      },
      materials: {
        create: data.materials.map((m) => ({
          materialName: m.name,
          quantity: m.quantity || null,
          unit: m.unit || null,
        })),
      },
      equipment: {
        create: data.equipment.map((e) => ({
          equipmentName: e.name,
        })),
      },
    },
  });

  await prisma.procedureVersion.create({
    data: {
      procedureId: id,
      versionNumber: newVersion,
      changeLog: data.changeLog || 'Updated',
      updatedById: user.id,
    },
  });

  revalidatePath('/procedures');
  revalidatePath(`/procedures/${id}`);
  redirect(`/procedures/${id}`);
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveProcedure(formData: FormData) {
  const id = formData.get('id') as string;
  await prisma.procedure.update({ where: { id }, data: { isArchived: true, status: 'Archived' } });
  revalidatePath('/procedures');
  redirect('/procedures');
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

export async function duplicateProcedure(formData: FormData) {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const id = formData.get('id') as string;
  const source = await prisma.procedure.findUnique({
    where: { id },
    include: { steps: true, materials: true, equipment: true },
  });
  if (!source) throw new Error('Not found');

  const procedureId = await nextProcedureId();

  await prisma.procedure.create({
    data: {
      procedureId,
      name: `${source.name} (Copy)`,
      description: source.description,
      category: source.category,
      status: 'Draft',
      safetyNotes: source.safetyNotes,
      reviewer: source.reviewer,
      contributors: source.contributors,
      authorId: user.id,
      steps: { create: source.steps.map(s => ({ stepNumber: s.stepNumber, title: s.title, description: s.description })) },
      materials: { create: source.materials.map(m => ({ materialName: m.materialName, quantity: m.quantity, unit: m.unit })) },
      equipment: { create: source.equipment.map(e => ({ equipmentName: e.equipmentName })) },
    },
  });

  revalidatePath('/procedures');
  redirect('/procedures');
}
