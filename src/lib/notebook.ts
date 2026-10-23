import { createHash } from 'crypto';
import {
  embedsHash, checkEmbeds, describeEmbedCheck,
  type EmbedState, type StoredEmbed,
} from './notebook-embeds';

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
export function contentHash(entry: SignableEntry, embeds: EmbedState[] = []): string {
  /*
   * The state of whatever the entry embeds is folded in, so a signature covers
   * the page as it was rather than only the words on it. See
   * lib/notebook-embeds.ts for why that is not optional.
   *
   * Appended only when there is something embedded, which keeps the payload
   * byte-identical to what it was before embeds were covered -- and so keeps
   * every signature made before this existed still verifying.
   */
  const embedded = embedsHash(embeds);
  const payload = [
    entry.title,
    entry.entryDate.toISOString(),
    entry.body,
    ...(embedded ? [embedded] : []),
  ].join(SEP);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Whether an entry still reads as it did when it was signed.
 *
 * Three outcomes rather than two, because "the text is untouched but the
 * construct it shows has been edited" is a different situation from "somebody
 * changed the words", and a reader deciding whether to trust an experiment
 * needs to be told which.
 */
export function verifyEntry(
  entry: SignableEntry & {
    contentHash: string | null;
    status: EntryStatus;
    /** Links with the digests taken at signing, where there are any. */
    embeds?: StoredEmbed[];
    /** The embedded records as they are now. */
    current?: EmbedState[];
  },
): { intact: boolean; reason: string; embedsChanged?: boolean } {
  if (entry.status === 'DRAFT') {
    return { intact: true, reason: 'Draft — not signed, so nothing is claimed about it.' };
  }
  if (!entry.contentHash) {
    return { intact: false, reason: 'Marked signed but carries no digest. Treat it as unverified.' };
  }

  const stored = entry.embeds ?? [];
  const current = entry.current ?? [];

  /*
   * Checked against the stored snapshots rather than against today's state,
   * so that a changed record is named rather than merely making the whole
   * digest fail with nothing to point at.
   */
  // The digest as it was signed: today's text with the snapshots taken then,
  // which is exactly what the signature was over.
  if (contentHashFromDigests(entry, stored) !== entry.contentHash) {
    return { intact: false, reason: 'Content no longer matches the digest recorded at signing.' };
  }

  const check = checkEmbeds(stored, current);
  if (!check.ok || check.unrecorded.length) {
    return {
      intact: false,
      embedsChanged: true,
      reason: describeEmbedCheck(check) ?? 'Something this entry shows has changed since it was signed.',
    };
  }

  return {
    intact: true,
    reason: stored.length
      ? 'Content and everything it shows match the digest recorded at signing.'
      : 'Content matches the digest recorded at signing.',
  };
}

/**
 * The digest an entry would have, using the snapshots stored on its links.
 *
 * Separate from `contentHash` because verification has the digests already
 * and must not recompute them from today's records -- doing that would make
 * the check always pass, which is exactly the bug this whole file exists to
 * close.
 */
function contentHashFromDigests(
  entry: SignableEntry,
  stored: StoredEmbed[],
): string {
  const withSnapshots = stored.filter(s => s.snapshot);
  const parts = withSnapshots
    .map(s => `${s.kind}:${s.targetId}:${s.snapshot}`)
    .sort();
  const embedded = parts.length
    ? createHash('sha256').update(parts.join(SEP), 'utf8').digest('hex')
    : null;
  const payload = [
    entry.title,
    entry.entryDate.toISOString(),
    entry.body,
    ...(embedded ? [embedded] : []),
  ].join(SEP);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
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
