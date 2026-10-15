import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STYLE, defaultStyle, parseStyle, serialiseStyle, isDefaultStyle,
  featureLength, isDrawn, applyStyle, typesPresent, hiddenCount, legendRoles, enzymeOptions,
} from '../src/lib/map-display.ts';
import type { SequenceFeature } from '../src/lib/features.ts';

let n = 0;
const feat = (over: Partial<SequenceFeature> = {}): SequenceFeature => ({
  id: `f${++n}`,
  name: 'thing',
  start: 100,
  end: 400,
  color: '#7f7fff',
  type: 'CDS',
  strand: 1,
  ...over,
});

describe('reading a stored style', () => {
  test('nothing stored is the default, and no two reads share its arrays', () => {
    // Not pedantry. These are returned as `{...DEFAULT_STYLE}`-shaped objects,
    // and a spread copies an array by reference: hiding a type on one sequence
    // hid it on every sequence opened since, until the arrays were made fresh
    // per read and the shipped default frozen.
    const a = parseStyle(null);
    const b = parseStyle(undefined);
    assert.deepEqual(a, DEFAULT_STYLE);
    a.hiddenTypes.push('CDS');
    assert.deepEqual(b.hiddenTypes, [], 'each read gets its own arrays');
    assert.deepEqual(DEFAULT_STYLE.hiddenTypes, [], 'and the shipped default is untouched');
  });

  test('the shipped default cannot be edited by accident', () => {
    assert.ok(Object.isFrozen(DEFAULT_STYLE));
    assert.throws(() => (DEFAULT_STYLE.hiddenTypes as string[]).push('CDS'));
    const mine = defaultStyle();
    mine.hiddenTypes.push('CDS');
    assert.deepEqual(DEFAULT_STYLE.hiddenTypes, [], 'a copy of one own is editable, the default is not');
  });

  test('a style written by an older version keeps its own fields and defaults the rest', () => {
    const s = parseStyle('{"hiddenTypes":["misc_feature"],"orfs":true}');
    assert.deepEqual(s.hiddenTypes, ['misc_feature']);
    assert.equal(s.orfs, true);
    assert.equal(s.minSite, DEFAULT_STYLE.minSite);
    assert.equal(s.sites, DEFAULT_STYLE.sites);
  });

  test('keys this version does not know are dropped rather than carried', () => {
    const s = parseStyle('{"hiddenTypes":["RBS"],"ribbonWidth":9}') as unknown as Record<string, unknown>;
    assert.equal('ribbonWidth' in s, false);
    assert.deepEqual(s.hiddenTypes, ['RBS']);
  });

  test('one corrupt field costs only that field', () => {
    // The point of parsing field by field: the hidden types survive a label
    // size that is a string, where a wholesale reject would lose them.
    const s = parseStyle('{"hiddenTypes":["tag"],"maxCuts":"lots","minLength":null}');
    assert.deepEqual(s.hiddenTypes, ['tag']);
    assert.equal(s.maxCuts, DEFAULT_STYLE.maxCuts);
    assert.equal(s.minLength, DEFAULT_STYLE.minLength);
  });

  test('unparseable or wrongly shaped JSON is the default', () => {
    for (const raw of ['', 'not json', '[]', 'null', '"a string"', '7']) {
      assert.deepEqual(parseStyle(raw), DEFAULT_STYLE, `from ${JSON.stringify(raw)}`);
    }
  });

  test('a non-string in a list of types is dropped, and duplicates collapse', () => {
    const s = parseStyle('{"hiddenTypes":["CDS",7,null,"CDS",""]}');
    assert.deepEqual(s.hiddenTypes, ['CDS']);
  });

  test('numbers are clamped to a range that still draws something', () => {
    const wild = parseStyle('{"minLength":-10,"maxCuts":10000,"minSite":0}');
    assert.equal(wild.minLength, 0);
    assert.equal(wild.maxCuts, 99);
    assert.equal(wild.minSite, 1);
  });
});

