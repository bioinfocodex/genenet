import { STACK, type NN } from './tm';
import { revComp } from './alignment';

/**
 * Structure an oligo forms instead of doing its job.
 *
 * Three failures share one cause. A primer that folds back on itself is not
 * available to anneal; two primers that pair with each other amplify each other
 * instead of the template; and a hairpin over a ribosome binding site keeps the
 * ribosome off. All three are the same question -- where does this sequence
 * pair with itself or with its partner, and how strongly.
 *
 * This is not a folding engine. A real one (Zuker, ViennaRNA) computes a
 * minimum free energy over every possible structure with loop-length penalties
 * fitted to melting data. What is here finds the *best contiguous helix* and
 * prices it with the same nearest-neighbour stacking parameters the Tm code
 * uses, plus a loop penalty. That is enough to answer "will this primer work",
 * which is the question people actually ask of it, and it is honest about being
 * an approximation: the ΔG is good to about a kcal, and a structure with
 * internal bulges will be under-called because contiguous helices are all it
 * looks for.
 *
 * Where the pairing sits matters more than how much of it there is. A primer
 * dimer held together in the middle mostly falls apart; one whose 3' ends pair
 * gets extended by the polymerase, and that product then amplifies itself for
 * the rest of the reaction. So 3' involvement is reported separately rather
 * than folded into a single score.
 */

/** kcal/mol at 37 °C, from ΔH and ΔS. */
function dG(nn: NN): number {
  return nn.dH - (310.15 * nn.dS) / 1000;
}

/**
 * Penalty for closing a hairpin loop of n unpaired bases.
 *
 * Jacobson-Stockmayer form: entropy of closing a loop grows with the log of its
 * length. The constants are the usual approximations for DNA; loops under three
 * bases cannot close at all, which is why tetraloops are the smallest hairpins
 * anyone sees.
 */
function loopPenalty(n: number): number {
  if (n < 3) return Infinity;
  if (n <= 30) return 1.75 * 0.616 * Math.log(n / 3) + 3.5;
  return 1.75 * 0.616 * Math.log(30 / 3) + 3.5 + 1.75 * 0.616 * Math.log(n / 30);
}

const PAIRS: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

/** Longest sequence `hairpins` will fold in one go. */
export const MAX_FOLD = 2000;

/** ΔG of a run of stacked pairs, given the top strand of the helix. */
function helixDG(top: string): number {
  let g = 0;
  for (let i = 0; i + 1 < top.length; i++) {
    const nn = STACK[top.slice(i, i + 2)];
    if (nn) g += dG(nn);
  }
  // Helix initiation, priced on the closing pair like the Tm code does.
  const init = /[GC]/.test(top[0]) ? { dH: 0.1, dS: -2.8 } : { dH: 2.3, dS: 4.1 };
  return g + dG(init);
}

export interface Hairpin {
  /** 0-indexed start of the 5' arm of the stem. */
  stemStart: number;
  /** 0-indexed start of the 3' arm, reading 5'->3' along the sequence. */
  stemEnd: number;
  stemLength: number;
  loopLength: number;
  /** kcal/mol at 37 °C. Negative is stable; more negative is worse for a primer. */
  dG: number;
  /** The 5' arm, its loop, and the 3' arm. */
  stem5: string;
  loop: string;
  stem3: string;
  /** True when the stem reaches into the last five bases of the sequence. */
  involves3Prime: boolean;
}

export interface StructureOptions {
  /** Shortest helix worth reporting. */
  minStem?: number;
  /** Smallest loop that can close. Three is physical; four is what is seen. */
  minLoop?: number;
  /** Only report structures at least this stable. */
  maxDG?: number;
}

/**
 * Hairpins the sequence can form with itself.
 *
 * Every (start, end) pair is tried and the helix extended as far as it pairs.
 * Quadratic in length, which is fine for the oligos and UTRs this is asked
 * about and is why `foldWindow` exists for anything longer.
 */
