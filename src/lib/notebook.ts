import { createHash } from 'crypto';

/**
 * Notebook entries, and what signing one means.
 *
 * Procedures describe intent and are versioned. A notebook entry records what
 * actually happened, is dated to the day of the work rather than the day of
 * typing, and gets signed.
 *
 * The rule that makes a signature mean anything: once signed, the entry stops
 * being editable. A signature over content that can still change is not a
 * signature, it is a timestamp. A correction after signing is made as a new
 * entry that supersedes the old one and both stay readable — which is exactly
 * what a paper notebook enforces by being bound, and why crossing out is the
 * accepted correction there rather than erasing.
 *
 * This is deliberately not a claim of 21 CFR Part 11 compliance. Part 11 is a
 * property of a validated system and its operating procedures, not of a hashing
 * function. What is here is the record-keeping half: content-addressed
 * signatures, an append-only correction path, and an audit trail underneath.
 */

export type EntryStatus = 'DRAFT' | 'SIGNED' | 'WITNESSED';

export interface SignableEntry {
  title: string;
  body: string;
  entryDate: Date;
}

/** Cannot occur in a title, a date or a body typed by a person. */
const SEP = '\u0000';

/**
 * The digest a signature covers.
 *
 * Fields are joined with a separator that cannot occur inside them, so that
 * moving text from the end of the title to the start of the body cannot produce
 * the same hash. Concatenating them directly is the classic way to make two
 * different records hash alike.
 */
export function contentHash(entry: SignableEntry): string {
  const payload = [
    entry.title,
    entry.entryDate.toISOString(),
    entry.body,
  ].join(SEP);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Whether an entry still reads as it did when it was signed. */
export function verifyEntry(
  entry: SignableEntry & { contentHash: string | null; status: EntryStatus },
): { intact: boolean; reason: string } {
  if (entry.status === 'DRAFT') {
    return { intact: true, reason: 'Draft — not signed, so nothing is claimed about it.' };
  }
  if (!entry.contentHash) {
    return { intact: false, reason: 'Marked signed but carries no digest. Treat it as unverified.' };
  }
  const now = contentHash(entry);
  return now === entry.contentHash
    ? { intact: true, reason: 'Content matches the digest recorded at signing.' }
    : { intact: false, reason: 'Content no longer matches the digest recorded at signing.' };
}

export interface EditCheck {
  allowed: boolean;
  reason: string;
}

/**
 * Whether this person may edit this entry.
 *
 * Three separate reasons to refuse, kept separate because they call for
 * different responses: sign it again is not the answer to "this is not yours",
 * and "make a superseding entry" is not the answer to "you are not the author".
 */
export function canEdit(
  entry: { status: EntryStatus; authorId: string },
  userId: string,
  role: string,
): EditCheck {
  if (entry.status !== 'DRAFT') {
    return {
      allowed: false,
      reason: 'This entry is signed. Corrections are made as a new entry that supersedes it, so that both remain readable.',
    };
  }
  if (entry.authorId !== userId && role !== 'ADMIN') {
    return { allowed: false, reason: 'Only the author can edit a draft entry.' };
  }
  return { allowed: true, reason: '' };
}

/**
 * Whether this person may witness this entry.
 *
 * A witness signature exists to say a second person saw the work. The author
 * signing as their own witness is the one case that empties it of meaning, so
 * it is refused rather than merely discouraged.
 */
export function canWitness(
  entry: { status: EntryStatus; authorId: string; signedById: string | null },
  userId: string,
): EditCheck {
  if (entry.status === 'DRAFT') {
    return { allowed: false, reason: 'The author has not signed this entry yet.' };
  }
  if (entry.status === 'WITNESSED') {
    return { allowed: false, reason: 'This entry has already been witnessed.' };
  }
  if (entry.authorId === userId || entry.signedById === userId) {
    return { allowed: false, reason: 'A witness has to be someone other than the person who signed it.' };
  }
  return { allowed: true, reason: '' };
}

export const LINK_KINDS = [
  'sequence', 'sample', 'plate', 'result', 'task', 'entity', 'procedure', 'gel',
] as const;

export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_PATHS: Record<LinkKind, string> = {
  sequence: '/sequences',
  sample: '/samples',
  plate: '/plates',
  result: '/results',
  task: '/tasks',
  entity: '/entities/record',
  procedure: '/procedures',
  gel: '/gels',
};

export function linkHref(kind: string, targetId: string): string | null {
  const base = LINK_PATHS[kind as LinkKind];
  return base ? `${base}/${targetId}` : null;
}

/**
 * Pull out what an entry mentions, so the links write themselves.
 *
 * Matches [[kind:id|label]] in the body. Authors will not maintain a separate
 * list of attachments — they will write prose and expect the references in it
 * to be live, and a notebook whose links are stale is a notebook whose links
 * nobody trusts.
 */
export function extractLinks(body: string): { kind: string; targetId: string; label: string }[] {
  const out: { kind: string; targetId: string; label: string }[] = [];
  const re = /\[\[([a-z]+):([A-Za-z0-9_-]+)(?:\|([^\]]*))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!LINK_KINDS.includes(m[1] as LinkKind)) continue;
    out.push({ kind: m[1], targetId: m[2], label: (m[3] ?? m[2]).trim() || m[2] });
  }
  // The same record mentioned twice is one link.
  const seen = new Set<string>();
  return out.filter(l => {
    const k = `${l.kind}:${l.targetId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A short, safe summary for a list view. */
export function excerpt(body: string, chars = 180): string {
  const plain = body
    .replace(/\[\[[a-z]+:[A-Za-z0-9_-]+(?:\|([^\]]*))?\]\]/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= chars ? plain : `${plain.slice(0, chars - 1)}…`;
}
