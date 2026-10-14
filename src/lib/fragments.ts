import { revComp } from './alignment';
import { blunt, sticky, type End, type Fragment } from './assembly';

/**
 * What happens to the ends of a fragment between the digest and the ligation.
 *
 * The assembly engine joins fragments whose ends already fit. Most of the bench
 * work in a cloning plan is making them fit: filling a 5' overhang to blunt it,
 * chewing a 3' overhang off, taking the phosphates off a vector so it cannot
 * close on itself, putting them on a PCR product so it can be ligated at all.
 * These are the steps a protocol lists in one line each and whose consequences
 * -- a frame shifted by four bases, a ligation that was never going to work --
 * show up a week later.
 *
 * Two facts drive everything here:
 *
 *   Filling a 5' overhang keeps those bases. The polymerase copies the
 *   protruding strand, so a blunted EcoRI end is four bases LONGER than the
 *   duplex it came from. Chewing a 3' overhang back loses them. One operation
 *   called "blunting" therefore adds bases at one kind of end and removes them
 *   at the other, which is why blunting an insert so often shifts its frame.
 *
 *   A ligation needs a 5' phosphate at each nick, and there are two nicks per
 *   join. Restriction digests leave phosphates; PCR products and synthetic
 *   oligos do not; phosphatase takes them off. One phosphate at a join is
 *   enough to hold it (the other nick is sealed in vivo), none is not.
 */

/** A fragment whose ends carry phosphate state as well as geometry. */
export interface PreparedFragment extends Fragment {
  /** 5' phosphate present at the left and right ends. */
  phosphate: { left: boolean; right: boolean };
}

export type EndSide = 'left' | 'right';

/**
 * Promote a fragment to one with phosphate state.
 *
 * Restriction enzymes leave a 5' phosphate at every end they create, so a
 * digest product is phosphorylated. PCR products and annealed oligos are not,
 * unless the primers were ordered that way.
 */
export function prepared(f: Fragment, phosphorylated = true): PreparedFragment {
  return { ...f, phosphate: { left: phosphorylated, right: phosphorylated } };
}

function withEnds(f: PreparedFragment, seq: string, left: End, right: End, phosphate = f.phosphate): PreparedFragment {
  return { ...f, seq, left, right, phosphate: { ...phosphate } };
}

/**
 * The bases a 5' overhang contributes to the duplex when it is filled.
 *
 * At the left end the overhang is on the top strand and reads straight into
 * the fragment. At the right end it is on the bottom strand, so what joins the
 * top strand is its reverse complement.
 */
function filledBases(end: End, side: EndSide): string {
  if (end.type !== "5'") return '';
  return side === 'left' ? end.overhang : revComp(end.overhang);
}

export interface BluntingResult {
  fragment: PreparedFragment;
  /** Bases gained at each end by filling, lost by chewing back (negative). */
  change: { left: number; right: number };
  notes: string[];
}

/**
 * Blunt both ends with a polymerase: 5' overhangs filled in, 3' overhangs
 * removed.
 *
 * Klenow and T4 DNA polymerase both do this; T4's 3'->5' exonuclease is the
 * stronger of the two, which is why it is the one usually specified when a 3'
 * overhang has to go. The sequence outcome is the same either way, so the
 * enzyme is recorded for the protocol rather than branched on.
 */
export function bluntEnds(f: PreparedFragment, enzyme: 'klenow' | 't4' = 't4'): BluntingResult {
  const leftFill = filledBases(f.left, 'left');
  const rightFill = filledBases(f.right, 'right');
  const leftLost = f.left.type === "3'" ? f.left.overhang.length : 0;
  const rightLost = f.right.type === "3'" ? f.right.overhang.length : 0;

  // A 3' overhang is chewed off the strand that carries it, and the bases
  // opposite it go with it: the duplex ends where the recessed strand ends.
  const core = f.seq.slice(leftLost, f.seq.length - rightLost);
  const notes: string[] = [];
  if (leftFill || rightFill) {
    notes.push(`${enzyme === 't4' ? 'T4 DNA polymerase' : 'Klenow'} fills the 5′ overhang${leftFill && rightFill ? 's' : ''}, keeping ${leftFill.length + rightFill.length} base${leftFill.length + rightFill.length === 1 ? '' : 's'}.`);
  }
  if (leftLost || rightLost) {
    notes.push(`The 3′ overhang${leftLost && rightLost ? 's are' : ' is'} chewed back, losing ${leftLost + rightLost} base${leftLost + rightLost === 1 ? '' : 's'}.`);
  }
  const net = leftFill.length + rightFill.length - leftLost - rightLost;
  if (net % 3 !== 0 && net !== 0) {
    notes.push(`The fragment changes by ${net > 0 ? '+' : ''}${net} bases, which is not a multiple of three: blunting shifts the reading frame of anything read through this junction.`);
  }

  return {
    fragment: withEnds(f, leftFill + core + rightFill, blunt(), blunt()),
    change: { left: leftFill.length - leftLost, right: rightFill.length - rightLost },
    notes,
  };
}

