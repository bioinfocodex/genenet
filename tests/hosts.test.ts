import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAB_HOSTS, TRANSFORMATION_STRAINS, findHost, findStrain, strainSummary, carriesMethylation,
} from '../src/lib/hosts.ts';

test('every host and strain id is unique, because the id is what gets stored', () => {
  const hostIds = LAB_HOSTS.flatMap(g => g.organisms.map(o => o.id));
  assert.equal(new Set(hostIds).size, hostIds.length);

  // Strains may appear under two headings -- EPI300 is both restriction
  // deficient and a library strain -- but each entry needs its own id, or
  // choosing one from the second heading stores the first one's meaning.
  const strainIds = TRANSFORMATION_STRAINS.flatMap(g => g.strains.map(s => s.id));
  assert.equal(new Set(strainIds).size, strainIds.length);
});

test('the five kingdoms are all present and none is empty', () => {
  assert.deepEqual(LAB_HOSTS.map(g => g.id), ['bacteria', 'fungi', 'insect', 'mammalian', 'plant']);
  for (const g of LAB_HOSTS) assert.ok(g.organisms.length > 0, g.id);
});

test('a stored id resolves back to its organism and its group', () => {
  const found = findHost('n-benthamiana');
  assert.equal(found?.organism.name, 'Nicotiana benthamiana');
  assert.equal(found?.group.id, 'plant');
  assert.equal(findHost('not-a-host'), null);
  assert.equal(findHost(null), null);
});

test('the Dam/Dcm strains are recorded as Dam− Dcm−, which is the point of them', () => {
  for (const id of ['jm110', 'inv110']) {
    const s = findStrain(id);
    assert.equal(s?.strain.methylation.dam, false, id);
    assert.equal(s?.strain.methylation.dcm, false, id);
  }
  // And the ordinary cloning strains are not, which is why the digest fails.
  assert.equal(findStrain('dh5a')?.strain.methylation.dam, true);
});

test('the Mcr/Mrr strains are marked as accepting methylated DNA', () => {
  for (const id of ['dh10b', 'top10', 'dh12s', 'epi300']) {
    assert.equal(findStrain(id)?.strain.methylation.incoming, 'deficient', id);
  }
  assert.equal(findStrain('dh5a')?.strain.methylation.incoming, 'restricting');
});

test('carriesMethylation answers what the digest warning has been guessing', () => {
  assert.equal(carriesMethylation('dh5a', 'dam'), true);
  assert.equal(carriesMethylation('jm110', 'dam'), false);
  assert.equal(carriesMethylation('jm110', 'dcm'), false);
  // An unrecorded strain keeps the old, cautious assumption rather than
  // quietly promising the DNA is clean.
  assert.equal(carriesMethylation(null, 'dam'), true);
  assert.equal(carriesMethylation('something-someone-typed', 'dam'), true);
});

test('a strain reads as its name and its marks', () => {
  assert.equal(strainSummary('jm110'), 'JM110 — Dam− Dcm−');
  assert.equal(strainSummary('dh5a'), 'DH5α — Dam+ Dcm+');
  assert.equal(strainSummary('top10'), 'TOP10 — Dam+ Dcm+ McrBC−');
  assert.equal(strainSummary(null), null);
});

test('every strain carries the genotype that explains why it exists', () => {
  for (const g of TRANSFORMATION_STRAINS) {
    for (const s of g.strains) {
      assert.ok(s.genotype && s.genotype.length > 0, `${s.id} needs a genotype`);
      assert.ok(s.use && s.use.length > 0, `${s.id} needs a stated use`);
    }
  }
});

test('the non-E. coli strains say what species they are', () => {
  const group = TRANSFORMATION_STRAINS.find(g => g.id === 'non-ecoli')!;
  for (const s of group.strains) assert.ok(s.species, s.id);
});
