/**
 * Sequence alignment.
 *
 * The viewer mentioned alignment and BLAST in passing and implemented neither,
 * which left out the job a bench scientist does most: a plasmid comes back from
 * sequencing and you need to know whether it is the construct you designed. Not
 * "roughly similar" -- exactly which base at which position, and whether the
 * frame survived.
 *
 * Gotoh's algorithm, so gaps are affine: opening one costs more than extending
 * it. With a flat penalty a single three-base deletion scores the same as three
 * scattered ones, and real indels are contiguous. Getting this wrong makes an
 * alignment that looks plausible and puts the mismatches in the wrong places.
 *
 * Memory is the constraint on a plasmid-sized reference. Scores are kept as two
 * rows; only the traceback needs the full matrix, at one byte per cell -- about
 * 10 MB for an 800 bp read against a 12 kb plasmid, which is fine, and refused
 * above a ceiling rather than exhausting the server.
 */

export interface AlignmentOptions {
  /** 'global' aligns end to end; 'local' finds the best-scoring subsequence. */
  mode?: 'global' | 'local';
  match?: number;
  mismatch?: number;
  /** Cost of opening a gap, applied to its first base. Positive number. */
  gapOpen?: number;
  /** Cost of each additional base in a gap. Positive number. */
  gapExtend?: number;
  /**
   * 'semi-global' in effect: do not charge for gaps at the ends of the query.
   * This is what makes a short read align inside a long reference without
   * paying for the reference it does not cover.
   */
  freeEndGaps?: boolean;
}

export interface Alignment {
  /** The two sequences with '-' inserted. Equal length. */
  alignedA: string;
  alignedB: string;
  /** Between them: '|' identity, '.' mismatch, ' ' gap. */
  midline: string;
  score: number;
  /** Identities as a fraction of aligned columns that are not gaps in both. */
  identity: number;
  matches: number;
  mismatches: number;
  gaps: number;
  /** 0-based half-open span of A and B that the alignment covers. */
  aStart: number; aEnd: number;
  bStart: number; bEnd: number;
}

const DEFAULTS: Required<Omit<AlignmentOptions, 'mode'>> & { mode: 'global' | 'local' } = {
  mode: 'global',
  // Scores in the range EMBOSS and BLASTN use for nucleotides.
  match: 5, mismatch: -4, gapOpen: 10, gapExtend: 0.5, freeEndGaps: false,
};

/** Above this many cells, refuse rather than allocate. */
export const MAX_CELLS = 40_000_000;

const M = 0, IX = 1, IY = 2; // aligned, gap in B, gap in A
const STOP = 0b1000_0000;   // local alignment restarts at this cell

