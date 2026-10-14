import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carryFeatures, type ParentAnnotation } from '../src/lib/carry-features.ts';
import type { SequenceFeature } from '../src/lib/features.ts';
import { revComp } from '../src/lib/alignment.ts';

function dna(length: number, seed: number): string {
  let state = seed;
  let s = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    s += 'ACGT'[(state >> 16) & 3];
  }
  return s;
}

const feat = (name: string, start: number, end: number, strand: 1 | -1 = 1): SequenceFeature =>
  ({ id: `${name}`, name, type: 'CDS', start, end, strand, color: '#000' });

const backbone = dna(1200, 3);
const insert = dna(600, 4);

const vector: ParentAnnotation = {
  name: 'pVec', circular: true, sequence: backbone,
  features: [feat('AmpR', 101, 700), feat('ori', 801, 1100, -1)],
};
const gene: ParentAnnotation = {
  name: 'geneX', sequence: insert,
  features: [feat('geneX', 51, 500)],
};

describe('carrying features into a product', () => {
  test('features of both parents land on the bases they describe', () => {
    const product = backbone + insert;
    const { features, lost } = carryFeatures(product, true, [vector, gene]);
    assert.deepEqual(lost, []);
    const by = Object.fromEntries(features.map(f => [f.name, f]));
    assert.equal(product.slice(by.AmpR.start - 1, by.AmpR.end), backbone.slice(100, 700));
    assert.equal(product.slice(by.geneX.start - 1, by.geneX.end), insert.slice(50, 500));
    assert.equal(by.geneX.start, backbone.length + 51);
  });

  test('a fragment reverse-complemented to fit carries its features flipped', () => {
    const product = backbone + revComp(insert);
    const { features } = carryFeatures(product, true, [vector, gene]);
    const g = features.find(f => f.name === 'geneX')!;
    assert.equal(g.strand, -1, 'the gene is on the other strand now');
    assert.equal(revComp(product.slice(g.start - 1, g.end)), insert.slice(50, 500));
  });

  test("a parent feature already on the minus strand comes back to plus when flipped", () => {
    const product = revComp(backbone);
    const { features } = carryFeatures(product, true, [vector]);
    assert.equal(features.find(f => f.name === 'ori')!.strand, 1);
    assert.equal(features.find(f => f.name === 'AmpR')!.strand, -1);
  });

  test('a feature the digest cut through is not carried, and is said to be lost', () => {
    // Only the first half of AmpR survives into the product.
    const product = backbone.slice(0, 400) + insert;
    const { features, lost } = carryFeatures(product, true, [vector, gene]);
    assert.ok(!features.some(f => f.name === 'AmpR'));
    assert.deepEqual(lost.map(l => [l.name, l.reason]), [['AmpR', 'not in the product'], ['ori', 'not in the product']]);
    assert.ok(features.some(f => f.name === 'geneX'), 'the intact one still comes across');
  });

  test('a feature across the origin of the product is found once', () => {
    // Rotate the product so AmpR straddles the join.
    const product = backbone.slice(400) + insert + backbone.slice(0, 400);
    const { features } = carryFeatures(product, true, [vector, gene]);
    const amp = features.find(f => f.name === 'AmpR')!;
    assert.ok(amp.end < amp.start, 'wrapped: end before start, as the viewer stores it');
    const wrapped = product.slice(amp.start - 1) + product.slice(0, amp.end);
    assert.equal(wrapped, backbone.slice(100, 700));
  });

  test('a part present twice is carried at both copies and reported', () => {
    const product = backbone + insert + backbone.slice(100, 700);
    const { features, duplicated } = carryFeatures(product, true, [vector, gene]);
    assert.equal(features.filter(f => f.name === 'AmpR').length, 2);
    assert.deepEqual(duplicated, [{ name: 'AmpR', copies: 2 }]);
  });

  test('the same part carried by two parents is one feature, not two stacked', () => {
    const second: ParentAnnotation = { name: 'pOther', circular: true, sequence: backbone, features: [feat('AmpR', 101, 700)] };
    const { features } = carryFeatures(backbone + insert, true, [vector, second]);
    assert.equal(features.filter(f => f.name === 'AmpR').length, 1);
  });

  test('a feature too short to place is reported rather than scattered', () => {
    const tiny: ParentAnnotation = { name: 'p', sequence: backbone, features: [feat('RBS', 1, 6)] };
    const { features, lost } = carryFeatures(backbone, false, [tiny]);
    assert.deepEqual(features, []);
    assert.equal(lost[0].reason, 'too short to place');
  });

  test('a spliced feature carried whole stops claiming to be spliced', () => {
    const spliced: ParentAnnotation = {
      name: 'p', sequence: backbone,
      features: [{ ...feat('gene', 101, 400), segments: [{ start: 101, end: 200 }, { start: 301, end: 400 }] }],
    };
    const { features } = carryFeatures(backbone, false, [spliced]);
    assert.equal(features[0].segments, undefined);
  });
});
