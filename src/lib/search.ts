import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Search across everything in the workspace.
 *
 * The header has had a search box since the beginning, with a placeholder
 * reading "Search experiments, tasks..." and no handler behind it. Meanwhile
 * the thing labs actually complain about in inventory software is not being
 * able to find a tube again: samples spread over freezers, racks and boxes that
 * get moved, tracked in spreadsheets because the tool cannot answer "where is
 * PLA-014".
 *
 * Plain LIKE queries, not FTS5. FTS5 means virtual tables and triggers to keep
 * an index in sync, and Prisma cannot describe either, so it would mean raw SQL
 * and a migration path of its own. At the scale of one lab -- thousands of
 * records, not millions -- an indexed LIKE over a dozen tables answers in
 * single-digit milliseconds. If a workspace ever outgrows that, the shape of
 * this module does not have to change: only the query inside it.
 */

export type ResultKind =
  | 'sample' | 'sequence' | 'procedure' | 'project' | 'task'
  | 'report' | 'experiment' | 'protein' | 'freezer' | 'collection' | 'primer';

export interface SearchHit {
  kind: ResultKind;
  id: string;
  /** The identifier a person would recognise: PLA-014, PROC-0007. */
  ref?: string;
  title: string;
  subtitle?: string;
  /** Where clicking it goes. */
  href: string;
  /** True when the query matched an identifier exactly -- a scanned barcode. */
  exact?: boolean;
}

export interface SearchResults {
  query: string;
  total: number;
  /** Set when exactly one identifier matched: the caller can go straight there. */
  jumpTo?: SearchHit;
  groups: { kind: ResultKind; label: string; hits: SearchHit[] }[];
}

const LABELS: Record<ResultKind, string> = {
  sample: 'Samples', sequence: 'Sequences', procedure: 'Procedures',
  project: 'Projects', task: 'Tasks', report: 'Reports',
  experiment: 'Experiments', protein: 'Proteins', freezer: 'Freezers',
  collection: 'Collections', primer: 'Primers',
};

/** Per record type, so one noisy type cannot bury the rest. */
const PER_KIND = 8;

function firstLine(s: string | null | undefined, max = 90): string | undefined {
  if (!s) return undefined;
  const line = s.split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || undefined;
}

