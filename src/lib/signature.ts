import 'server-only';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * Electronic signatures.
 *
 * The audit trail (lib/audit.ts) answers "what changed and who changed it".
 * That is not the same as someone taking responsibility. A signature is a
 * deliberate act with a stated meaning: I wrote this, I reviewed it, I approve
 * it, I witnessed it done.
 *
 * Outside FDA-regulated work this is still what makes a notebook worth
 * anything in a thesis defence or a patent dispute -- "reviewed and signed by"
 * is the difference between a record and an assertion.
 */

import type { SignableModel, SignatureView } from '@/lib/signature-types';
import { MEANINGS, isMeaning } from '@/lib/signature-types';

/**
 * A digest of everything about the record that a signer is attesting to.
 *
 * Deliberately excludes timestamps and ids, which change without the content
 * changing, and includes ordered children (procedure steps, report sections)
 * because reordering steps changes what the procedure says to do.
 *
 * Field order is fixed rather than taken from object iteration, so the same
 * record always hashes the same way.
 */
export async function contentHashFor(model: SignableModel, recordId: string): Promise<string | null> {
  const parts: unknown[] = [];

  if (model === 'Procedure') {
    const p = await prisma.procedure.findUnique({
      where: { id: recordId },
      include: {
        steps:     { orderBy: { stepNumber: 'asc' } },
        materials: { orderBy: { id: 'asc' } },
        equipment: { orderBy: { id: 'asc' } },
      },
    });
    if (!p) return null;
    parts.push(p.procedureId, p.name, p.description, p.category, p.version, p.status, p.safetyNotes);
    parts.push(p.steps.map(s => [s.stepNumber, s.title, s.description]));
    parts.push(p.materials.map(m => [m.materialName, m.quantity, m.unit]));
    parts.push(p.equipment.map(e => [e.equipmentName]));
  } else if (model === 'Experiment') {
    const e = await prisma.experiment.findUnique({ where: { id: recordId } });
    if (!e) return null;
    parts.push(e.title, e.protocol, e.status, e.resultData, e.expectedParams);
  } else {
    const r = await prisma.report.findUnique({
      where: { id: recordId },
      include: {
        sections: { orderBy: { sectionKey: 'asc' } },
        figures:  { orderBy: { order: 'asc' } },
        tables:   { orderBy: { order: 'asc' } },
      },
    });
    if (!r) return null;
    parts.push(r.title, r.status, r.abstract);
    parts.push(r.sections.map(s => [s.sectionKey, s.title, s.content]));
    parts.push(r.figures.map(f => [f.order, f.title, f.legend, f.imageUrl]));
    parts.push(r.tables.map(t => [t.order, t.title, t.legend, t.tableData]));
  }

  return createHash('sha256')
    .update(JSON.stringify(parts, (_k, v) => (v === undefined ? null : v)))
    .digest('hex');
}

/** Signatures on a record, newest first, each marked current or superseded. */
export async function signaturesFor(
  model: SignableModel,
  recordId: string,
): Promise<SignatureView[]> {
  const [rows, hash] = await Promise.all([
    prisma.signature.findMany({
      where: { model, recordId },
      orderBy: { at: 'desc' },
    }),
    contentHashFor(model, recordId),
  ]);

  return rows.map(r => ({
    id: r.id,
    at: r.at,
    meaning: (isMeaning(r.meaning) ? r.meaning : 'reviewed'),
    meaningText: isMeaning(r.meaning) ? MEANINGS[r.meaning] : r.meaning,
    signerName: r.signerName,
    signerEmail: r.signerEmail,
    note: r.note,
    current: !!hash && r.contentHash === hash,
  }));
}