export function hairpins(sequence: string, opts: StructureOptions = {}): Hairpin[] {
  const { minStem = 3, minLoop = 3, maxDG = -1 } = opts;
  const s = sequence.toUpperCase().replace(/U/g, 'T');
  const n = s.length;
  // Every start against every end, each extended: fine for an oligo or a UTR,
  // ruinous for a plasmid. Callers with something long want `scanStructure`,
  // which windows it; failing loudly here beats freezing the tab.
  if (n > MAX_FOLD) {
    throw new Error(
      `${n.toLocaleString()} bases is too long to fold directly (limit ${MAX_FOLD}). ` +
      'Use scanStructure to sweep a window along it.',
    );
  }
  const found: Hairpin[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = n - 1; j > i + minLoop; j--) {
      if (PAIRS[s[i]] !== s[j]) continue;
      // Extend inwards while the bases keep pairing.
      let len = 0;
      while (
        i + len < j - len &&
        j - len - (i + len) - 1 >= minLoop &&
        PAIRS[s[i + len]] === s[j - len]
      ) len++;
      if (len < minStem) continue;

      const loopLength = j - len + 1 - (i + len);
      const g = helixDG(s.slice(i, i + len)) + loopPenalty(loopLength);
      if (g > maxDG) continue;

      found.push({
        stemStart: i,
        stemEnd: j - len + 1,
        stemLength: len,
        loopLength,
        dG: g,
        stem5: s.slice(i, i + len),
        loop: s.slice(i + len, j - len + 1),
        stem3: s.slice(j - len + 1, j + 1),
        involves3Prime: j >= n - 5,
      });
    }
  }

  // Keep the best structure per 5' anchor rather than every sub-helix of it.
  const best = new Map<number, Hairpin>();
  for (const h of found) {
    const prev = best.get(h.stemStart);
    if (!prev || h.dG < prev.dG) best.set(h.stemStart, h);
  }
  return [...best.values()].sort((a, b) => a.dG - b.dG);
}

export interface Dimer {
  dG: number;
  /** Length of the paired run. */
  length: number;
  /** 0-indexed start of the pairing in each sequence. */
  aStart: number;
  bStart: number;
  /** True when either strand's last three bases are in the helix. */
  involves3Prime: boolean;
  /** Three lines: strand A, the pairing, strand B reversed. */
  diagram: string[];
}

/**
 * The most stable duplex two oligos form with each other.
 *
 * `b` is scanned against `a` at every offset; the best contiguous run of pairs
 * wins. Passing the same sequence twice gives the self-dimer.
 */
export function dimer(aSeq: string, bSeq: string): Dimer | null {
  const a = aSeq.toUpperCase().replace(/U/g, 'T');
  const b = bSeq.toUpperCase().replace(/U/g, 'T');
  if (!a.length || !b.length) return null;

  // b pairs with a antiparallel, so walk b in reverse-complement space: a run
  // of matches between `a` and revComp(b) is a run of base pairs.
  const rb = revComp(b);
  let best: Dimer | null = null;

  for (let offset = -(rb.length - 1); offset < a.length; offset++) {
    let run = 0, runStart = 0;
    for (let i = 0; i <= rb.length; i++) {
      const ai = offset + i;
      const paired = i < rb.length && ai >= 0 && ai < a.length && a[ai] === rb[i];
      if (paired) { if (run === 0) runStart = i; run++; continue; }
      if (run >= 3) {
        const top = a.slice(offset + runStart, offset + runStart + run);
        const g = helixDG(top);
        // Where the run sits on each strand, in that strand's own coordinates.
        const aStart = offset + runStart;
        // rb index r corresponds to b index b.length - 1 - r.
        const bStart = b.length - (runStart + run);
        const a3 = aStart + run >= a.length - 2;
        const b3 = bStart + run >= b.length - 2;
        if (!best || g < best.dG) {
          best = {
            dG: g, length: run, aStart, bStart,
            involves3Prime: a3 || b3,
            diagram: drawDimer(a, b, offset, runStart, run),
          };
        }
      }
      run = 0;
    }
  }
  return best;
}

/**
 * The three-line picture people actually read a dimer from.
 *
 * The lower strand is written 3'->5' so it sits antiparallel under the upper
 * one, and both are shifted so the paired bases line up in the same columns.
 * Writing the lower strand as its reverse complement instead -- the easy slip
 * -- draws a picture in which the bases under the pairing bars do not pair.
 */
function drawDimer(a: string, b: string, offset: number, runStart: number, run: number): string[] {
  // rb index i sits under a index offset + i; rb index i is b index len-1-i, so
  // b reversed is the lower strand read left to right.
  const lower = b.split('').reverse().join('');
  const aPad = Math.max(0, -offset);
  const bPad = Math.max(0, offset);

  const top = `5'-${' '.repeat(aPad)}${a}-3'`;
  const bottom = `3'-${' '.repeat(bPad)}${lower}-5'`;
  const barCol = 3 + bPad + runStart;
  return [top, ' '.repeat(barCol) + '|'.repeat(run), bottom];
}

export interface OligoStructure {
  hairpin: Hairpin | null;
  selfDimer: Dimer | null;
  warnings: string[];
}