/** Where a sample physically is, which is usually the reason for searching. */
function location(s: { freezer?: { name: string } | null; rack: string | null; box: string | null; position: string | null }): string | undefined {
  const parts = [s.freezer?.name, s.rack && `rack ${s.rack}`, s.box && `box ${s.box}`, s.position && `pos ${s.position}`]
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export async function searchWorkspace(rawQuery: string): Promise<SearchResults> {
  const q = rawQuery.trim();
  if (q.length < 2) return { query: q, total: 0, groups: [] };

  const contains = { contains: q };

  const [
    samples, sequences, procedures, projects, tasks,
    reports, experiments, proteins, freezers, collections, primers,
  ] = await Promise.all([
    prisma.sample.findMany({
      where: { OR: [{ sampleId: contains }, { name: contains }, { description: contains }, { notes: contains }, { box: contains }, { rack: contains }] },
      include: { freezer: { select: { name: true } } },
      take: PER_KIND, orderBy: { createdAt: 'desc' },
    }),
    prisma.geneSequence.findMany({
      where: { OR: [{ name: contains }, { description: contains }, { tags: contains }] },
      take: PER_KIND, orderBy: { createdAt: 'desc' },
    }),
    prisma.procedure.findMany({
      where: { OR: [{ procedureId: contains }, { name: contains }, { description: contains }, { category: contains }] },
      take: PER_KIND, orderBy: { updatedAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { OR: [{ name: contains }, { description: contains }] },
      take: PER_KIND, orderBy: { updatedAt: 'desc' },
    }),
    prisma.task.findMany({
      where: { OR: [{ title: contains }, { description: contains }, { result: contains }] },
      take: PER_KIND, orderBy: { createdAt: 'desc' },
    }),
    prisma.report.findMany({
      where: { OR: [{ title: contains }, { abstract: contains }] },
      take: PER_KIND, orderBy: { updatedAt: 'desc' },
    }),
    prisma.experiment.findMany({
      where: { OR: [{ title: contains }, { protocol: contains }, { resultData: contains }] },
      take: PER_KIND, orderBy: { createdAt: 'desc' },
    }),
    prisma.protein.findMany({
      where: { OR: [{ name: contains }, { description: contains }, { tags: contains }] },
      take: PER_KIND, orderBy: { createdAt: 'desc' },
    }),
    prisma.freezer.findMany({
      where: { OR: [{ name: contains }, { location: contains }, { notes: contains }] },
      take: PER_KIND,
    }),
    prisma.collection.findMany({
      where: { OR: [{ name: contains }, { description: contains }] },
      take: PER_KIND,
    }),
    prisma.primer.findMany({
      where: { OR: [{ name: contains }, { sequence: contains }, { notes: contains }] },
      take: PER_KIND,
    }),
  ]);

  const upper = q.toUpperCase();
  const isExact = (ref?: string | null) => !!ref && ref.toUpperCase() === upper;

  const allGroups: SearchResults['groups'] = [
    {
      kind: 'sample', label: LABELS.sample,
      hits: samples.map(s => ({
        kind: 'sample' as const, id: s.id, ref: s.sampleId, title: s.name,
        subtitle: location(s) ?? firstLine(s.description),
        href: `/samples/${s.id}`, exact: isExact(s.sampleId),
      })),
    },
    {
      kind: 'sequence', label: LABELS.sequence,
      hits: sequences.map(s => ({
        kind: 'sequence' as const, id: s.id, title: s.name,
        subtitle: firstLine(s.description) ?? s.type, href: `/sequences/${s.id}`,
      })),
    },
    {
      kind: 'procedure', label: LABELS.procedure,
      hits: procedures.map(p => ({
        kind: 'procedure' as const, id: p.id, ref: p.procedureId, title: p.name,
        subtitle: firstLine(p.description) ?? p.category,
        href: `/procedures/${p.id}`, exact: isExact(p.procedureId),
      })),
    },
    {
      kind: 'project', label: LABELS.project,
      hits: projects.map(p => ({
        kind: 'project' as const, id: p.id, title: p.name,
        subtitle: firstLine(p.description), href: `/projects/${p.id}`,
      })),
    },
    {
      kind: 'task', label: LABELS.task,
      hits: tasks.map(t => ({
        kind: 'task' as const, id: t.id, title: t.title,
        subtitle: firstLine(t.description) ?? t.status, href: `/tasks/${t.id}`,
      })),
    },
    {
      kind: 'report', label: LABELS.report,
      hits: reports.map(r => ({
        kind: 'report' as const, id: r.id, title: r.title,
        subtitle: firstLine(r.abstract) ?? r.status, href: `/reports/${r.id}`,
      })),
    },
    {
      kind: 'experiment', label: LABELS.experiment,
      hits: experiments.map(e => ({
        kind: 'experiment' as const, id: e.id, title: e.title,
        subtitle: firstLine(e.protocol) ?? e.status, href: '/experiments',
      })),
    },
    {
      kind: 'protein', label: LABELS.protein,
      hits: proteins.map(p => ({
        kind: 'protein' as const, id: p.id, title: p.name,
        subtitle: firstLine(p.description), href: `/proteins/${p.id}`,
      })),
    },
    {
      kind: 'freezer', label: LABELS.freezer,
      hits: freezers.map(f => ({
        kind: 'freezer' as const, id: f.id, title: f.name,
        subtitle: f.location ?? firstLine(f.notes), href: '/freezers',
      })),
    },
    {
      kind: 'collection', label: LABELS.collection,
      hits: collections.map(c => ({
        kind: 'collection' as const, id: c.id, title: c.name,
        subtitle: firstLine(c.description), href: '/collections',
      })),
    },
    {
      kind: 'primer', label: LABELS.primer,
      hits: primers.map(p => ({
        kind: 'primer' as const, id: p.id, title: p.name,
        subtitle: p.sequence ? `${p.sequence.slice(0, 40)}${p.sequence.length > 40 ? '…' : ''}` : firstLine(p.notes),
        href: p.geneSequenceId ? `/sequences/${p.geneSequenceId}` : '/sequences',
      })),
    },
  ];
  const groups = allGroups.filter(g => g.hits.length > 0);

  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  // A scanned barcode or a typed sample ID should not make someone read a
  // results page: if exactly one identifier matched, say so and let the caller
  // go straight there.
  const exacts = groups.flatMap(g => g.hits).filter(h => h.exact);
  const jumpTo = exacts.length === 1 ? exacts[0] : undefined;

  // Exact identifier matches sort to the top of their group.
  for (const g of groups) g.hits.sort((a, b) => Number(b.exact ?? false) - Number(a.exact ?? false));

  return { query: q, total, jumpTo, groups };
}