export function alignPair(a: string, b: string, opts: AlignmentOptions = {}): Alignment {
  const o = { ...DEFAULTS, ...opts };
  const A = a.toUpperCase().replace(/\s/g, '');
  const B = b.toUpperCase().replace(/\s/g, '');
  const n = A.length, m = B.length;

  if (!n || !m) throw new Error('Both sequences must be non-empty.');
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    throw new Error(
      `Too large to align: ${n} x ${m}. Align a region rather than the whole molecule.`,
    );
  }

  const NEG = -Infinity;
  const width = m + 1;

  // Traceback: two bits per matrix, packed into one byte per cell.
  const tb = new Uint8Array((n + 1) * width);

  let prevM = new Float64Array(width);
  let prevX = new Float64Array(width);
  let prevY = new Float64Array(width);
  let curM = new Float64Array(width);
  let curX = new Float64Array(width);
  let curY = new Float64Array(width);

  const local = o.mode === 'local';
  // With free end gaps the whole of B is aligned and A may hang off both ends:
  // a read sits inside a plasmid, and the plasmid it does not cover is not the
  // read's fault. So gaps in B (IX, consuming reference) are free at the ends;
  // gaps in A stay charged.
  const freeRefFlank = local || o.freeEndGaps;

  prevM[0] = 0; prevX[0] = NEG; prevY[0] = NEG;
  for (let j = 1; j <= m; j++) {
    prevM[j] = NEG;
    prevX[j] = NEG;
    prevY[j] = local ? 0 : -(o.gapOpen + (j - 1) * o.gapExtend);
    tb[j] |= IY << 4;
  }

  let best = local ? 0 : NEG;
  let bestI = 0, bestJ = 0;

  for (let i = 1; i <= n; i++) {
    curM[0] = NEG;
    curY[0] = NEG;
    curX[0] = freeRefFlank ? 0 : -(o.gapOpen + (i - 1) * o.gapExtend);
    tb[i * width] |= IX << 2;

    const ai = A.charCodeAt(i - 1);

    for (let j = 1; j <= m; j++) {
      const s = ai === B.charCodeAt(j - 1) ? o.match : o.mismatch;

      // M: both consumed.
      const fromM = prevM[j - 1], fromX = prevX[j - 1], fromY = prevY[j - 1];
      let bm = fromM, bmSrc = M;
      if (fromX > bm) { bm = fromX; bmSrc = IX; }
      if (fromY > bm) { bm = fromY; bmSrc = IY; }
      let mv = bm + s;
      // Smith-Waterman: a negative score restarts the alignment here. The
      // traceback has to know that, so the reset is recorded rather than
      // inferred -- without it the walk runs back to the origin and reports a
      // local alignment spanning the whole sequence.
      let restarted = false;
      if (local && mv < 0) { mv = 0; bmSrc = M; restarted = true; }
      curM[j] = mv;

      // Ix: gap in B, consuming A.
      const openX = prevM[j] - o.gapOpen;
      const extX = prevX[j] - o.gapExtend;
      if (extX > openX) { curX[j] = extX; tb[i * width + j] |= IX << 2; }
      else { curX[j] = openX; /* from M, bits stay 0 */ }

      // Iy: gap in A, consuming B.
      const openY = curM[j - 1] - o.gapOpen;
      const extY = curY[j - 1] - o.gapExtend;
      if (extY > openY) { curY[j] = extY; tb[i * width + j] |= IY << 4; }
      else { curY[j] = openY; }

      tb[i * width + j] |= bmSrc;
      if (restarted) tb[i * width + j] |= STOP;

      if (local && curM[j] > best) { best = curM[j]; bestI = i; bestJ = j; }
    }

    if (!local && o.freeEndGaps) {
      // All of B consumed at this row: a candidate end for the alignment.
      const v = Math.max(curM[m], curX[m], curY[m]);
      if (v > best) { best = v; bestI = i; bestJ = m; }
    }

    [prevM, curM] = [curM, prevM];
    [prevX, curX] = [curX, prevX];
    [prevY, curY] = [curY, prevY];
  }

  if (!local && !o.freeEndGaps) {
    best = Math.max(prevM[m], prevX[m], prevY[m]);
    bestI = n; bestJ = m;
  }

  // ── traceback ──
  let i = bestI, j = bestJ;
  // Start in the matrix that produced the best score. For a global alignment
  // that is the last row, which prevM/prevX/prevY still hold after the final
  // swap; with free end gaps the alignment may end on an earlier row, and the
  // aligned state is the only one that can end it there.
  let state: number = M;
  if (!local && !o.freeEndGaps) {
    const cand = [prevM[j], prevX[j], prevY[j]];
    const k = cand.indexOf(Math.max(...cand));
    state = k < 0 ? M : k;
  }

  const outA: string[] = [], outB: string[] = [], mid: string[] = [];
  let matches = 0, mismatches = 0, gaps = 0;

  while (i > 0 && j > 0) {
    const cell = tb[i * width + j];
    if (local && state === M && (cell & STOP)) break;

    if (state === M) {
      const ca = A[i - 1], cb = B[j - 1];
      outA.push(ca); outB.push(cb);
      if (ca === cb) { mid.push('|'); matches++; } else { mid.push('.'); mismatches++; }
      state = cell & 0b11;
      i--; j--;
    } else if (state === IX) {
      outA.push(A[i - 1]); outB.push('-'); mid.push(' '); gaps++;
      state = ((cell >> 2) & 0b11) === IX ? IX : M;
      i--;
    } else {
      outA.push('-'); outB.push(B[j - 1]); mid.push(' '); gaps++;
      state = ((cell >> 4) & 0b11) === IY ? IY : M;
      j--;
    }
  }

  const aStart = i, bStart = j;

  if (!local && !o.freeEndGaps) {
    while (i > 0) { outA.push(A[i - 1]); outB.push('-'); mid.push(' '); gaps++; i--; }
    while (j > 0) { outA.push('-'); outB.push(B[j - 1]); mid.push(' '); gaps++; j--; }
  }

  const alignedA = outA.reverse().join('');
  const alignedB = outB.reverse().join('');
  const midline = mid.reverse().join('');
  const scored = matches + mismatches;

  return {
    alignedA, alignedB, midline,
    score: best === NEG ? 0 : best,
    identity: scored ? matches / scored : 0,
    matches, mismatches, gaps,
    aStart: (!local && !o.freeEndGaps) ? 0 : aStart,
    aEnd: bestI,
    bStart: (!local && !o.freeEndGaps) ? 0 : bStart,
    bEnd: bestJ,
  };
}

// ─── Reading a clone back ────────────────────────────────────────────────────

export interface Difference {
  /** 1-based position in the reference. */
  position: number;
  kind: 'mismatch' | 'insertion' | 'deletion';
  reference: string;
  read: string;
}

export interface ReadVerification {
  /** True when the read matched better as a reverse complement. */
  reversed: boolean;
  identity: number;
  /** 1-based inclusive span of the reference the read covers. */
  coverageStart: number;
  coverageEnd: number;
  differences: Difference[];
  alignment: Alignment;
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};

export function revComp(seq: string): string {
  return seq.toUpperCase().split('').reverse().map(c => COMPLEMENT[c] ?? 'N').join('');
}

/**
 * Align a sequencing read against the reference it should match.
 *
 * Tries both orientations, because a read comes off the machine in whichever
 * direction the primer pointed, and reports the differences by position in the
 * reference -- which is the form the answer is needed in.
 */