/**
 * Everything structural about one oligo, phrased as what it means for the PCR.
 *
 * The thresholds are the ones oligo suppliers use: about -3 kcal/mol for a
 * hairpin and -6 for a dimer before it is worth redesigning, tightened when the
 * 3' end is involved because that is the end that gets extended.
 */
export function checkOligo(sequence: string): OligoStructure {
  const hp = hairpins(sequence, { maxDG: -1 })[0] ?? null;
  const sd = dimer(sequence, sequence);
  const warnings: string[] = [];

  if (hp && hp.dG <= -3) {
    warnings.push(
      hp.involves3Prime
        ? `Hairpin at ${hp.dG.toFixed(1)} kcal/mol closing on the 3' end. The end that has to prime is folded away — this one is worth redesigning.`
        : `Hairpin at ${hp.dG.toFixed(1)} kcal/mol (${hp.stemLength} bp stem, ${hp.loopLength} base loop). Raising the annealing temperature usually beats it.`,
    );
  }
  if (sd && sd.dG <= -6) {
    warnings.push(
      sd.involves3Prime
        ? `Self-dimer at ${sd.dG.toFixed(1)} kcal/mol with the 3' end paired. The polymerase extends this, and the product amplifies itself for the rest of the run.`
        : sd.dG <= -10
          // Position decides whether a dimer gets extended, but it does not
          // decide whether the oligo is available to prime. At this strength
          // enough of it is tied up that the reaction suffers either way.
          ? `Self-dimer at ${sd.dG.toFixed(1)} kcal/mol over ${sd.length} bp. Held in the middle rather than at the 3' end, so it will not extend, but at this strength much of the oligo is paired with itself instead of the template.`
          : `Self-dimer at ${sd.dG.toFixed(1)} kcal/mol over ${sd.length} bp, held in the middle. Usually tolerable.`,
    );
  }
  return { hairpin: hp, selfDimer: sd, warnings };
}

/**
 * Structure over the ribosome binding site and start codon.
 *
 * Expression in E. coli tracks how open this window is far more than it tracks
 * codon usage: a ribosome cannot load onto a folded 5' end whatever the codons
 * downstream say. Convention is roughly the last 30 bases before the start and
 * the first 30 after it.
 */
export function startCodonStructure(
  sequence: string, startOffset: number, window = 30,
): { dG: number; hairpin: Hairpin | null; verdict: string } {
  const s = sequence.toUpperCase().replace(/U/g, 'T');
  const from = Math.max(0, startOffset - window);
  const to = Math.min(s.length, startOffset + window);
  const region = s.slice(from, to);

  const hp = hairpins(region, { maxDG: -1 })[0] ?? null;
  const g = hp?.dG ?? 0;

  const verdict = g <= -8
    ? 'Strongly folded over the start. This is the usual reason a well-designed gene does not express; a 5′ UTR change or a few silent codon changes at the N-terminus will do more than any codon optimisation downstream.'
    : g <= -4
      ? 'Some structure over the start. Worth a look if expression is low, but not obviously the problem.'
      : 'The start codon region is open.';

  return {
    dG: g,
    // Report the hairpin in the coordinates of the sequence handed in.
    hairpin: hp ? { ...hp, stemStart: hp.stemStart + from, stemEnd: hp.stemEnd + from } : null,
    verdict,
  };
}

export interface StructureWindow {
  /** 0-indexed start of the window in the sequence handed in. */
  start: number;
  /** Most stable hairpin found inside it, in sequence coordinates. */
  hairpin: Hairpin | null;
  dG: number;
}

/**
 * Sweep a window along a long sequence, reporting the structure in each.
 *
 * Folding a whole plasmid at once is neither affordable here nor meaningful --
 * an mRNA folds locally as it is transcribed, and a pairing between bases two
 * kilobases apart is not what stops a ribosome. A window of a few dozen bases,
 * stepped along, is both cheaper and closer to what actually happens.
 */
export function scanStructure(
  sequence: string, window = 60, step = 10, opts: StructureOptions = {},
): StructureWindow[] {
  const s = sequence.toUpperCase().replace(/U/g, 'T');
  const out: StructureWindow[] = [];
  for (let i = 0; i < s.length; i += step) {
    const chunk = s.slice(i, i + window);
    if (chunk.length < 8) break;
    const hp = hairpins(chunk, opts)[0] ?? null;
    out.push({
      start: i,
      hairpin: hp ? { ...hp, stemStart: hp.stemStart + i, stemEnd: hp.stemEnd + i } : null,
      dG: hp?.dG ?? 0,
    });
  }
  return out;
}
