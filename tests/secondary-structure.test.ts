import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hairpins, dimer, checkOligo, startCodonStructure, scanStructure, MAX_FOLD,
} from '../src/lib/secondary-structure.ts';
import { revComp } from '../src/lib/alignment.ts';
import { makeSeq } from './support/sequences.ts';

test('a GC stem with a tetraloop folds; the AT equivalent does not', () => {
  const gc = hairpins('GCGCAAAAGCGC');
  assert.equal(gc.length > 0, true);
  assert.equal(gc[0].stem5, 'GCGC');
  assert.equal(gc[0].stem3, 'GCGC');
  assert.equal(gc[0].loop, 'AAAA');
  assert.ok(gc[0].dG < 0);

  // Four AT pairs cannot pay for closing a loop at 37 °C, and should not be
  // reported as if they could.
  assert.deepEqual(hairpins('ATATAAAAATAT'), []);
});

test('a longer stem is more stable, monotonically', () => {
  const dGs = ['GCGCAAAAGCGC', 'GCGCGCAAAAGCGCGC', 'GCGCGCGCAAAAGCGCGCGC']
    .map(s => hairpins(s)[0].dG);
  assert.ok(dGs[0] > dGs[1] && dGs[1] > dGs[2], dGs.join(' '));
});

test('a longer loop is less stable, monotonically', () => {
  const dGs = [4, 6, 10, 20].map(n => hairpins('GGGGCC' + 'A'.repeat(n) + 'GGCCCC')[0].dG);
  for (let i = 1; i < dGs.length; i++) assert.ok(dGs[i] > dGs[i - 1], dGs.join(' '));
});

test('a loop shorter than three bases cannot close', () => {
  // The stem would pair, but there is no room to turn the corner.
  assert.deepEqual(hairpins('GCGCGCAAGCGCGC', { minLoop: 3 }).filter(h => h.loopLength < 3), []);
});

test('an unstructured sequence gives nothing', () => {
  assert.deepEqual(hairpins('AAAAAAAAAAAAAAAAAAAA'), []);
});

test('a hairpin closing on the 3′ end is flagged as such', () => {
  // Stem's 3' arm runs to the last base.
  const h = hairpins('TTTTTTGGGGCCAAAAGGCCCC')[0];
  assert.ok(h);
  assert.equal(h.involves3Prime, true);
  const inner = hairpins('GGGGCCAAAAGGCCCCTTTTTTTT')[0];
  assert.equal(inner.involves3Prime, false);
});

test('two exactly complementary oligos give a full-length duplex', () => {
  const a = 'ACGTACGTAAGGGCCC';
  const d = dimer(a, revComp(a));
  assert.ok(d);
  assert.equal(d.length, a.length);
  assert.equal(d.involves3Prime, true);
  assert.ok(d.dG < -15);
});

test('the dimer diagram draws bases that actually pair', () => {
  const a = 'GAATTC';
  const d = dimer(a, a);          // a palindrome self-dimers perfectly
  assert.ok(d);
  const [top, bars, bottom] = d.diagram;
  assert.equal(top, "5'-GAATTC-3'");
  assert.equal(bottom, "3'-CTTAAG-5'");
  // Every column carrying a bar must hold a complementary pair.
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  for (let i = 0; i < bars.length; i++) {
    if (bars[i] !== '|') continue;
    assert.equal(comp[top[i]], bottom[i], `column ${i}: ${top[i]} over ${bottom[i]}`);
  }
  assert.equal((bars.match(/\|/g) ?? []).length, 6);
});

test('the diagram stays aligned when the strands are offset', () => {
  // b pairs only with the tail of a, so the lower strand must be shifted.
  const a = 'TTTTTTTTGGGGCCCC';
  const b = 'GGGGCCCC';
  const d = dimer(a, b);
  assert.ok(d);
  const [top, bars, bottom] = d.diagram;
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
  let bars_seen = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i] !== '|') continue;
    bars_seen++;
    assert.equal(comp[top[i]], bottom[i], `column ${i}: ${top[i]} over ${bottom[i]}`);
  }
  assert.ok(bars_seen >= 8, `${bars_seen} pairs drawn`);
});

test('a self-dimer of a non-palindrome is weaker than of a palindrome', () => {
  const pal = dimer('GAATTC', 'GAATTC');
  const non = dimer('GAATTA', 'GAATTA');
  assert.ok(pal && non);
  assert.ok(pal.dG < non.dG, `${pal.dG} should beat ${non.dG}`);
});

test('checkOligo names the 3-prime problem specifically', () => {
  const bad = checkOligo('GGGGCCCCTTTTGGGGCCCC');
  assert.ok(bad.warnings.length > 0);
  assert.ok(bad.warnings.some(w => w.includes("3'")), bad.warnings.join(' | '));

  const fine = checkOligo('ATGACAGTTACAGTCAGTTACAGTGA');
  assert.deepEqual(fine.warnings, []);
});

test('a strong dimer held in the middle is still called a problem', () => {
  // Not at the 3' end, so it will not extend — but strong enough to matter.
  const w = checkOligo('AAGGGGCCCCTTTTGGGGCCCCAA').warnings.join(' | ');
  assert.ok(/Self-dimer/.test(w), w);
  assert.ok(!/Usually tolerable/.test(w) || !/1[0-9]\.\d/.test(w),
    'a double-digit dimer must not be called tolerable');
});

test('structure over a start codon is reported in sequence coordinates', () => {
  const utr = 'TTTTTTTTTTTTTTTTTTTT';
  const hairpin = 'GGGGCCCCAAAAGGGGCCCC';
  const seq = utr + hairpin + 'ATG' + 'GCTAGCAAAGGAGAAGAA';
  const r = startCodonStructure(seq, seq.indexOf('ATG', utr.length + hairpin.length - 1));
  assert.ok(r.hairpin);
  // Coordinates must point into `seq`, not into the 60-base window.
  assert.equal(seq.slice(r.hairpin.stemStart, r.hairpin.stemStart + r.hairpin.stemLength), r.hairpin.stem5);
  assert.ok(r.dG < 0);
  assert.ok(r.verdict.length > 0);
});

test('an open start codon region says so', () => {
  const seq = 'TTAAGGAGGTGATCACC' + 'ATG' + 'GCTAGCAAAGGAGAAGAA';
  const r = startCodonStructure(seq, 17);
  assert.ok(r.dG > -4, `dG ${r.dG}`);
  assert.match(r.verdict, /open/);
});

test('folding refuses a sequence long enough to hang the tab', () => {
  assert.throws(() => hairpins(makeSeq(MAX_FOLD + 1)), /too long to fold/);
  assert.doesNotThrow(() => hairpins(makeSeq(200)));
});

test('scanStructure sweeps a long sequence and reports in real coordinates', () => {
  const filler = makeSeq(400, 21);
  const hairpin = 'GGGGCCCCAAAAGGGGCCCC';
  const seq = filler + hairpin + filler;
  const windows = scanStructure(seq, 60, 20);

  assert.ok(windows.length > 30);
  const worst = windows.reduce((a, b) => (b.dG < a.dG ? b : a));
  assert.ok(worst.hairpin);
  // The most stable window found must be the planted hairpin, at its real place.
  assert.ok(Math.abs(worst.hairpin.stemStart - filler.length) < 60,
    `found at ${worst.hairpin.stemStart}, planted at ${filler.length}`);
  assert.equal(
    seq.slice(worst.hairpin.stemStart, worst.hairpin.stemStart + worst.hairpin.stemLength),
    worst.hairpin.stem5,
  );
});