export function verifyRead(reference: string, read: string, opts: AlignmentOptions = {}): ReadVerification {
  const ref = reference.toUpperCase().replace(/\s/g, '');
  const fwd = read.toUpperCase().replace(/\s/g, '');
  const rev = revComp(fwd);

  const settings: AlignmentOptions = { mode: 'global', freeEndGaps: true, ...opts };
  const a = alignPair(ref, fwd, settings);
  const b = alignPair(ref, rev, settings);
  const reversed = b.score > a.score;
  const best = reversed ? b : a;

  const differences: Difference[] = [];
  // The reference is A, so the walk starts at aStart. Seeding from bStart --
  // the read's own offset -- reported every difference shifted by however far
  // into the reference the read happened to begin.
  let refPos = best.aStart; // 0-based position in the reference
  // alignedA is the reference, alignedB the read.
  for (let k = 0; k < best.alignedA.length; k++) {
    const r = best.alignedA[k];
    const q = best.alignedB[k];
    if (r === '-') {
      differences.push({ position: refPos, kind: 'insertion', reference: '-', read: q });
      continue;
    }
    refPos++;
    if (q === '-') {
      differences.push({ position: refPos, kind: 'deletion', reference: r, read: '-' });
    } else if (q !== r) {
      differences.push({ position: refPos, kind: 'mismatch', reference: r, read: q });
    }
  }

  return {
    reversed,
    identity: best.identity,
    coverageStart: best.aStart + 1,
    coverageEnd: best.aEnd,
    differences,
    alignment: best,
  };
}

// ─── Several sequences at once ───────────────────────────────────────────────

export interface MultipleAlignment {
  names: string[];
  rows: string[];
  /** '*' where every sequence agrees. */
  consensus: string;
  identity: number;
}

/**
 * Progressive alignment against a centre sequence.
 *
 * Not ClustalW: no guide tree, no profile scoring. The centre-star method picks
 * the sequence closest to all the others and aligns each of the rest to it,
 * propagating gaps. For a handful of related sequences -- the colonies from one
 * transformation, a few homologues -- it gives the same answer, and it is
 * something that can be read and checked rather than trusted.
 */
export function alignMultiple(
  input: { name: string; sequence: string }[],
  opts: AlignmentOptions = {},
): MultipleAlignment {
  const seqs = input.filter(s => s.sequence.trim());
  if (seqs.length < 2) throw new Error('Need at least two sequences to align.');

  // Centre: the one with the best total pairwise score.
  const scores = seqs.map((s, i) =>
    seqs.reduce((sum, t, j) => i === j ? sum : sum + alignPair(s.sequence, t.sequence, opts).score, 0));
  const centre = scores.indexOf(Math.max(...scores));

  let centreRow = seqs[centre].sequence.toUpperCase();
  const others: { index: number; row: string }[] = [];

  for (let i = 0; i < seqs.length; i++) {
    if (i === centre) continue;
    const al = alignPair(centreRow.replace(/-/g, ''), seqs[i].sequence, opts);
    // Re-thread existing rows through any new gaps in the centre.
    const merged = mergeGaps(centreRow, al.alignedA);
    centreRow = merged.centre;
    for (const o of others) o.row = applyGapMap(o.row, merged.map);
    others.push({ index: i, row: padTo(al.alignedB, merged.map) });
  }

  const rows: string[] = [];
  const names: string[] = [];
  for (let i = 0; i < seqs.length; i++) {
    names.push(seqs[i].name);
    rows.push(i === centre ? centreRow : others.find(o => o.index === i)!.row);
  }

  const width = Math.max(...rows.map(r => r.length));
  const padded = rows.map(r => r.padEnd(width, '-'));
  let agreed = 0;
  let consensus = '';
  for (let k = 0; k < width; k++) {
    const col = padded.map(r => r[k]);
    const same = col.every(c => c === col[0] && c !== '-');
    consensus += same ? '*' : ' ';
    if (same) agreed++;
  }

  return { names, rows: padded, consensus, identity: width ? agreed / width : 0 };
}

/** Where gaps were inserted into the centre, so other rows can follow. */
function mergeGaps(oldCentre: string, newCentre: string): { centre: string; map: number[] } {
  const map: number[] = [];
  let oi = 0;
  let out = '';
  for (const ch of newCentre) {
    if (ch === '-') { out += '-'; map.push(-1); }
    else {
      while (oi < oldCentre.length && oldCentre[oi] === '-') { out += '-'; map.push(oi); oi++; }
      out += ch; map.push(oi); oi++;
    }
  }
  while (oi < oldCentre.length) { out += oldCentre[oi]; map.push(oi); oi++; }
  return { centre: out, map };
}

function applyGapMap(row: string, map: number[]): string {
  let out = '';
  for (const idx of map) out += idx === -1 || idx >= row.length ? '-' : row[idx];
  return out;
}

function padTo(row: string, map: number[]): string {
  return row.length >= map.length ? row.slice(0, map.length) : row.padEnd(map.length, '-');
}
