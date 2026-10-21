/**
 * Comments on anything, and the names in them.
 *
 * Tasks have had comments; nothing else did. So the conversation about a
 * construct happened in Slack, where it is not attached to the construct and
 * is gone in ninety days -- and the next person to open that record finds the
 * sequence and none of the argument about it.
 *
 * A mention is @name. It is the whole notification mechanism here: there is no
 * subscribing, no watching and no digest, because in a lab of a dozen people
 * the question is always "did Priya see this", and the answer should be that
 * somebody wrote her name.
 */

export interface Person {
  id: string;
  name: string;
  email: string;
}

/*
 * A mention runs to the end of a name, and names have spaces in them.
 *
 * Matching \w+ after the @ gets "Priya" out of "@Priya Shah" and then fails to
 * find anybody called Priya, because the record says Priya Shah. So candidate
 * runs of up to four words are taken and the longest one that is somebody's
 * name wins -- which also means "@Jane Smith ran the gel" mentions Jane Smith
 * and not a person called "Jane Smith ran".
 */
const CANDIDATE = /@([A-Za-zÀ-ɏ][\w'’.À-ɏ-]*(?:[ \t]+[A-Za-zÀ-ɏ][\w'’.À-ɏ-]*){0,3})/g;

export interface Mention {
  /** Where the @ is, so the text can be marked up without searching again. */
  at: number;
  /** The exact text matched, @ included. */
  text: string;
  person: Person;
}

/**
 * The people a comment mentions.
 *
 * Matched against the people who exist rather than against a pattern, because
 * an @ in front of a word is not a mention of anybody -- an email address, a
 * concentration written @37°C, a handle from somewhere else. Only a run that
 * is somebody's name counts, and the longest run wins so that a first name
 * does not shadow a full one.
 */
export function findMentions(text: string, people: Person[]): Mention[] {
  const byName = new Map<string, Person>();
  for (const p of people) {
    byName.set(normalise(p.name), p);
    // The local part of an address, which is what people type when the name
    // has an accent or a space they cannot be bothered with.
    const local = p.email.split('@')[0];
    if (local && !byName.has(normalise(local))) byName.set(normalise(local), p);
  }

  const out: Mention[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(CANDIDATE)) {
    const at = m.index ?? 0;
    /*
     * An @ in the middle of a word is part of an address, not a mention.
     * Checked on the character before rather than with a word boundary,
     * because \b before @ is true inside "a@b".
     */
    const before = at === 0 ? '' : text[at - 1];
    if (before && !/[\s(\[{,;:>]/.test(before)) continue;

    const words = m[1].split(/[ \t]+/);
    // Longest first: "Jane Smith" beats "Jane".
    for (let take = words.length; take >= 1; take--) {
      const candidate = words.slice(0, take).join(' ');
      const person = byName.get(normalise(stripTrailing(candidate)));
      if (!person) continue;
      if (!seen.has(person.id)) {
        seen.add(person.id);
        out.push({ at, text: `@${stripTrailing(candidate)}`, person });
      }
      break;
    }
  }

  return out;
}

/** Punctuation at the end of a name is sentence punctuation, not part of it. */
const stripTrailing = (s: string) => s.replace(/[.,;:!?'’]+$/, '');

const normalise = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The records a comment can hang off.
 *
 * A closed list rather than any string, because the kind decides where a
 * notification links to, and an unknown kind would be a comment nobody can
 * navigate back to.
 */
export const COMMENTABLE = [
  'sequence', 'sample', 'plate', 'entry', 'result', 'entity', 'procedure', 'project', 'oligo',
] as const;

export type Commentable = (typeof COMMENTABLE)[number];

export const COMMENT_PATHS: Record<Commentable, string> = {
  sequence: '/sequences',
  sample: '/samples',
  plate: '/plates',
  entry: '/notebook',
  result: '/results',
  entity: '/entities/record',
  procedure: '/procedures',
  project: '/projects',
  oligo: '/oligos',
};

export const isCommentable = (kind: string): kind is Commentable =>
  (COMMENTABLE as readonly string[]).includes(kind);

export function commentHref(kind: string, targetId: string): string | null {
  return isCommentable(kind) ? `${COMMENT_PATHS[kind]}/${targetId}` : null;
}

/**
 * Split a comment into text and mentions, for rendering.
 *
 * Returned as pieces rather than as HTML, so the caller decides how a mention
 * looks and nothing here has to think about escaping.
 */
export function segments(text: string, people: Person[]): (
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; person: Person }
)[] {
  const mentions = findMentionsAll(text, people);
  if (mentions.length === 0) return text ? [{ kind: 'text', text }] : [];

  const out: ({ kind: 'text'; text: string } | { kind: 'mention'; text: string; person: Person })[] = [];
  let at = 0;
  for (const m of mentions) {
    if (m.at > at) out.push({ kind: 'text', text: text.slice(at, m.at) });
    out.push({ kind: 'mention', text: m.text, person: m.person });
    at = m.at + m.text.length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/**
 * Every occurrence, including repeats of one person.
 *
 * `findMentions` answers "who is being told", which is a set of people;
 * rendering needs every place a name appears, which is not.
 */
function findMentionsAll(text: string, people: Person[]): Mention[] {
  const byId = new Map(findMentions(text, people).map(m => [m.person.id, m.person]));
  if (byId.size === 0) return [];

  const out: Mention[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const at = m.index ?? 0;
    const before = at === 0 ? '' : text[at - 1];
    if (before && !/[\s(\[{,;:>]/.test(before)) continue;
    const words = m[1].split(/[ \t]+/);
    for (let take = words.length; take >= 1; take--) {
      const candidate = stripTrailing(words.slice(0, take).join(' '));
      const person = [...byId.values()].find(p => matches(p, candidate));
      if (!person) continue;
      out.push({ at, text: `@${candidate}`, person });
      break;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const matches = (p: Person, candidate: string) =>
  normalise(p.name) === normalise(candidate) || normalise(p.email.split('@')[0]) === normalise(candidate);
