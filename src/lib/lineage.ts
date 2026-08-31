import 'server-only';
import { prisma } from './prisma';

/**
 * Where a construct came from, and what came from it.
 *
 * SnapGene's most-used feature is not a calculation: it is that a plasmid file
 * remembers how it was made, so that months later somebody can walk back up the
 * chain and see which vector, which insert and which method produced the tube in
 * the freezer. GeneNet audited records and did not audit descent -- a construct
 * carried a sentence in its description and nothing you could follow.
 *
 * Descent is a graph, not a list: an assembly has several parents, and a part
 * can be used in many constructs. So it is stored as edges and walked in both
 * directions, with a depth limit, because a lab that reuses a backbone for two
 * years will otherwise produce a page nobody can read.
 */

export interface LineageEdge {
  parentId: string | null;
  parentName: string;
  method: string;
  at: Date;
}

export interface LineageNode {
  id: string | null;
  name: string;
  /** How this node's child was made from it. Absent on the starting node. */
  method?: string;
  /** Distance from the sequence being viewed. */
  depth: number;
  /**
   * True when this parent had an id and that record has since been deleted.
   * A parent recorded by name only is not missing -- it was never linked.
   */
  missing: boolean;
  /** True when the edge carries no id to follow. */
  unlinked: boolean;
  parents: LineageNode[];
}

/** Record that `childId` was made from these parents by this method. */
export async function recordLineage(
  childId: string,
  parents: { id?: string | null; name: string }[],
  method: string,
  createdById?: string | null,
): Promise<void> {
  if (parents.length === 0) return;
  await prisma.sequenceLineage.createMany({
    data: parents.map(p => ({
      childId,
      parentId: p.id ?? null,
      parentName: p.name,
      method,
      createdById: createdById ?? null,
    })),
  });
}

/**
 * Walk upwards from a sequence.
 *
 * Depth-limited and cycle-guarded. A cycle should not happen -- a construct
 * cannot be its own ancestor -- but a mis-recorded edge would otherwise loop
 * until the process gave out, and refusing to render is worse than showing the
 * part that makes sense.
 */
export async function ancestryOf(id: string, maxDepth = 6): Promise<LineageNode> {
  const root = await prisma.geneSequence.findUnique({ where: { id }, select: { id: true, name: true } });
  const node: LineageNode = {
    id, name: root?.name ?? '(deleted)', depth: 0, missing: !root, unlinked: false, parents: [],
  };
  const seen = new Set<string>([id]);

  const walk = async (current: LineageNode) => {
    if (current.depth >= maxDepth || !current.id) return;
    const edges = await prisma.sequenceLineage.findMany({
      where: { childId: current.id },
      orderBy: { createdAt: 'asc' },
    });
    for (const e of edges) {
      const exists = e.parentId
        ? await prisma.geneSequence.findUnique({ where: { id: e.parentId }, select: { id: true } })
        : null;
      const child: LineageNode = {
        id: e.parentId,
        name: e.parentName,
        method: e.method,
        depth: current.depth + 1,
        missing: Boolean(e.parentId) && !exists,
        unlinked: !e.parentId,
        parents: [],
      };
      current.parents.push(child);
      if (e.parentId && !seen.has(e.parentId)) {
        seen.add(e.parentId);
        await walk(child);
      }
    }
  };

  await walk(node);
  return node;
}

/** Constructs that were made from this sequence. */
export async function descendantsOf(id: string): Promise<{ id: string; name: string; method: string; at: Date }[]> {
  const edges = await prisma.sequenceLineage.findMany({
    where: { parentId: id },
    orderBy: { createdAt: 'desc' },
    include: { child: { select: { id: true, name: true } } },
  });
  return edges.map(e => ({
    id: e.child.id,
    name: e.child.name,
    method: e.method,
    at: e.createdAt,
  }));
}

/** Flatten the tree for rendering, depth-first, parents under their child. */
export function flatten(node: LineageNode): LineageNode[] {
  const out: LineageNode[] = [node];
  for (const p of node.parents) out.push(...flatten(p));
  return out;
}