describe('writing a style', () => {
  test('a style that departs from nothing stores nothing', () => {
    assert.equal(serialiseStyle(defaultStyle()), null);
    assert.ok(isDefaultStyle(defaultStyle()));
  });

  test('only the departures are stored, so the rest follows the default later', () => {
    const json = serialiseStyle({ ...defaultStyle(), orfs: true, hiddenTypes: ['misc_feature'] })!;
    assert.deepEqual(JSON.parse(json), { hiddenTypes: ['misc_feature'], orfs: true });
    assert.equal(json.includes('minSite'), false, 'an untouched field is not frozen into the record');
  });

  test('what is written reads back as what was written', () => {
    const style = {
      ...DEFAULT_STYLE,
      hiddenTypes: ['misc_feature', 'RBS'], hiddenIds: ['f9'],
      minLength: 60, sites: false, orfs: true, orfsAnnotated: true, primers: false,
      maxCuts: 3, minSite: 4, enzymes: ['BsaI', 'EcoRI'],
    };
    assert.deepEqual(parseStyle(serialiseStyle(style)), {
      ...style,
      // Lists are stored sorted, so two equivalent styles compare equal as text.
      hiddenTypes: ['RBS', 'misc_feature'],
    });
  });
});

describe('how long a feature is', () => {
  test('a plain feature is its own span, inclusive', () => {
    assert.equal(featureLength(feat({ start: 10, end: 19 })), 10);
    assert.equal(featureLength(feat({ start: 5, end: 5 })), 1);
  });

  test('a spliced feature is its exons, not the introns between them', () => {
    // A three-exon gene over 8 kb: 300 bases of coding, not 8,000.
    const f = feat({
      start: 1, end: 8000,
      segments: [{ start: 1, end: 100 }, { start: 4000, end: 4099 }, { start: 7901, end: 8000 }],
    });
    assert.equal(featureLength(f), 300);
  });

  test('a feature through the origin needs the molecule length, and is unbounded without it', () => {
    const f = feat({ start: 2900, end: 100 });
    assert.equal(featureLength(f, 3000), 201, '2900-3000 and 1-100');
    assert.equal(featureLength(f), Infinity, 'not a negative length, and not a guess');
  });
});

describe('what gets drawn', () => {
  const features = [
    feat({ type: 'CDS', name: 'AmpR', start: 100, end: 961 }),
    feat({ type: 'promoter', name: 'lac promoter', start: 1000, end: 1080 }),
    feat({ type: 'RBS', name: 'RBS', start: 1100, end: 1110 }),
    feat({ type: 'misc_feature', name: 'MCS', start: 1200, end: 1250 }),
    feat({ type: 'misc_feature', name: 'junk', start: 1300, end: 1308 }),
  ];

  test('by default everything is drawn', () => {
    const style = parseStyle(null);
    assert.equal(applyStyle(features, style).length, features.length);
    assert.equal(hiddenCount(features, style), 0);
  });

  test('a hidden type takes every feature of that type and nothing else', () => {
    const style = { ...defaultStyle(), hiddenTypes: ['misc_feature'] };
    const drawn = applyStyle(features, style);
    assert.deepEqual(drawn.map(f => f.name), ['AmpR', 'lac promoter', 'RBS']);
    assert.equal(hiddenCount(features, style), 2);
  });

  test('a hidden id takes one feature, whatever its type', () => {
    const style = { ...defaultStyle(), hiddenIds: [features[0].id] };
    assert.equal(applyStyle(features, style).some(f => f.name === 'AmpR'), false);
    assert.equal(applyStyle(features, style).length, 4);
  });

  test('a length floor takes the short clutter and leaves the real parts', () => {
    const style = { ...defaultStyle(), minLength: 50 };
    assert.deepEqual(applyStyle(features, style).map(f => f.name), ['AmpR', 'lac promoter', 'MCS']);
  });

  test('a feature acquired after the style was saved is drawn, not hidden', () => {
    // The reason exclusions are stored rather than inclusions. Annotation and
    // assembly both add types later, and a style listing what to show would
    // make each of them invisible without saying anything.
    const style = { ...defaultStyle(), hiddenTypes: ['misc_feature'] };
    const later = feat({ type: 'terminator', name: 'rrnB T1' });
    assert.ok(isDrawn(later, style));
  });

  test('the count of what is left out is counted the same way the drawing is', () => {
    const style = { ...defaultStyle(), hiddenTypes: ['RBS'], minLength: 50, hiddenIds: [features[1].id] };
    assert.equal(hiddenCount(features, style), features.length - applyStyle(features, style).length);
  });
});