/** Take the 5' phosphates off, so the fragment cannot ligate to itself. */
export function dephosphorylate(f: PreparedFragment): PreparedFragment {
  return { ...f, phosphate: { left: false, right: false } };
}

/** Put 5' phosphates on, with T4 polynucleotide kinase. */
export function phosphorylate(f: PreparedFragment): PreparedFragment {
  return { ...f, phosphate: { left: true, right: true } };
}

/**
 * Whether the 3' end of `a` and the 5' end of `b` will actually be joined by
 * ligase: the geometry has to fit and at least one of the two nicks has to
 * carry a phosphate.
 */
export function ligationCheck(
  a: PreparedFragment,
  b: PreparedFragment,
  opts: { allowBlunt?: boolean } = {},
): { joins: boolean; reason?: string } {
  const left = a.right;
  const right = b.left;
  const fits = left.type === 'blunt' && right.type === 'blunt'
    ? !!opts.allowBlunt
    : left.type === right.type && left.overhang === revComp(right.overhang);
  if (!fits) {
    return {
      joins: false,
      reason: left.type === 'blunt' || right.type === 'blunt'
        ? 'One end is blunt and the other is not.'
        : `${left.overhang || 'blunt'} and ${right.overhang || 'blunt'} are not complementary.`,
    };
  }
  if (!a.phosphate.right && !b.phosphate.left) {
    return { joins: false, reason: 'Neither end carries a 5′ phosphate, so ligase has nothing to seal. Phosphorylate one of them.' };
  }
  return { joins: true };
}

/** True when a fragment's own two ends fit each other, so it can self-close. */
export function canSelfClose(f: PreparedFragment, allowBlunt = false): boolean {
  return ligationCheck(f, f, { allowBlunt }).joins;
}

// ─── Annealed oligos ──────────────────────────────────────────────────────────

/**
 * Two oligos annealed into a short duplex, which is how a linker, an adaptor
 * or a short insert with chosen overhangs is made.
 *
 * The oligos are given 5'->3' as ordered. Where one is longer than the other
 * the extra bases protrude: the top strand's extra 5' bases are a 5' overhang
 * at the left end, the bottom strand's are a 5' overhang at the right. A duplex
 * made from synthetic oligos has no phosphates unless they were ordered.
 */
/** Shorter than this, a shared stretch is chance rather than an anneal. */
export const MIN_ANNEAL = 8;

export function annealOligos(
  id: string,
  name: string,
  topOligo: string,
  bottomOligo: string,
  phosphorylated = false,
): { fragment: PreparedFragment; error?: string } {
  const top = topOligo.toUpperCase().replace(/[^ACGT]/g, '');
  const bottom = bottomOligo.toUpperCase().replace(/[^ACGT]/g, '');
  const bottomOnTop = revComp(bottom);

  // Where the bottom strand sits against the top: the register giving the
  // longest run of pairing. It cannot be required to cover either oligo in
  // full -- an adaptor with an overhang at each end pairs over a core shorter
  // than both strands, which is the commonest shape there is.
  let offset: number | null = null;
  let paired = 0;
  for (let shift = -(bottomOnTop.length - 1); shift < top.length; shift++) {
    const from = Math.max(0, shift);
    const to = Math.min(top.length, shift + bottomOnTop.length);
    const len = to - from;
    if (len <= paired) continue;
    if (top.slice(from, to) === bottomOnTop.slice(from - shift, to - shift)) { offset = shift; paired = len; }
  }
  // Below this, a "match" is two oligos that happen to share a few bases.
  if (paired < MIN_ANNEAL) offset = null;
  if (offset === null) {
    const f = prepared({ id, name, seq: top, left: blunt(), right: blunt() }, phosphorylated);
    return { fragment: f, error: 'The two oligos are not complementary over their shared length.' };
  }

  // Bases of the top strand before the bottom begins are a 5' overhang on the
  // left; bases of the bottom strand past the top's end are one on the right.
  const leftExtra = offset > 0 ? top.slice(0, offset) : '';
  const leftRecess = offset < 0 ? bottomOnTop.slice(0, -offset) : '';
  const topEnd = top.length;
  const bottomEnd = offset + bottomOnTop.length;
  const rightTopExtra = topEnd > bottomEnd ? top.slice(bottomEnd) : '';
  const rightBottomExtra = bottomEnd > topEnd ? bottomOnTop.slice(topEnd - offset) : '';

  const core = top.slice(Math.max(0, offset), Math.min(topEnd, bottomEnd));
  const left: End = leftExtra ? sticky("5'", leftExtra)
    : leftRecess ? sticky("3'", revComp(leftRecess))
    : blunt();
  const right: End = rightBottomExtra ? sticky("5'", revComp(rightBottomExtra))
    : rightTopExtra ? sticky("3'", rightTopExtra)
    : blunt();

  return { fragment: prepared({ id, name, seq: core, left, right }, phosphorylated) };
}

