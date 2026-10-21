import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOligo, validateOligo, oligoStats, findDuplicate, parseOligoList,
  bindingsInLibrary, collectionOnTemplate, planPrimerImport,
} from '../src/lib/oligos.ts';
import { revComp } from '../src/lib/alignment.ts';
import { nextCode } from '../src/lib/fields.ts';

function dna(length: number, seed: number): string {
  let state = seed;
  let s = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    s += 'ACGT'[(state >> 16) & 3];
  }
  return s;
}

const M13F = 'GTAAAACGACGGCCAGT';

describe('an oligo record', () => {
  test('sequence is cleaned of case, RNA bases and decoration', () => {
    assert.equal(cleanOligo("5'-gua aaa cga-3'"), 'GTAAAACGA');
  });

  test('too short or too long is refused with a reason', () => {
    assert.match(validateOligo('ACGT')!, /at least 8/);
    assert.match(validateOligo('A'.repeat(300))!, /fragment/);
    assert.equal(validateOligo(M13F), null);
  });

  test('stats are length, GC and nearest-neighbour Tm', () => {
    const s = oligoStats(M13F);
    assert.equal(s.length, 17);
    assert.equal(s.gc, 52.9);
    assert.ok(s.tm > 45 && s.tm < 60, `Tm ${s.tm}`);
  });

  test('the same sequence is a duplicate whatever its case; the reverse complement is not', () => {
    const existing = [{ code: 'OL-001', sequence: M13F }];
    assert.equal(findDuplicate(M13F.toLowerCase(), existing)?.code, 'OL-001');
    assert.equal(findDuplicate(revComp(M13F), existing), undefined);
  });

  test('codes continue from the highest issued, so a deleted code is never reused', () => {
    assert.equal(nextCode('OL', ['OL-001', 'OL-007', 'OL-003']), 'OL-008');
  });
});

describe('pasting a list', () => {
  test('tab-separated rows from a spreadsheet, header skipped, notes kept', () => {
    const { rows, problems } = parseOligoList(
      'Name\tSequence\tNotes\nM13F\tGTAAAACGACGGCCAGT\tuniversal\nT7\tTAATACGACTCACTATAGGG\n',
    );
    assert.deepEqual(problems, []);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { name: 'M13F', sequence: M13F, notes: 'universal' });
    assert.equal(rows[1].notes, undefined);
  });

  test("commas and 5'-...-3' decoration are understood", () => {
    const { rows } = parseOligoList("SP6, 5'-ATTTAGGTGACACTATAG-3'");
    assert.equal(rows[0].sequence, 'ATTTAGGTGACACTATAG');
  });

  test('bad lines are reported by line number and the good ones kept', () => {
    const { rows, problems } = parseOligoList('ok\tGTAAAACGACGGCCAGT\nshort\tACG\nnonsense\tHELLOWORLDXX\nlonely');
    assert.equal(rows.length, 1);
    assert.deepEqual(problems.map(p => p.line), [2, 3, 4]);
  });
});

describe('where an oligo binds', () => {
  const backbone = dna(2000, 1);
  const withSite = backbone.slice(0, 600) + M13F + backbone.slice(600);
  const library = [
    { id: 'a', name: 'pA', sequence: withSite, circular: true },
    { id: 'b', name: 'pB-reverse', sequence: dna(800, 2) + revComp(M13F) + dna(800, 3), circular: false },
    { id: 'c', name: 'unrelated', sequence: dna(1500, 4), circular: true },
  ];

  test('every sequence it anneals to, in either orientation, and none it does not', () => {
    const hits = bindingsInLibrary(M13F, library);
    assert.deepEqual(hits.map(h => h.sequenceId).sort(), ['a', 'b']);
    const a = hits.find(h => h.sequenceId === 'a')!;
    assert.equal(a.sites[0].start, 600);
    assert.equal(a.sites[0].strand, 'forward');
    assert.equal(hits.find(h => h.sequenceId === 'b')!.sites[0].strand, 'reverse');
  });

  test('a tailed oligo is found by its 3′ end, and exact matches rank first', () => {
    const tailed = 'GGGGACAAGTTTGTACAAAAAAGCAGGCT' + M13F; // an attB1 tail
    const lib = [...library, { id: 'd', name: 'pD-attB', sequence: dna(300, 5) + tailed + dna(300, 6), circular: false }];
    const hits = bindingsInLibrary(tailed, lib);
    assert.equal(hits[0].sequenceId, 'd', 'the full-length match ranks first');
    assert.ok(hits[0].exact);
    const a = hits.find(h => h.sequenceId === 'a')!;
    assert.equal(a.exact, false);
    assert.equal(a.sites[0].tailLength, 29);
  });

  test('a site across the origin of a plasmid is found', () => {
    const plasmid = M13F.slice(9) + dna(1200, 7) + M13F.slice(0, 9);
    const hits = bindingsInLibrary(M13F, [{ id: 'o', name: 'origin', sequence: plasmid, circular: true }]);
    assert.equal(hits.length, 1);
    assert.ok(hits[0].sites[0].wrapsOrigin);
  });

  test('the collection placed on one template, in order along it', () => {
    const t7 = 'TAATACGACTCACTATAGGG';
    const template = dna(400, 8) + M13F + dna(400, 9) + revComp(t7) + dna(100, 10);
    const sites = collectionOnTemplate(
      [
        { id: '1', code: 'OL-002', name: 'T7', sequence: t7 },
        { id: '2', code: 'OL-001', name: 'M13F', sequence: M13F },
        { id: '3', code: 'OL-003', name: 'nowhere', sequence: dna(20, 11) },
      ],
      template,
      false,
    );
    assert.deepEqual(sites.map(s => s.code), ['OL-001', 'OL-002']);
    assert.equal(sites[1].strand, 'reverse');
  });
});

describe('filing the primers saved on sequences', () => {
  const row = (name: string, sequence: string, sequenceName: string, notes: string | null = null) =>
    ({ name, sequence, notes, sequenceName });

  test('one oligo per distinct sequence, saying where it was used', () => {
    const plan = planPrimerImport(
      [row('M13F', M13F, 'pA'), row('m13 fwd', M13F.toLowerCase(), 'pB', 'universal'), row('T7', 'TAATACGACTCACTATAGGG', 'pA')],
      [],
    );
    assert.equal(plan.add.length, 2);
    const m13 = plan.add.find(a => a.sequence === M13F)!;
    assert.equal(m13.name, 'M13F', 'named after the first primer that had it');
    assert.match(m13.notes, /universal/);
    assert.match(m13.notes, /Saved on: pA, pB/);
  });

  test('what the collection already holds is reported by code, not copied', () => {
    const plan = planPrimerImport([row('M13F', M13F, 'pA')], [{ code: 'OL-004', sequence: M13F }]);
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.existing, [{ name: 'M13F', code: 'OL-004' }]);
  });

  test('a primer too short to be an oligo is reported, not filed', () => {
    const plan = planPrimerImport([row('stub', 'ACGT', 'pA')], []);
    assert.equal(plan.add.length, 0);
    assert.match(plan.invalid[0].reason, /at least 8/);
    assert.match(plan.invalid[0].name, /pA/);
  });

  test('running it again after filing adds nothing', () => {
    const first = planPrimerImport([row('M13F', M13F, 'pA')], []);
    const filed = first.add.map((a, i) => ({ code: `OL-00${i + 1}`, sequence: a.sequence }));
    assert.deepEqual(planPrimerImport([row('M13F', M13F, 'pA')], filed).add, []);
  });
});
