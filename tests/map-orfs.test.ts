import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseMapOrfs, coveringFeature, summariseOrfs, frameColour, orfTitle,
  type OrfLike, type FeatureLike,
} from '../src/lib/map-orfs.ts';

/** findORFs reports `end` exclusive and a protein including the stop. */
const orf = (start: number, aa: number, over: Partial<OrfLike> = {}): OrfLike => ({
  frame: 1,
  strand: '+',
  start,
  end: start + (aa + 1) * 3,
  length: (aa + 1) * 3,
  protein: 'M'.repeat(aa) + '*',
  ...over,
});

/** Features are 1-indexed inclusive, strand as 1/-1. */
const feat = (name: string, start: number, end: number, over: Partial<FeatureLike> = {}): FeatureLike => ({
  name, type: 'CDS', start, end, strand: 1, ...over,
});

test('an ORF under an annotated CDS is not drawn by default', () => {
  // It tells someone what they already know.
  const o = orf(100, 200);                       // 100..703 inclusive
  const f = feat('AmpR', 90, 720);
  assert.equal(coveringFeature({ start: o.start, end: o.end - 1, strand: '+' }, [f]), 'AmpR');
  assert.deepEqual(chooseMapOrfs([o], [f]), []);
});

test('an unannotated ORF is drawn — that is the point', () => {
  const o = orf(100, 200);
  const drawn = chooseMapOrfs([o], []);
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].coveredBy, null);
  assert.equal(drawn[0].aaLength, 200, 'the stop codon is not a residue');
  assert.equal(drawn[0].end, o.end - 1, 'exclusive end becomes inclusive for drawing');
});

test('a feature merely touching the ORF does not count as annotating it', () => {
  // A promoter abutting a gene overlaps its first bases and has said nothing
  // about whether the coding sequence is annotated.
  const o = orf(1000, 300);
  const touching = feat('lac promoter', 960, 1010, { type: 'promoter' });
  const alsoTouching = feat('some CDS', 960, 1010);
  assert.equal(coveringFeature({ start: o.start, end: o.end - 1, strand: '+' }, [touching, alsoTouching]), null);
  assert.equal(chooseMapOrfs([o], [touching, alsoTouching]).length, 1);
});

test('a CDS on the other strand does not annotate this ORF', () => {
  const o = orf(100, 200, { strand: '+', frame: 1 });
  const wrongStrand = feat('AmpR', 90, 720, { strand: -1 });
  assert.equal(coveringFeature({ start: o.start, end: o.end - 1, strand: '+' }, [wrongStrand]), null);
  assert.equal(chooseMapOrfs([o], [wrongStrand]).length, 1);
});

test('non-coding feature types never annotate an ORF', () => {
  const o = orf(100, 200);
  for (const type of ['promoter', 'terminator', 'rep_origin', 'primer_bind', 'misc_feature']) {
    assert.equal(
      coveringFeature({ start: o.start, end: o.end - 1, strand: '+' }, [feat('x', 50, 800, { type })]),
      null, type);
  }
  // But a gene or an exon does.
  for (const type of ['gene', 'exon', 'CDS', 'mRNA']) {
    assert.equal(
      coveringFeature({ start: o.start, end: o.end - 1, strand: '+' }, [feat('g', 50, 800, { type })]),
      'g', type);
  }
});

test('short reading frames are left off', () => {
  const short = orf(100, 40);
  const long = orf(2000, 150);
  assert.deepEqual(chooseMapOrfs([short, long], []).map(o => o.start), [2000]);
  // And the floor is adjustable.
  assert.equal(chooseMapOrfs([short, long], [], { minAa: 30 }).length, 2);
});

test('annotated ORFs can be asked for, and are marked when they come', () => {
  const o = orf(100, 200);
  const f = feat('AmpR', 90, 720);
  const drawn = chooseMapOrfs([o], [f], { includeAnnotated: true });
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].coveredBy, 'AmpR');
  assert.match(orfTitle(drawn[0]), /Already annotated as AmpR/);
});

test('the longest survive the ceiling, since they are likeliest to be genes', () => {
  const many = Array.from({ length: 40 }, (_, i) => orf(i * 1000, 100 + i));
  const drawn = chooseMapOrfs(many, [], { maxOrfs: 5 });
  assert.equal(drawn.length, 5);
  assert.deepEqual(drawn.map(o => o.aaLength), [139, 138, 137, 136, 135]);
});

test('each frame keeps its own colour, and the six are distinct', () => {
  const colours = [1, 2, 3, -1, -2, -3].map(frameColour);
  assert.equal(new Set(colours).size, 6, 'two frames sharing a colour is a map that cannot be read');
  assert.equal(frameColour(1), frameColour(1));
});

test('the summary separates what is drawn from what was found', () => {
  const orfs = [
    orf(100, 200),                       // annotated
    orf(2000, 150),                      // not annotated
    orf(3000, 20),                       // too short
    orf(4000, 300, { strand: '-', frame: -2 }),  // not annotated, other strand
  ];
  const features = [feat('AmpR', 90, 720)];
  const s = summariseOrfs(orfs, features);

  assert.equal(s.total, 4, 'everything the scan found');
  assert.equal(s.annotated, 1);
  assert.equal(s.unannotated, 2, 'long enough and with nothing drawn over them');
  assert.equal(s.drawn, 2);
});

test('an ORF and its title carry the frame, which answers "is it in frame"', () => {
  const [o] = chooseMapOrfs([orf(100, 200, { frame: -2, strand: '-' })], []);
  assert.equal(o.frame, -2);
  assert.match(orfTitle(o), /Frame -2/);
  const [p] = chooseMapOrfs([orf(100, 200, { frame: 3 })], []);
  assert.match(orfTitle(p), /Frame \+3/);
});

test('nothing found gives nothing, not a crash', () => {
  assert.deepEqual(chooseMapOrfs([], []), []);
  assert.deepEqual(summariseOrfs([], []), { drawn: 0, annotated: 0, unannotated: 0, shadows: 0, total: 0 });
});

test('a frame opposite an annotated gene is called a shadow, not unannotated', () => {
  // Found by planting one unannotated ORF and getting a badge saying three:
  // the extras were reverse-strand frames over DNA already annotated on the
  // forward strand. Real coding sequence usually carries stops on its reverse
  // strand, so these are most often shadows — and sending someone hunting for
  // a gene that is the other strand of one they have is worse than silence.
  const forward = feat('knownCDS', 301, 1056, { strand: 1 });
  const shadow = orf(280, 260, { strand: '-', frame: -1 });

  const [drawn] = chooseMapOrfs([shadow], [forward]);
  assert.equal(drawn.coveredBy, null, 'nothing annotated on its own strand');
  assert.equal(drawn.oppositeTo, 'knownCDS');
  assert.match(orfTitle(drawn), /lies opposite knownCDS/);

  // It is still drawn — antisense genes exist — but the badge does not count it.
  const s = summariseOrfs([shadow], [forward]);
  assert.equal(s.shadows, 1);
  assert.equal(s.unannotated, 0, 'the badge must not send anyone hunting for a shadow');
  assert.equal(s.drawn, 1);
});

test('a genuinely unannotated frame is still counted and drawn', () => {
  const elsewhere = feat('knownCDS', 301, 1056);
  const real = orf(2000, 200);
  const s = summariseOrfs([real], [elsewhere]);
  assert.equal(s.unannotated, 1);
  assert.equal(s.shadows, 0);
  assert.equal(chooseMapOrfs([real], [elsewhere])[0].oppositeTo, null);
});
