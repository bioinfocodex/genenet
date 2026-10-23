import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detect, parseInstrumentFile, parsePlateGrid, parsePlateList,
  parseNanoDrop, parseQpcr, normaliseWell, summarise, asPlate,
} from '../src/lib/instruments.ts';

/*
 * The fixtures below are shaped like the real exports: a plate reader writes a
 * preamble and a grid, a NanoDrop writes a wide tab-separated table with the
 * units in brackets, a qPCR machine writes a long table keyed on well. They
 * are trimmed, not invented -- the awkward parts (the preamble, the comma
 * decimals, "Undetermined", OVRFLW) are the reason this module exists.
 */

const PLATE_GRID = `Software Version,5.02
Plate ID,PL-0094
Read,Absorbance 600
,1,2,3,4
A,0.082,0.079,1.204,0.081
B,0.085,OVRFLW,1.198,0.080
`;

const PLATE_LIST = `Well,Sample,OD600,OD450
A1,blank,0.082,0.011
A2,clone 1,0.902,0.233
B01,clone 2,0.887,0.221
`;

const NANODROP = `Sample ID\tUser ID\tDate\tNucleic Acid(ng/uL)\tA260\tA280\t260/280\t260/230
pUC19 prep\tjane\t2026-10-20\t248.3\t4.966\t2.611\t1.90\t2.21
gDNA\tjane\t2026-10-20\t58,7\t1.174\t0.643\t1.83\t1.55
`;

const QPCR = `Run,2026-10-20
Well,Fluor,Target,Sample,Cq
A1,SYBR,GAPDH,ctrl,18.42
A2,SYBR,GAPDH,treated,21.07
A3,SYBR,GAPDH,NTC,Undetermined
`;

describe('reading a well', () => {
  test('A1 and A01 and a1 are the same well', () => {
    assert.equal(normaliseWell('A1'), 'A1');
    assert.equal(normaliseWell('A01'), 'A1');
    assert.equal(normaliseWell(' a1 '), 'A1');
    assert.equal(normaliseWell('H12'), 'H12');
    assert.equal(normaliseWell('P24'), 'P24');
  });

  test('what is not a well', () => {
    for (const s of ['', 'Q1', 'A0', 'A25', 'AA1', '1A', 'blank']) {
      assert.equal(normaliseWell(s), null, s);
    }
  });
});

describe('guessing which instrument wrote a file', () => {
  test('each fixture is recognised', () => {
    assert.equal(detect(PLATE_GRID), 'plate-grid');
    assert.equal(detect(PLATE_LIST), 'plate-list');
    assert.equal(detect(NANODROP), 'nanodrop');
    assert.equal(detect(QPCR), 'qpcr');
  });

  test('something else is not forced into a format', () => {
    // Guessing wrong is worse than not guessing: it produces a table of
    // numbers that looks right and means something else.
    assert.equal(detect('Name,Box,Position\npUC19,B2,A1\n'), null);
    assert.equal(detect(''), null);
  });

  test('an unrecognised file says so rather than returning nothing', () => {
    const r = parseInstrumentFile('Name,Box\npUC19,B2\n');
    assert.deepEqual(r.readings, []);
    assert.match(r.problems[0], /does not look like/);
  });
});

describe('a plate drawn as a grid', () => {
  const r = parsePlateGrid(PLATE_GRID);

  test('wells come out with their numbers', () => {
    const plate = asPlate(r.readings, r.readings[0].measure);
    assert.equal(plate.get('A1'), 0.082);
    assert.equal(plate.get('A3'), 1.204);
    assert.equal(plate.get('B4'), 0.08);
  });

  test('the preamble is kept, because it holds the settings', () => {
    // The wavelength and the gain are the first things somebody asks about a
    // number they do not believe.
    assert.ok(r.preamble.some(p => /Software Version/.test(p)));
    assert.ok(r.preamble.some(p => /PL-0094/.test(p)));
  });

  test('the grid takes its name from the line above it', () => {
    assert.equal(r.readings[0].measure, 'Read Absorbance 600');
  });

  test('a well that overflowed is a reading with no number, not a missing well', () => {
    // A silently dropped well reads as a plate that was never that size.
    const over = r.readings.find(x => x.well === 'B2')!;
    assert.equal(over.value, null);
    assert.equal(over.extra?.raw, 'OVRFLW');
  });

  test('two grids in one file are both read, under their own names', () => {
    const two = PLATE_GRID + `
Read,Absorbance 450
,1,2,3
A,0.011,0.013,0.014
`;
    const out = parsePlateGrid(two);
    const measures = [...new Set(out.readings.map(x => x.measure))];
    assert.equal(measures.length, 2);
    assert.ok(measures.some(m => /600/.test(m)));
    assert.ok(measures.some(m => /450/.test(m)));
  });

  test('a grid shape with nothing in it says so', () => {
    const empty = parsePlateGrid(',1,2\nA,,\n');
    assert.match(empty.problems[0], /no numbers/);
  });
});

