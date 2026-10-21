import { createHash } from 'crypto';

/**
 * What a signature covers when the page shows live records.
 *
 * An entry here can mention a construct, a sample or a plate, and the page
 * draws the current state of each: a map, a well grid, a set of values. That
 * is the useful behaviour -- a notebook whose links are stale is a notebook
 * whose links nobody follows.
 *
 * It is also a hole in the signature. The digest a signature covers is over
 * the title, the date and the body text. Edit the construct tomorrow and the
 * body is untouched, so the entry still verifies as intact -- while the page
 * it renders now shows a different sequence from the one that was signed. The
 * signature says nothing about the thing the reader is actually looking at.
 *
 * So the state of each embedded record is captured at the moment of signing
 * and folded into the digest. Afterwards an entry can say three different
 * things, which are three different situations and should not be one:
 *
 *   the text and everything it shows are as signed;
 *   the text is as signed, but a record it shows has changed since;
 *   the text itself has been altered.
 */

/** A cursor that cannot occur in any of the parts it separates. */
const SEP = '\u0000';

export interface EmbedState {
  kind: string;
  targetId: string;
  /**
   * The fields of the target that matter, rendered canonically.
   *
   * Built by the caller, because what matters differs by kind: a construct is
   * its bases and its features, a sample is how much is left and where it is.
   * What must not differ is how two equal states are written, so this is
   * always produced by the same code on both sides of a comparison.
   */
  state: string;
}

/** The digest of one embedded record's state. */
export function embedDigest(e: EmbedState): string {
  return createHash('sha256')
    .update([e.kind, e.targetId, e.state].join(SEP), 'utf8')
    .digest('hex');
}

/**
 * One digest over everything the entry embeds.
 *
 * Sorted by kind and id so that the order the links happen to come back in
 * cannot change the result, and null when there is nothing embedded -- which
 * is what keeps the entry's own digest byte-identical to what it was before
 * embeds were covered at all, and so keeps every signature made before this
 * existed still verifying.
 */
export function embedsHash(embeds: EmbedState[]): string | null {
  if (embeds.length === 0) return null;
  const parts = embeds
    .map(e => `${e.kind}:${e.targetId}:${embedDigest(e)}`)
    .sort();
  return createHash('sha256').update(parts.join(SEP), 'utf8').digest('hex');
}

export interface StoredEmbed {
  kind: string;
  targetId: string;
  /** The target's name when the link was made. */
  label: string;
  /** The digest taken at signing. Null on a link made before signing. */
  snapshot: string | null;
}

export interface EmbedCheck {
  /** Records whose state no longer matches what was signed. */
  changed: StoredEmbed[];
  /** Records the entry points at that no longer exist. */
  missing: StoredEmbed[];
  /** Links carrying no snapshot, so nothing can be said about them. */
  unrecorded: StoredEmbed[];
  ok: boolean;
}

/**
 * Compare what was signed with what is there now.
 *
 * A record that has been deleted is reported apart from one that has been
 * edited. They are different facts about an entry: one says the page is
 * showing something other than what was signed, the other says the page can no
 * longer show it at all, and a reader deciding whether to trust an experiment
 * needs to know which.
 */
export function checkEmbeds(stored: StoredEmbed[], current: EmbedState[]): EmbedCheck {
  const now = new Map(current.map(e => [`${e.kind}:${e.targetId}`, embedDigest(e)]));

  const changed: StoredEmbed[] = [];
  const missing: StoredEmbed[] = [];
  const unrecorded: StoredEmbed[] = [];

  for (const s of stored) {
    if (!s.snapshot) { unrecorded.push(s); continue; }
    const digest = now.get(`${s.kind}:${s.targetId}`);
    if (digest === undefined) { missing.push(s); continue; }
    if (digest !== s.snapshot) changed.push(s);
  }

  return { changed, missing, unrecorded, ok: changed.length === 0 && missing.length === 0 };
}

/** A sentence a reader can act on, or null when there is nothing to say. */
export function describeEmbedCheck(check: EmbedCheck): string | null {
  const bits: string[] = [];
  if (check.changed.length) {
    bits.push(
      `${names(check.changed)} ${was(check.changed)} changed since this was signed, `
      + 'so what is shown is not what was signed.',
    );
  }
  if (check.missing.length) {
    bits.push(`${names(check.missing)} no longer exist${check.missing.length === 1 ? 's' : ''}.`);
  }
  if (check.unrecorded.length) {
    bits.push(
      `${names(check.unrecorded)} ${was(check.unrecorded)} linked without a record of its state, `
      + 'so nothing can be said about whether it has changed.',
    );
  }
  return bits.length ? bits.join(' ') : null;
}

const names = (list: StoredEmbed[]) =>
  list.length <= 3
    ? list.map(e => e.label).join(', ')
    : `${list.slice(0, 3).map(e => e.label).join(', ')} and ${list.length - 3} more`;

const was = (list: StoredEmbed[]) => (list.length === 1 ? 'has' : 'have');
