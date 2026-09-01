import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MolbuilderRenderer from '../src/components/sequences/MolbuilderRenderer.tsx';
import { placePrimers } from '../src/lib/primer-binding.ts';

/**
 * The regression this exists for.
 *
 * The primer layer read primer.start and primer.end, which SavedPrimer does
 * not have. Comparing undefined against a number is false, so the filter
 * always emptied and the layer drew nothing -- with no error, no warning, and
 * a passing typecheck, because the props were typed `any[]`.
 *
 * Unit-testing the coordinate maths would not have caught that: the maths was
 * never reached. So this renders the component and looks at the markup.
 */

//                 1         2         3         4         5         6
//        123456789012345678901234567890123456789012345678901234567890
const SEQ = 'ATGGCGAATTCCTTGGACCATGGTCCAAGGAATTCGCATTACGGCATGCATCCGGTATTAA';

const LAYERS = { feat: false, enz: false, primer: true, orf: false };

function render(primers: { name: string; sequence: string; direction: string }[]) {
  const withIds = primers.map((p, i) => ({ ...p, id: `p${i}` }));
  const drawable = placePrimers(withIds, SEQ).map(p => ({
    id: p.id, name: p.name,
    sequence: withIds.find(x => x.id === p.id)!.sequence,
    direction: p.strand, tm: 60, gcContent: 50,
    // placePrimers reports 0-indexed; the renderer draws 1-indexed inclusive.
    start: p.start + 1, end: p.end + 1,
  }));
  return renderToStaticMarkup(createElement(MolbuilderRenderer, {
    sequence: SEQ,
    features: [],
    primers: drawable,
    lineLen: 60,
    layers: LAYERS,
    frames: new Set<number>(),
    onSelect: () => {},
  } as never));
}

describe('the primer layer actually draws', () => {
  test('a forward primer is drawn, with its own marker', () => {
    const html = render([{ name: 'FwdOne', sequence: 'GGACCATGG', direction: 'forward' }]);
    assert.ok(html.includes('FwdOne'), 'the marker should name the primer');
    assert.ok(html.includes('\u25B6'), 'the forward arrow should be drawn');
    // Positions 15-23 on the template, so it must claim a width, not zero.
    assert.match(html, /width:\s*9ch/, 'the marker should span the primer, 9 nt here');
  });

  test('a reverse primer is drawn on the reverse row', () => {
    // reverse complement of GGACCATGG, so it anneals at the same place
    const html = render([{ name: 'RevOne', sequence: 'CCATGGTCC', direction: 'reverse' }]);
    assert.ok(html.includes('RevOne'), 'the marker should name the primer');
    assert.ok(html.includes('\u25C0'), 'the reverse arrow should be drawn');
  });

  test('with the layer off, nothing is drawn', () => {
    const drawable = placePrimers(
      [{ id: 'x', name: 'Hidden', sequence: 'GGACCATGG', direction: 'forward' }], SEQ,
    ).map(p => ({
      id: p.id, name: p.name, sequence: 'GGACCATGG', direction: p.strand,
      tm: 60, gcContent: 50, start: p.start + 1, end: p.end + 1,
    }));
    const html = renderToStaticMarkup(createElement(MolbuilderRenderer, {
      sequence: SEQ, features: [], primers: drawable, lineLen: 60,
      layers: { ...LAYERS, primer: false }, frames: new Set<number>(), onSelect: () => {},
    } as never));
    assert.ok(!html.includes('Hidden'), 'the layer toggle should still hide it');
  });

  test('a primer that does not anneal is simply absent, not misplaced', () => {
    const html = render([{ name: 'Ghost', sequence: 'TTTTTTTTTTTT', direction: 'forward' }]);
    assert.ok(!html.includes('Ghost'));
    assert.ok(!html.includes('\u25B6'), 'no marker at all, rather than one at a guessed position');
  });

  test('the old bug: coordinates missing means nothing renders', () => {
    // Reproduces the previous behaviour directly -- primers with no start/end.
    const html = renderToStaticMarkup(createElement(MolbuilderRenderer, {
      sequence: SEQ, features: [],
      primers: [{ id: 'a', name: 'NoCoords', sequence: 'GGACCATGG', direction: 'forward', tm: 60, gcContent: 50 }],
      lineLen: 60, layers: LAYERS, frames: new Set<number>(), onSelect: () => {},
    } as never));
    assert.ok(!html.includes('NoCoords') && !html.includes('\u25B6'),
      'without coordinates it cannot be placed -- which is why they are now resolved before rendering');
  });
});