describe('a plate written one well per row', () => {
  const r = parsePlateList(PLATE_LIST);

  test('every value column becomes its own measurement', () => {
    assert.deepEqual([...new Set(r.readings.map(x => x.measure))], ['OD600', 'OD450']);
    assert.equal(r.readings.length, 6);
  });

  test('the sample name rides along', () => {
    assert.equal(r.readings.find(x => x.well === 'A2')!.sample, 'clone 1');
  });

  test('a padded well number is the same well', () => {
    assert.ok(r.readings.some(x => x.well === 'B1'), 'B01 reads as B1');
  });

  test('no Well column is a refusal, not an empty result', () => {
    assert.match(parsePlateList('Sample,OD600\nx,0.1\n').problems[0], /No column called Well/);
  });
});

describe('a NanoDrop export', () => {
  const r = parseNanoDrop(NANODROP);

  test('concentrations come out with the unit the header carried', () => {
    // A concentration with no unit is the thing this is trying to stop.
    const conc = r.readings.find(x => x.sample === 'pUC19 prep' && x.measure === 'Nucleic Acid')!;
    assert.equal(conc.value, 248.3);
    assert.equal(conc.unit, 'ng/uL');
  });

  test('the ratios are kept apart from each other', () => {
    const ratios = r.readings.filter(x => x.sample === 'pUC19 prep' && /260\//.test(x.measure));
    assert.deepEqual(ratios.map(x => [x.measure, x.value]), [['260/280', 1.9], ['260/230', 2.21]]);
  });

  test('a comma decimal is a decimal, which is what a European machine writes', () => {
    const conc = r.readings.find(x => x.sample === 'gDNA' && x.measure === 'Nucleic Acid')!;
    assert.equal(conc.value, 58.7);
  });

  test('dates and user names are not readings', () => {
    assert.equal(r.readings.some(x => x.measure === 'User ID'), false);
    assert.equal(r.readings.some(x => x.measure === 'Date'), false);
  });

  test('a file with no 260/280 is refused', () => {
    assert.match(parseNanoDrop('Sample,Value\nx,1\n').problems[0], /not a NanoDrop/);
  });
});

describe('a qPCR Cq table', () => {
  const r = parseQpcr(QPCR);

  test('each well gets its Cq, named by target', () => {
    const a1 = r.readings.find(x => x.well === 'A1')!;
    assert.equal(a1.value, 18.42);
    assert.equal(a1.measure, 'Cq (GAPDH)');
    assert.equal(a1.sample, 'ctrl');
  });

  test('an undetermined well is a reading with no number, because that is the result', () => {
    // A well that never crossed the threshold is a negative. Dropping it turns
    // a clean negative control into a well nobody ran.
    const ntc = r.readings.find(x => x.well === 'A3')!;
    assert.equal(ntc.value, null);
    assert.equal(ntc.extra?.raw, 'Undetermined');
    assert.equal(ntc.sample, 'NTC');
  });

  test('the run header above the table is not a reading', () => {
    assert.equal(r.readings.length, 3);
    assert.ok(r.preamble.some(p => /Run/.test(p)));
  });

  test('Ct is read as well as Cq, since the machines disagree', () => {
    const ct = parseQpcr('Well,Target,Ct\nA1,ACTB,22.1\n');
    assert.equal(ct.readings[0].value, 22.1);
  });

  test('the target names the reading, not the dye', () => {
    // A Bio-Rad table has Fluor before Target. Taking the first match names
    // every reading "Cq (SYBR)", which loses the one thing the target column
    // was carrying.
    const r2 = parseQpcr('Well,Fluor,Target,Cq\nA1,SYBR,ACTB,22.1\nA2,SYBR,GAPDH,19.0\n');
    assert.deepEqual(r2.readings.map(x => x.measure), ['Cq (ACTB)', 'Cq (GAPDH)']);
  });
});

describe('what is in the file', () => {
  test('a range per measurement, which answers "did it read what I think"', () => {
    const r = parsePlateList(PLATE_LIST);
    const s = summarise(r.readings).find(x => x.measure === 'OD600')!;
    assert.equal(s.count, 3);
    assert.equal(s.min, 0.082);
    assert.equal(s.max, 0.902);
    assert.equal(s.blank, 0);
  });

  test('blanks are counted apart from values', () => {
    const r = parsePlateGrid(PLATE_GRID);
    const s = summarise(r.readings)[0];
    assert.equal(s.blank, 1);
    assert.ok(s.min !== null, 'and the range is over the numbers that are there');
  });

  test('the unit is carried through to the summary', () => {
    const s = summarise(parseNanoDrop(NANODROP).readings).find(x => x.measure === 'Nucleic Acid')!;
    assert.equal(s.unit, 'ng/uL');
  });

  test('nothing in is nothing out', () => {
    assert.deepEqual(summarise([]), []);
    assert.equal(asPlate([], 'x').size, 0);
  });
});

describe('semicolon and tab files', () => {
  test('a plate list written with semicolons reads the same', () => {
    const semi = PLATE_LIST.replace(/,/g, ';');
    const r = parsePlateList(semi);
    assert.equal(r.readings.length, 6);
    assert.equal(r.readings.find(x => x.well === 'A2' && x.measure === 'OD600')!.value, 0.902);
  });

  test('detection works on the semicolon version too', () => {
    assert.equal(detect(PLATE_LIST.replace(/,/g, ';')), 'plate-list');
  });
});