// ─── Partial digests ──────────────────────────────────────────────────────────

export interface CutSite {
  /** Position on the top strand where the enzyme cuts, 0-based. */
  position: number;
  enzyme: string;
  end: End;
}

export interface PartialProduct {
  /** Which cut sites bound this piece; empty for the uncut molecule. */
  usedSites: number[];
  fragment: Fragment;
}

/**
 * Every piece a partial digest can produce from a circular molecule: the
 * stretch between any two cut sites, not only between neighbours.
 *
 * A complete digest gives the pieces between adjacent sites. A partial gives
 * those plus every longer run, which is the point of running one -- it is how
 * a fragment spanning an internal site is recovered, and how a vector is
 * linearised when the enzyme cuts it twice. The number of pieces is quadratic
 * in the sites, so this is for the handful of sites a plan actually uses.
 */
export function partialDigestCircular(seq: string, sites: CutSite[]): PartialProduct[] {
  const s = seq.toUpperCase();
  const n = s.length;
  const ordered = [...sites].sort((a, b) => a.position - b.position);
  const out: PartialProduct[] = [];
  if (ordered.length === 0) return out;

  for (let i = 0; i < ordered.length; i++) {
    for (let k = 1; k <= ordered.length; k++) {
      const j = (i + k) % ordered.length;
      const from = ordered[i].position;
      const to = ordered[j].position;
      const length = ((to - from) % n + n) % n || n;
      const piece = from + length <= n ? s.slice(from, from + length) : s.slice(from) + s.slice(0, from + length - n);
      out.push({
        usedSites: [i, j],
        fragment: { id: `${from}-${to}`, name: `${ordered[i].enzyme}–${ordered[j].enzyme} (${length} bp)`, seq: piece, left: ordered[i].end, right: ordered[j].end },
      });
    }
  }
  return out;
}

// ─── Digesting to fragments with real ends ───────────────────────────────────

/**
 * Where an enzyme cuts each strand, in top-strand coordinates.
 *
 * `top` is the index the top strand breaks before; `bottom` the same for the
 * bottom. Their order is the whole of the geometry: top before bottom leaves a
 * 5' overhang, bottom before top a 3' one, together a blunt end.
 */
export interface StrandCut {
  enzyme: string;
  top: number;
  bottom: number;
}

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
const matches = (seq: string, at: number, pattern: string, iupac: Record<string, string>) => {
  for (let i = 0; i < pattern.length; i++) {
    const b = seq[at + i];
    if (!b || !(iupac[pattern[i]] ?? pattern[i]).includes(b)) return false;
  }
  return true;
};

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', R: 'AG', Y: 'CT', S: 'CG', W: 'AT',
  K: 'GT', M: 'AC', B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

/**
 * Every cut the named enzymes make, with both strand positions.
 *
 * A site read on the bottom strand cuts the mirror image of the site read on
 * the top: the offsets swap and are measured from the other end. Getting that
 * backwards is invisible in a list of fragment sizes and wrong in every
 * overhang, which is what decides whether the ligation works.
 */
