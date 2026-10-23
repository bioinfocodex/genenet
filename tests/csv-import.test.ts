import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, parseTable, sniffDelimiter, matchColumns, normaliseHeader,
  csvField, toCsv, type ColumnSpec,
} from '../src/lib/csv.ts';
import {
  planSampleImport, sampleTemplate, describeSample, SAMPLE_COLUMNS,
} from '../src/lib/sample-import.ts';
import { parseConcentration, formatConcentration } from '../src/lib/quantities.ts';

describe('reading the file a spreadsheet actually wrote', () => {
  test('a plain file', () => {
    const { rows } = parseCsv('a,b,c\n1,2,3\n');
    assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('the byte order mark Excel puts on a UTF-8 CSV is not part of the first column', () => {
    // Without this the first header is "﻿Name" and matches nothing, which
    // looks like the file having the wrong columns.
    const t = parseTable('﻿Name,Box\npUC19,B2\n');
    assert.deepEqual(t.header, ['Name', 'Box']);
  });

  test('CRLF is one line break and so is a lone CR', () => {
    assert.equal(parseCsv('a,b\r\n1,2\r\n').rows.length, 2);
    assert.equal(parseCsv('a,b\r1,2\r').rows.length, 2);
  });

  test('a trailing newline does not make an empty row', () => {
    assert.equal(parseCsv('a\n1\n').rows.length, 2);
    assert.equal(parseCsv('a\n1').rows.length, 2);
  });

  test('a quoted field may hold the delimiter, a quote, or a line break', () => {
    const { rows } = parseCsv('name,note\n"Smith, J.","he said ""no""\nand left"\n');
    assert.deepEqual(rows[1], ['Smith, J.', 'he said "no"\nand left']);
  });

  test('an empty field stays empty rather than disappearing', () => {
    assert.deepEqual(parseCsv('a,,c').rows[0], ['a', '', 'c']);
    assert.deepEqual(parseCsv('a,b,').rows[0], ['a', 'b', '']);
  });
});

describe('which separator the file uses', () => {
  test('commas, semicolons and tabs', () => {
    // Excel writes semicolons wherever the system list separator is one, which
    // is most of continental Europe, and still calls the file .csv. Read with
    // a comma it is one column wide and looks empty rather than mis-split.
    assert.equal(sniffDelimiter('Name,Box,Position\n'), ',');
    assert.equal(sniffDelimiter('Name;Box;Position\n'), ';');
    assert.equal(sniffDelimiter('Name\tBox\tPosition\n'), '\t');
  });

  test('a semicolon file parses into real columns', () => {
    const t = parseTable('Name;Box;Amount\npUC19;B2;50 uL\n');
    assert.deepEqual(t.header, ['Name', 'Box', 'Amount']);
    assert.deepEqual(t.rows[0].cells, ['pUC19', 'B2', '50 uL']);
    assert.equal(t.delimiter, ';');
  });

  test('a quoted header does not make a comma look like a separator', () => {
    assert.equal(sniffDelimiter('"Name, full";Box\n'), ';');
  });

  test('one column with no separator at all still reads', () => {
    const t = parseTable('Name\npUC19\npET28a\n');
    assert.deepEqual(t.header, ['Name']);
    assert.equal(t.rows.length, 2);
  });
});

describe('rows that do not fit the header', () => {
  test('a row with an extra field is reported, not shifted', () => {
    // Usually an unquoted comma. Shifting every column after it would put a
    // freezer name in the concentration, silently.
    const t = parseTable('Name,Box\npUC19,B2\nSmith, J.,B3\n');
    assert.deepEqual(t.ragged, [{ line: 3, got: 3 }]);
    assert.equal(t.rows.length, 2, 'it is still offered, with the warning');
  });

  test('a blank line in the middle is skipped rather than counted', () => {
    const t = parseTable('Name,Box\npUC19,B2\n\n,\npET28a,B3\n');
    assert.equal(t.rows.length, 2);
    assert.deepEqual(t.ragged, []);
  });
});

describe('matching columns to fields', () => {
  const specs: ColumnSpec[] = [
    { field: 'name', label: 'Name', aliases: ['label'], required: true },
    { field: 'box', label: 'Box', aliases: [] },
  ];

  test('spelling, case and punctuation do not matter', () => {
    assert.equal(normaliseHeader('Sample ID'), 'sampleid');
    assert.equal(normaliseHeader('sample_id'), 'sampleid');
    assert.equal(normaliseHeader('SampleID'), 'sampleid');
  });

  test('an alias matches', () => {
    const m = matchColumns(['Label', 'Box'], specs);
    assert.equal(m.mapping.name, 0);
    assert.equal(m.mapping.box, 1);
  });

  test('a column nothing reads is reported rather than ignored', () => {
    // Usually a column somebody expected to be read.
    const m = matchColumns(['Name', 'Freezer temperature'], specs);
    assert.deepEqual(m.unmatched, ['Freezer temperature']);
  });

  test('a missing required column is named', () => {
    const m = matchColumns(['Box'], specs);
    assert.deepEqual(m.missing.map(s => s.label), ['Name']);
  });

  test('one column cannot fill two fields', () => {
    const two: ColumnSpec[] = [
      { field: 'name', label: 'Name', aliases: ['thing'] },
      { field: 'other', label: 'Other', aliases: ['thing'] },
    ];
    const m = matchColumns(['Thing'], two);
    assert.equal(Object.keys(m.mapping).length, 1);
  });
});

describe('what importing a box of tubes would do', () => {
  const header = 'Sample ID,Name,Type,Freezer,Box,Position,Amount,Concentration\n';

  test('a clean file creates every row', () => {
    const plan = planSampleImport(
      header
      + 'PLA-001,pEGFP-N1,Plasmid,Minus 20,B2,A1,50 uL,200 ng/uL\n'
      + 'PLA-002,pET28a,Plasmid,Minus 20,B2,A2,45 uL,180 ng/uL\n',
      new Set(),
    );
    assert.equal(plan.counts.create, 2);
    assert.equal(plan.counts.reject, 0);
    const first = plan.rows[0].value!;
    assert.equal(first.name, 'pEGFP-N1');
    assert.equal(first.type, 'PLASMID');
    assert.equal(first.amount, 50);
    assert.equal(first.amountUnit, 'uL');
    assert.equal(first.concValue, 200);
    assert.equal(first.concPer, 'ng');
  });

  test('a code that already exists is an update, and says so', () => {
    const plan = planSampleImport(header + 'PLA-001,pEGFP-N1,Plasmid,,,,,\n', new Set(['PLA-001']));
    assert.equal(plan.counts.update, 1);
    assert.match(plan.rows[0].notes[0], /exists and would be updated/);
  });

  test('the same code twice in one file is refused, with the line it is already on', () => {
    // Somebody pasted a block twice. Without this the second row silently
    // overwrites the first and the import reports two successes.
    const plan = planSampleImport(
      header + 'PLA-001,A,Plasmid,,,,,\n' + 'PLA-001,B,Plasmid,,,,,\n',
      new Set(),
    );
    assert.equal(plan.counts.create, 1);
    assert.equal(plan.counts.reject, 1);
    assert.match(plan.rows[1].notes[0], /already on line 2/);
  });

  test('a row with no name is refused rather than imported as blank', () => {
    const plan = planSampleImport(header + 'PLA-009,,Plasmid,,,,,\n', new Set());
    assert.equal(plan.counts.reject, 1);
    assert.equal(plan.rows[0].notes[0], 'No name.');
  });

  test('the line number counts the header, so it matches the spreadsheet', () => {
    const plan = planSampleImport(header + 'PLA-001,A,Plasmid,,,,,\n' + ',,,,,,,\n' + 'PLA-003,C,Plasmid,,,,,\n', new Set());
    assert.deepEqual(plan.rows.map(r => r.line), [2, 4]);
  });

  test('an amount or concentration that is not one is refused with what to write instead', () => {
    const plan = planSampleImport(
      header
      + 'PLA-001,A,Plasmid,,,,half a tube,\n'
      + 'PLA-002,B,Plasmid,,,,50 uL,lots\n',
      new Set(),
    );
    assert.equal(plan.counts.reject, 2);
    assert.match(plan.rows[0].notes[0], /Try 50 µL/);
    assert.match(plan.rows[1].notes[0], /Try 200 ng\/µL/);
  });

  test('a position that is not a position is refused', () => {
    const plan = planSampleImport(header + 'PLA-001,A,Plasmid,,,ZZ9,,\n', new Set());
    assert.match(plan.rows[0].notes[0], /look like A1 or H12/);
    assert.equal(planSampleImport(header + 'PLA-001,A,Plasmid,,,h12,,\n', new Set()).rows[0].value!.position, 'H12');
  });

  test('an ambiguous date is refused rather than guessed', () => {
    // 03/04/2026 is two different days either side of the Atlantic, and an
    // expiry a year out is not a thing to guess at.
    const plan = planSampleImport('Name,Expires\npUC19,03/04/2026\n', new Set());
    assert.equal(plan.counts.reject, 1);
    assert.match(plan.rows[0].notes[0], /two different dates/);

    const iso = planSampleImport('Name,Expires\npUC19,2027-03-01\n', new Set());
    assert.equal(iso.counts.create, 1);
    assert.ok(iso.rows[0].value!.expiresAt!.startsWith('2027-03-01'));
  });

  test('the words a spreadsheet uses for a type are understood', () => {
    const plan = planSampleImport(
      'Name,Type\na,Plasmid\nb,glycerol stock\nc,Linear DNA\nd,PCR product\ne,\n',
      new Set(),
    );
    assert.deepEqual(plan.rows.map(r => r.value!.type), [
      'PLASMID', 'GLYCEROL_STOCK', 'LINEAR_DNA', 'LINEAR_DNA', 'OTHER',
    ]);
  });

  test('a type nobody recognises is refused rather than filed as OTHER', () => {
    const plan = planSampleImport('Name,Type\na,antibody\n', new Set());
    assert.equal(plan.counts.reject, 1);
  });

  test('a file with no name column refuses every row once, not silently', () => {
    const plan = planSampleImport('Box,Position\nB2,A1\n', new Set());
    assert.deepEqual(plan.missing.map(m => m.label), ['Name']);
    assert.equal(plan.counts.reject, 1);
  });

  test('a code a barcode cannot carry is refused at import rather than at the printer', () => {
    const plan = planSampleImport('Sample ID,Name\nPLA–001,A\n', new Set());
    assert.match(plan.rows[0].notes[0], /barcode cannot carry/);
  });

  test('a row without a code is a create, and cannot clash with anything', () => {
    const plan = planSampleImport('Name\na\nb\n', new Set());
    assert.equal(plan.counts.create, 2);
    assert.equal(plan.rows[0].key, undefined);
  });

  test('a box of eighty-one tubes comes through as eighty-one rows', () => {
    const rows = [];
    for (let i = 0; i < 81; i++) {
      const row = String.fromCharCode(65 + Math.floor(i / 9));
      rows.push(`CEL-${String(i + 1).padStart(3, '0')},clone ${i + 1},Glycerol stock,Minus 80,Box7,${row}${(i % 9) + 1},1 tube,`);
    }
    const plan = planSampleImport(header + rows.join('\n') + '\n', new Set());
    assert.equal(plan.counts.create, 81);
    assert.equal(plan.counts.reject, 0);
  });
});

describe('the template handed to somebody with no file', () => {
  test('it parses back into rows this reader accepts', () => {
    const plan = planSampleImport(sampleTemplate(), new Set());
    assert.equal(plan.counts.reject, 0);
    assert.equal(plan.counts.create, 2);
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(plan.unmatched, [], 'every column in the template is one that is read');
  });

  test('every column the reader knows appears in it', () => {
    const header = sampleTemplate().split('\r\n')[0];
    for (const spec of SAMPLE_COLUMNS) assert.ok(header.includes(spec.label), spec.label);
  });
});

describe('writing a file back out', () => {
  test('a field is quoted only when it has to be', () => {
    assert.equal(csvField('plain'), 'plain');
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "no"'), '"say ""no"""');
    assert.equal(csvField('two\nlines'), '"two\nlines"');
    assert.equal(csvField('a;b', ';'), '"a;b"');
    assert.equal(csvField('a;b', ','), 'a;b');
  });

  test('rows come back out of the parser the way they went in', () => {
    const header = ['Name', 'Note'];
    const rows = [['Smith, J.', 'he said "no"'], ['plain', '']];
    const parsed = parseTable(toCsv(header, rows));
    assert.deepEqual(parsed.header, header);
    assert.deepEqual(parsed.rows.map(r => r.cells), rows);
  });

  test('lines end CRLF, which is what Excel needs to see rows', () => {
    assert.ok(toCsv(['a'], [['1']]).includes('\r\n'));
  });
});

describe('describing a row for the preview', () => {
  test('it reads as the tube it is', () => {
    const plan = planSampleImport(
      'Sample ID,Name,Freezer,Box,Position,Amount,Concentration\nPLA-001,pEGFP-N1,Minus 20,B2,A1,50 uL,200 ng/uL\n',
      new Set(),
    );
    assert.equal(describeSample(plan.rows[0].value!), 'pEGFP-N1 — 50 µL — 200 ng/µL — Minus 20 · B2 · A1');
  });
});

describe('reading a concentration off a tube', () => {
  test('mass over volume, in the forms people write', () => {
    assert.deepEqual(parseConcentration('200 ng/uL'), { value: 200, per: 'ng', volume: 'uL' });
    assert.deepEqual(parseConcentration('1.5mg/mL'), { value: 1.5, per: 'mg', volume: 'mL' });
    assert.deepEqual(parseConcentration('200 ng/µL'), { value: 200, per: 'ng', volume: 'uL' });
  });

  test('molar is accepted the way a bottle is labelled', () => {
    // Nobody writes "100 µmol/L" on a tube.
    assert.equal(formatConcentration(parseConcentration('100 uM')!), '100 µM');
    assert.equal(formatConcentration(parseConcentration('1 M')!), '1 M');
    assert.equal(formatConcentration(parseConcentration('10 nM')!), '10 nM');
  });

  test('nonsense is refused rather than part-read', () => {
    for (const bad of ['', 'lots', '200', 'ng/uL', '200 uL/ng', '200 ng/ng', '-']) {
      assert.equal(parseConcentration(bad), null, bad);
    }
  });
});
