import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { topoCloning, TOPO_METHODS, DIRECTIONAL_TAG } from '../src/lib/topo.ts';
import { revComp } from '../src/lib/alignment.ts';

const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  let out = '';
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out += 'ACGT'[(x >>> 16) % 4]; }
  return out;
};

const insert = { name: 'PCR product', sequence: filler(1, 800) };
const vector = { name: 'pCR2.1', sequence: filler(2, 3900) };

describe('TA cloning', () => {
  test('the insert goes in, and the product is the two lengths plus the A:T pairs', () => {
    const r = topoCloning(insert, vector, 'ta');
    assert.deepEqual(r.problems, []);
    assert.ok(r.orientations.length > 0);
    // Two junctions, each contributing one shared base.
    assert.equal(r.orientations[0].assembly.sequence.length, 800 + 3900 + 2);
  });

  test('both orientations form, and that is the method rather than a fault', () => {
    const r = topoCloning(insert, vector, 'ta');
    assert.equal(r.orientations.length, 2, `got ${r.orientations.length} orientations`);
    assert.deepEqual(
      r.orientations.map(o => o.sense).sort(),
      ['forward', 'reverse'],
    );
    assert.ok(
      r.notes.some(n => /screen colonies/.test(n)),
      'the user should be told to screen, not warned that something broke',
    );
  });

  test('the two orientations really are different molecules', () => {
    const r = topoCloning(insert, vector, 'ta');
    const [a, b] = r.orientations.map(o => o.assembly.sequence);
    assert.notEqual(a, b);
    // The reverse-sense product carries the insert the other way round.
    const rev = r.orientations.find(o => o.sense === 'reverse')!.assembly.sequence;
    const doubled = rev + rev;
    assert.ok(
      doubled.includes(revComp(insert.sequence)),
      'the reverse orientation should contain the reverse complement of the insert',
    );
  });

  test('the vector is present in both orientations', () => {
    const r = topoCloning(insert, vector, 'ta');
    for (const o of r.orientations) {
      const doubled = o.assembly.sequence + o.assembly.sequence;
      assert.ok(
        doubled.includes(vector.sequence) || doubled.includes(revComp(vector.sequence)),
        `${o.sense}: vector missing`,
      );
    }
  });

  test('the polymerase assumption is stated', () => {
    const r = topoCloning(insert, vector, 'ta');
    assert.ok(
      r.notes.some(n => /proofreading/.test(n)),
      'a Phusion product will not TA clone, and that has to be said before someone tries',
    );
  });
});

describe('TOPO TA', () => {
  test('it behaves as TA does, because the geometry is the same', () => {
    const ta = topoCloning(insert, vector, 'ta');
    const topo = topoCloning(insert, vector, 'topo-ta');
    assert.equal(topo.orientations.length, ta.orientations.length);
    assert.equal(
      topo.orientations[0].assembly.sequence.length,
      ta.orientations[0].assembly.sequence.length,
    );
    assert.match(topo.spec.note, /topoisomerase/i);
  });
});

describe('blunt TOPO', () => {
  test('blunt ends join only because this method allows it', () => {
    const r = topoCloning(insert, vector, 'topo-blunt');
    assert.deepEqual(r.problems, []);
    assert.ok(r.orientations.length > 0);
    // Nothing is shared at a blunt join, so the product is just the two lengths.
    assert.equal(r.orientations[0].assembly.sequence.length, 800 + 3900);
  });

  test('it is still not directional', () => {
    const r = topoCloning(insert, vector, 'topo-blunt');
    assert.equal(r.spec.directional, false);
    assert.ok(r.orientations.length > 1, 'a blunt join has no preference either');
  });
});

describe('directional TOPO', () => {
  const tagged = { name: 'CACC-product', sequence: DIRECTIONAL_TAG + filler(3, 800) };

  test('a tagged insert goes in one way only', () => {
    const r = topoCloning(tagged, vector, 'topo-directional');
    assert.deepEqual(r.problems, []);
    assert.equal(r.orientations.length, 1, `got ${r.orientations.length} orientations`);
    assert.equal(r.orientations[0].sense, 'forward');
  });

  test('an untagged insert is refused with the reason', () => {
    const r = topoCloning(insert, vector, 'topo-directional');
    assert.ok(r.problems.some(p => new RegExp(DIRECTIONAL_TAG).test(p)), r.problems.join(' | '));
  });

  test('the point of the tag is stated, not just required', () => {
    const r = topoCloning(insert, vector, 'topo-directional');
    assert.ok(
      r.problems.some(p => /either orientation/.test(p)),
      'saying what goes wrong without it is more use than saying it is missing',
    );
  });

  test('an untagged insert is shown behaving as it really would', () => {
    // The warning says it clones in either orientation. Showing a single
    // product alongside that would contradict it.
    const r = topoCloning(insert, vector, 'topo-directional');
    assert.equal(r.orientations.length, 2, `got ${r.orientations.length}`);
    assert.deepEqual(r.orientations.map(o => o.sense).sort(), ['forward', 'reverse']);
  });
});

describe('inputs', () => {
  test('an empty insert or vector is a stated problem', () => {
    const r = topoCloning({ name: 'x', sequence: '' }, vector, 'ta');
    assert.equal(r.orientations.length, 0);
    assert.ok(r.problems.length > 0);
  });

  test('every method describes what the vector presents', () => {
    for (const spec of Object.values(TOPO_METHODS)) {
      assert.ok(spec.vectorEnd.length > 4, `${spec.name} does not say what its ends are`);
      assert.ok(spec.note.length > 20);
    }
  });
});