export function strandCuts(
  seq: string,
  circular: boolean,
  enzymes: { name: string; pattern: string; cutBefore: number; cutBottom?: number }[],
): StrandCut[] {
  const s = seq.toUpperCase();
  const n = s.length;
  const seen = new Map<string, StrandCut>();

  for (const e of enzymes) {
    const p = e.pattern.toUpperCase();
    const L = p.length;
    const top = e.cutBefore;
    const bottom = e.cutBottom ?? L - e.cutBefore;
    const rcPattern = p.split('').reverse().map(c => {
      const set = IUPAC[c] ?? c;
      return Object.keys(IUPAC).find(k => IUPAC[k] === set.split('').map(x => COMPLEMENT[x] ?? x).sort().join('')) ?? c;
    }).join('');
    const hay = circular ? s + s.slice(0, L - 1) : s;
    const last = circular ? n - 1 : n - L;

    for (let i = 0; i <= last; i++) {
      if (matches(hay, i, p, IUPAC)) {
        const c = { enzyme: e.name, top: i + top, bottom: i + bottom };
        seen.set(`${e.name}:${c.top}:${c.bottom}`, c);
      }
      // The same enzyme reading the other strand: the offsets are measured
      // from the far end of the site, and the two strands' cuts swap.
      if (rcPattern !== p && matches(hay, i, rcPattern, IUPAC)) {
        const c = { enzyme: e.name, top: i + L - bottom, bottom: i + L - top };
        seen.set(`${e.name}:${c.top}:${c.bottom}`, c);
      }
    }
  }

  const cuts = [...seen.values()].filter(c => circular || (Math.min(c.top, c.bottom) > 0 && Math.max(c.top, c.bottom) < n));
  if (circular) for (const c of cuts) { const shift = ((c.top % n) + n) % n - c.top; c.top += shift; c.bottom += shift; }
  return cuts.sort((a, b) => Math.min(a.top, a.bottom) - Math.min(b.top, b.bottom));
}

/** The pair of ends one cut creates: for the piece before it, and after it. */
export function endsOfCut(seq: string, cut: StrandCut): { leftPieceRight: End; rightPieceLeft: End } {
  const n = seq.length;
  const lo = Math.min(cut.top, cut.bottom);
  const hi = Math.max(cut.top, cut.bottom);
  if (lo === hi) return { leftPieceRight: blunt(), rightPieceLeft: blunt() };
  const span = hi <= n ? seq.slice(lo, hi) : seq.slice(lo) + seq.slice(0, hi - n);
  // Top strand cut first: the bottom strand protrudes on the left piece and
  // the top strand on the right piece, which is a 5' overhang on both.
  const type = cut.top < cut.bottom ? "5'" : "3'";
  return type === "5'"
    ? { leftPieceRight: sticky("5'", revComp(span)), rightPieceLeft: sticky("5'", span) }
    : { leftPieceRight: sticky("3'", span), rightPieceLeft: sticky("3'", revComp(span)) };
}

/**
 * Cut a molecule into fragments carrying the ends the enzymes actually leave.
 *
 * A circular molecule gives one piece per cut; a linear one gives one more
 * than it has cuts, and the two outermost keep whatever ends the molecule
 * already had. Digest products are phosphorylated, because that is what a
 * restriction enzyme leaves.
 */
export function digestToFragments(
  seq: string,
  circular: boolean,
  cuts: StrandCut[],
  endsOfMolecule: { left: End; right: End } = { left: blunt(), right: blunt() },
): PreparedFragment[] {
  const s = seq.toUpperCase();
  const n = s.length;
  const ordered = [...cuts].sort((a, b) => Math.min(a.top, a.bottom) - Math.min(b.top, b.bottom));
  const out: PreparedFragment[] = [];
  const piece = (from: number, to: number) => (to <= n ? s.slice(from, to) : s.slice(from) + s.slice(0, to - n));

  if (ordered.length === 0) {
    return [prepared({ id: 'whole', name: 'uncut', seq: s, left: endsOfMolecule.left, right: endsOfMolecule.right }, true)];
  }

  if (circular) {
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % ordered.length];
      const from = Math.max(a.top, a.bottom);
      const toRaw = Math.min(b.top, b.bottom);
      const to = toRaw > from ? toRaw : toRaw + n;
      out.push(prepared({
        id: `cut-${i}`,
        name: `${a.enzyme}–${b.enzyme}`,
        seq: piece(from, to),
        left: endsOfCut(s, a).rightPieceLeft,
        right: endsOfCut(s, b).leftPieceRight,
      }, true));
    }
    return out;
  }

  const bounds: (StrandCut | null)[] = [null, ...ordered, null];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const from = a ? Math.max(a.top, a.bottom) : 0;
    const to = b ? Math.min(b.top, b.bottom) : n;
    if (to <= from) continue;
    out.push(prepared({
      id: `cut-${i}`,
      name: `${a?.enzyme ?? 'start'}–${b?.enzyme ?? 'end'}`,
      seq: s.slice(from, to),
      left: a ? endsOfCut(s, a).rightPieceLeft : endsOfMolecule.left,
      right: b ? endsOfCut(s, b).leftPieceRight : endsOfMolecule.right,
    }, !!a || !!b));
  }
  return out;
}
