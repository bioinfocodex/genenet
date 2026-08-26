'use server';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMockUser } from './auth';

const DEFAULT_SECTIONS = [
  { sectionKey: 'project_info',      title: 'Project Information' },
  { sectionKey: 'gene_info',         title: 'Gene Information' },
  { sectionKey: 'gene_map',          title: 'Gene Map' },
  { sectionKey: 'plasmid_map',       title: 'Plasmid Map' },
  { sectionKey: 'expected_results',  title: 'Expected Results' },
  { sectionKey: 'obtained_results',  title: 'Obtained Results' },
  { sectionKey: 'procedures',        title: 'Procedures Used' },
  { sectionKey: 'findings',          title: 'Findings & Observations' },
  { sectionKey: 'discussion',        title: 'Discussion' },
  { sectionKey: 'conclusion',        title: 'Conclusion' },
];

// ─── Create report for a project ─────────────────────────────────────────────

export async function initReport(projectId: string): Promise<string> {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error('Project not found');

  const existing = await prisma.report.findUnique({ where: { projectId } });
  if (existing) return existing.id;

  const report = await prisma.report.create({
    data: {
      title: project.name,
      projectId,
      createdById: user.id,
      sections: { create: DEFAULT_SECTIONS.map((s, i) => ({ ...s, content: '', order: i } as any)) },
    },
  });
  return report.id;
}

export async function createReport(formData: FormData) {
  const user = await getMockUser();
  if (!user) throw new Error('Not authenticated');

  const projectId = formData.get('projectId') as string;
  if (!projectId) throw new Error('Project required');

  const reportId = await initReport(projectId);
  revalidatePath('/reports');
  redirect(`/reports/${reportId}/edit`);
}

// ─── Update a single section ──────────────────────────────────────────────────

export async function updateReportSection(formData: FormData) {
  const id      = formData.get('id') as string;
  const content = formData.get('content') as string;
  await prisma.reportSection.update({ where: { id }, data: { content } });
  const section = await prisma.reportSection.findUnique({ where: { id } });
  if (section) {
    revalidatePath(`/reports/${section.reportId}/edit`);
    revalidatePath(`/reports/${section.reportId}`);
  }
}

// ─── Update report metadata ───────────────────────────────────────────────────

export async function updateReportMeta(formData: FormData) {
  const id     = formData.get('id') as string;
  const title  = formData.get('title') as string;
  const status = formData.get('status') as string;
  const abstract = formData.get('abstract') as string | null;
  await prisma.report.update({ where: { id }, data: { title, status, abstract: abstract || null } });
  revalidatePath(`/reports/${id}/edit`);
  revalidatePath('/reports');
}

// ─── Figures ─────────────────────────────────────────────────────────────────

export async function addFigure(formData: FormData) {
  const reportId = formData.get('reportId') as string;
  const count    = await prisma.reportFigure.count({ where: { reportId } });
  await prisma.reportFigure.create({ data: { reportId, order: count } });
  revalidatePath(`/reports/${reportId}/edit`);
}

export async function updateFigure(formData: FormData) {
  const id       = formData.get('id') as string;
  const imageUrl = (formData.get('imageUrl') as string | null) || null;
  const title    = (formData.get('title') as string) || '';
  const legend   = (formData.get('legend') as string) || '';
  const fig = await prisma.reportFigure.update({ where: { id }, data: { imageUrl, title, legend } });
  revalidatePath(`/reports/${fig.reportId}/edit`);
}

export async function deleteFigure(formData: FormData) {
  const id  = formData.get('id') as string;
  const fig = await prisma.reportFigure.findUnique({ where: { id } });
  await prisma.reportFigure.delete({ where: { id } });
  if (fig) revalidatePath(`/reports/${fig.reportId}/edit`);
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export async function addTable(formData: FormData) {
  const reportId = formData.get('reportId') as string;
  const count    = await prisma.reportTable.count({ where: { reportId } });
  // default 3×4 empty grid
  const empty = JSON.stringify([['','',''],['','',''],['','',''],['','','']]);
  await prisma.reportTable.create({ data: { reportId, order: count, tableData: empty } });
  revalidatePath(`/reports/${reportId}/edit`);
}

export async function updateTable(formData: FormData) {
  const id        = formData.get('id') as string;
  const tableData = formData.get('tableData') as string;
  const title     = (formData.get('title') as string) || '';
  const legend    = (formData.get('legend') as string) || '';
  const tbl = await prisma.reportTable.update({ where: { id }, data: { tableData, title, legend } });
  revalidatePath(`/reports/${tbl.reportId}/edit`);
}

export async function deleteTable(formData: FormData) {
  const id  = formData.get('id') as string;
  const tbl = await prisma.reportTable.findUnique({ where: { id } });
  await prisma.reportTable.delete({ where: { id } });
  if (tbl) revalidatePath(`/reports/${tbl.reportId}/edit`);
}

// ─── Import task data ─────────────────────────────────────────────────────────

export async function importTask(formData: FormData) {
  const reportId = formData.get('reportId') as string;
  const taskId   = formData.get('taskId') as string;

  await prisma.reportTaskLink.upsert({
    where: { reportId_taskId: { reportId, taskId } },
    create: { reportId, taskId },
    update: {},
  });

  // Append task notes to "obtained_results" section
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { steps: true },
  });
  if (!task) return;

  const notesText = task.steps
    .filter(s => s.notes)
    .map(s => `Step ${s.stepNumber} (${s.title}): ${s.notes}`)
    .join('\n');

  if (notesText) {
    const section = await prisma.reportSection.findFirst({
      where: { reportId, sectionKey: 'obtained_results' },
    });
    if (section) {
      const updated = section.content
        ? `${section.content}\n\n--- Imported from task: ${task.title} ---\n${notesText}`
        : `--- Imported from task: ${task.title} ---\n${notesText}`;
      await prisma.reportSection.update({ where: { id: section.id }, data: { content: updated } });
    }
  }

  revalidatePath(`/reports/${reportId}/edit`);
}

export async function removeTaskLink(formData: FormData) {
  const reportId = formData.get('reportId') as string;
  const taskId   = formData.get('taskId') as string;
  await prisma.reportTaskLink.delete({ where: { reportId_taskId: { reportId, taskId } } });
  revalidatePath(`/reports/${reportId}/edit`);
}
