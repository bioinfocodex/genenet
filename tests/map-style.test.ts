import test from 'node:test';
import assert from 'node:assert/strict';
import { labelInk, shapeFor, isSolid, estimateTextWidth } from '../src/lib/map-style.ts';

/** WCAG contrast ratio, computed independently of the module under test. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = n.map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('a label on a dark fill is white, on a light fill is not', () => {
  // Blue, red and pink clear 3:1 in white and keep it -- that is the look the
  // map already had. Amber, lime, cyan and green do not, and those are exactly
  // the fills that were being written on in white at 2:1 or less.
  assert.equal(labelInk('#3b82f6'), '#ffffff');   // blue   -- CDS
  assert.equal(labelInk('#ef4444'), '#ffffff');   // red    -- terminator
  assert.equal(labelInk('#a855f7'), '#ffffff');   // purple -- rep_origin
  assert.equal(labelInk('#ec4899'), '#ffffff');   // pink   -- primer_bind

  assert.equal(labelInk('#f59e0b'), '#0f172a');   // amber  -- promoter
  assert.equal(labelInk('#a3e635'), '#0f172a');   // lime   -- UTR
  assert.equal(labelInk('#06b6d4'), '#0f172a');   // cyan   -- RBS
  assert.equal(labelInk('#22c55e'), '#0f172a');   // green  -- gene
});

test('every colour the palette hands out is legible in the ink it gets', () => {
  // The point of the rule, stated as the property rather than the cases: no
  // feature ends up with a name at less than 3:1 against its own fill.
  const palette = [
    '#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4',
    '#f97316', '#ec4899', '#a3e635', '#94a3b8', '#8b5cf6',
  ];
  for (const fill of palette) {
    const ink = labelInk(fill);
    assert.ok(contrast(fill, ink) >= 3, `${fill} on ${ink} is ${contrast(fill, ink).toFixed(2)}:1`);
  }
});

test('colour notations a feature can actually carry all parse', () => {
  assert.equal(labelInk('#fff'), '#0f172a');
  assert.equal(labelInk('#FFFFFF'), '#0f172a');
  assert.equal(labelInk('#000000ff'), '#ffffff');
  assert.equal(labelInk('rgb(15, 23, 42)'), '#ffffff');
  // Unparseable is not a reason to write nothing: white is what it always was.
  assert.equal(labelInk('var(--accent-blue)'), '#ffffff');
});

test('a promoter, a terminator and an origin are not drawn as coding sequences', () => {
  assert.equal(shapeFor('CDS'), 'arrow');
  assert.equal(shapeFor('gene'), 'arrow');
  assert.equal(shapeFor('promoter'), 'promoter');
  assert.equal(shapeFor('enhancer'), 'promoter');
  assert.equal(shapeFor('terminator'), 'terminator');
  assert.equal(shapeFor('rep_origin'), 'origin');
  assert.equal(shapeFor('tag'), 'block');
});

test('an unknown type is a block, not a guess at direction', () => {
  assert.equal(shapeFor('some_vendor_type'), 'block');
  assert.equal(shapeFor(undefined), 'block');
  assert.equal(shapeFor(''), 'block');
});

test('only the solid shapes fill their track', () => {
  assert.equal(isSolid('arrow'), true);
  assert.equal(isSolid('block'), true);
  assert.equal(isSolid('promoter'), false);
  assert.equal(isSolid('terminator'), false);
  assert.equal(isSolid('origin'), false);
});

test('estimated width tracks what is actually wider', () => {
  const f = 10;
  assert.ok(estimateTextWidth('WWWW', f) > estimateTextWidth('llll', f));
  assert.ok(estimateTextWidth('AmpR promoter', f) > estimateTextWidth('AmpR', f));
  assert.equal(estimateTextWidth('', f), 0);
  // A 4-character name at font-size 9 has to fit in a 40px arrow, or the
  // caller will push every label outside and the map fills with leader lines.
  assert.ok(estimateTextWidth('AmpR', 9) < 40);
});