describe('the controls the style is set from', () => {
  test('the types listed are the ones on this sequence, commonest first', () => {
    const features = [
      feat({ type: 'misc_feature' }), feat({ type: 'misc_feature' }), feat({ type: 'misc_feature' }),
      feat({ type: 'CDS' }), feat({ type: 'CDS' }),
      feat({ type: 'promoter' }),
    ];
    const rows = typesPresent(features, defaultStyle());
    assert.deepEqual(rows.map(r => [r.type, r.count]), [
      ['misc_feature', 3], ['CDS', 2], ['promoter', 1],
    ]);
    assert.ok(rows.every(r => !r.hidden));
    assert.equal(rows.some(r => r.type === 'terminator'), false, 'not the whole GenBank vocabulary');
  });

  test('a type with no name falls under one heading rather than an empty one', () => {
    const rows = typesPresent([feat({ type: '' }), feat({ type: '' })], defaultStyle());
    assert.deepEqual(rows.map(r => [r.type, r.count]), [['unclassified', 2]]);
  });

  test('a row says whether its type is currently hidden', () => {
    const rows = typesPresent([feat({ type: 'CDS' }), feat({ type: 'RBS' })], { ...defaultStyle(), hiddenTypes: ['RBS'] });
    assert.equal(rows.find(r => r.type === 'RBS')!.hidden, true);
    assert.equal(rows.find(r => r.type === 'CDS')!.hidden, false);
  });

  test('a legend lists the roles that are on the drawing and no others', () => {
    const drawn = [
      feat({ type: 'CDS', name: 'AmpR' }),
      feat({ type: 'promoter', name: 'lac promoter' }),
    ];
    const roles = legendRoles(drawn).map(r => r.role).sort();
    assert.deepEqual(roles, ['promoter', 'resistance']);
    assert.equal(legendRoles([]).length, 0);
  });
});

describe('how the style asks for restriction sites', () => {
  test('by default, the enzymes that cut once and have a six-base site', () => {
    const o = enzymeOptions(defaultStyle());
    assert.equal(o.maxCuts, 1);
    assert.equal(o.minSiteLength, 6);
    assert.equal(o.restrictTo, undefined);
  });

  test("the lab's working set narrows the automatic choice", () => {
    const o = enzymeOptions(defaultStyle(), ['EcoRI', 'BamHI']);
    assert.deepEqual(o.restrictTo, ['EcoRI', 'BamHI']);
    assert.equal(o.maxCuts, 1, 'and the filters still apply within it');
  });

  test('an empty working set is not a set, and does not hide every site', () => {
    assert.equal(enzymeOptions(defaultStyle(), []).restrictTo, undefined);
    assert.equal(enzymeOptions(defaultStyle(), null).restrictTo, undefined);
  });

  test('naming enzymes overrides the filters rather than being narrowed by them', () => {
    // AluI is a four-cutter that cuts a plasmid dozens of times: it fails both
    // defaults, which is exactly why somebody would have to name it.
    const o = enzymeOptions({ ...defaultStyle(), enzymes: ['AluI'], maxCuts: 1, minSite: 6 });
    assert.deepEqual(o.restrictTo, ['AluI']);
    assert.equal(o.maxCuts, Infinity);
    assert.equal(o.minSiteLength, 0);
  });

  test('named enzymes also outrank the working set, which they are not members of', () => {
    const o = enzymeOptions({ ...defaultStyle(), enzymes: ['BsaI'] }, ['EcoRI']);
    assert.deepEqual(o.restrictTo, ['BsaI']);
  });
});
