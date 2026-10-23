import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCode128, barcodeSvg, zplLabel, unencodable, QUIET_ZONE,
  fitsLabel, MIN_MODULE_MM, type Encoded,
} from '../src/lib/barcode.ts';

const enc = (s: string): Encoded => {
  const r = encodeCode128(s);
  assert.ok(!('error' in r), `${s}: ${'error' in r ? r.error : ''}`);
  return r as Encoded;
};

/**
 * Captured from python-barcode, an independent implementation, rather than
 * worked out by hand. These pin the pattern table and the check symbol: if a
 * row of the table were mistyped, or the checksum were off by a position,
 * these strings would not match and nothing else in this file would notice.
 */
const REFERENCE: Record<string, string> = {
  'PLA-001': '1101001000011101110110100011011101010001100010011011100100111011001001110110010011100110100001001101100011101011',
  'SAM-001': '1101001000011011101000101000110001011101100010011011100100111011001001110110010011100110100111100101100011101011',
  'A': '1101001000010100011000100010110001100011101011',
  '1234567890': '110100111001011001110010001011000111000101101100001010011011110110100111100101100011101011',
  'OLI-00042': '11010010000100011101101000110111011000100010100110111001011101111011011001100100100011001011110111011001110010101110110001100011101011',
  'pEGFP-N1': '110100100001010011110010001101000110100010001000110001011101110110100110111001011100011010011100110100001011001100011101011',
};

describe('against an independent encoder', () => {
  for (const [text, modules] of Object.entries(REFERENCE)) {
    test(`${text} encodes to the same bars`, () => {
      assert.equal(enc(text).modules, modules);
    });
  }
});

describe('the shape of a symbol', () => {
  test('it starts with a bar and ends with one', () => {
    // A symbol ending on a space would have no edge for a scanner to find.
    const m = enc('PLA-001').modules;
    assert.equal(m[0], '1');
    assert.equal(m[m.length - 1], '1');
  });

  test('every symbol is eleven modules, and the stop is thirteen', () => {
    const e = enc('SAM-001');
    const dataModules = e.modules.length - 13;
    assert.equal(dataModules % 11, 0);
    assert.equal(dataModules / 11, e.values.length - 1, 'one symbol per value, stop aside');
  });

  test('the width includes a quiet zone on both sides', () => {
    const e = enc('A');
    assert.equal(e.width, e.modules.length + QUIET_ZONE * 2);
  });

  test('the first value says which code set it started in', () => {
    assert.equal(enc('PLA-001').values[0], 104, 'letters start in B');
    assert.equal(enc('1234567890').values[0], 105, 'a long run of digits starts in C');
    assert.equal(enc('12').values[0], 105, 'and so does a bare pair');
    assert.equal(enc('123').values[0], 104, 'three digits do not pay for the switch back');
  });

  test('the last data value is the check symbol, and it is the published sum', () => {
    const e = enc('PLA-001');
    const values = e.values.slice(0, -1);          // drop the stop
    const check = values[values.length - 1];
    const data = values.slice(0, -1);
    let sum = data[0];
    for (let i = 1; i < data.length; i++) sum += data[i] * i;
    assert.equal(check, sum % 103);
  });
});

/**
 * A decoder, so the encoder is read back rather than only inspected.
 *
 * Deliberately written from the symbol values rather than from the encoder's
 * own path: it takes whatever code set the symbols say and follows the
 * switches as it finds them. A bug in the encoder's switching -- changing set
 * without emitting the switch, or packing a pair while in B -- comes back as
 * the wrong text here.
 */
function decode(e: Encoded): string {
  const values = e.values.slice(0, -1);
  const data = values.slice(1, -1);
  let set: 'B' | 'C' = values[0] === 105 ? 'C' : 'B';
  let out = '';
  for (const v of data) {
    /*
     * A symbol's meaning depends on the set it is read in, and 99 is the trap:
     * in Code B it switches to Code C, and in Code C it is the digits 99. A
     * decoder that treats it as a switch either way loses a pair every time a
     * code contains one -- which is what the first version of this did, and
     * what this test caught in itself rather than in the encoder.
     */
    if (set === 'B' && v === 99) { set = 'C'; continue; }
    if (set === 'C' && v === 100) { set = 'B'; continue; }
    out += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return out;
}

describe('what is encoded is what comes back', () => {
  const codes = [
    'PLA-001', 'SAM-001', 'OLI-00042', 'pEGFP-N1', 'A', '12', '123', '1234',
    '1234567890', 'AB1234CD', '00000000', 'x', 'LOT 12/A', 'a-b_c.d/e#f+g',
    '9S7691Vh', '81AU22x2pO5d0733-', '99.6x6555', '993473bd',
  ];
  for (const c of codes) {
    test(`${c} reads back as itself`, () => assert.equal(decode(enc(c)), c));
  }

  test('every printable ASCII character survives a round trip', () => {
    let all = '';
    for (let c = 32; c <= 126; c++) all += String.fromCharCode(c);
    assert.equal(decode(enc(all)), all);
  });

  test('a long run of digits is packed two to a symbol', () => {
    // Twenty digits: Start C and ten pairs, against Start B and twenty
    // characters. The saving is the whole point of the code set.
    const packed = enc('12345678901234567890');
    const plain = enc('abcdefghijabcdefghij');
    assert.ok(packed.modules.length < plain.modules.length - 90, 'about ten symbols narrower');
  });
});

describe('what cannot be encoded', () => {
  test('an empty code is refused', () => {
    assert.deepEqual(encodeCode128(''), { error: 'Nothing to encode.' });
  });

  test('characters outside printable ASCII are refused, not dropped', () => {
    // Dropping one would make the label scan back as a different code, and
    // the label would be wrong in a way nobody could see by looking at it.
    const r = encodeCode128('PLA–001');       // an en dash, not a hyphen
    assert.ok('error' in r);
    assert.match((r as { error: string }).error, /cannot carry/);
    assert.deepEqual(unencodable('PLA–001'), ['–']);
    assert.deepEqual(unencodable('PLA-001'), []);
  });

  test('a hyphen is fine, which is what lab codes are full of', () => {
    assert.deepEqual(unencodable('PLA-001'), []);
    assert.equal(decode(enc('PLA-001')), 'PLA-001');
  });
});

describe('drawing it', () => {
  test('the SVG is as wide as the symbol plus its quiet zones', () => {
    const e = enc('PLA-001');
    const svg = barcodeSvg(e, { moduleWidth: 2, height: 50 });
    assert.match(svg, new RegExp(`width="${e.width * 2}"`));
  });

  test('bars are drawn, spaces are not', () => {
    const e = enc('A');
    const svg = barcodeSvg(e, { showText: false });
    const bars = (svg.match(/<rect /g) ?? []).length;
    // One background rectangle, plus one per bar: half the elements.
    assert.equal(bars, 1 + Math.ceil(e.widths.length / 2));
  });

  test('the first bar starts after the quiet zone, not at the edge', () => {
    // A symbol printed flush to the edge of a label is the commonest reason a
    // barcode will not scan.
    const svg = barcodeSvg(enc('A'), { moduleWidth: 2 });
    assert.match(svg, /<rect x="20"/);
  });

  test('the code is written underneath, because a scuffed label still has to be readable', () => {
    assert.match(barcodeSvg(enc('PLA-001')), />PLA-001</);
    assert.ok(!barcodeSvg(enc('PLA-001'), { showText: false }).includes('>PLA-001<'));
  });

  test('a code with XML in it cannot break out of the text element', () => {
    const svg = barcodeSvg(enc('A<B&C'));
    assert.ok(svg.includes('A&lt;B&amp;C'));
    assert.ok(!svg.includes('>A<B&C<'));
  });
});

describe('sending it to a Zebra', () => {
  test('a label is a complete ZPL document carrying the code', () => {
    const zpl = zplLabel('PLA-001') as string;
    assert.ok(zpl.startsWith('^XA'));
    assert.ok(zpl.trimEnd().endsWith('^XZ'));
    assert.match(zpl, /\^BCN/, 'Code 128, normal orientation');
    assert.match(zpl, /\^FD>:PLA-001\^FS/, 'pinned to subset B rather than left to the firmware');
  });

  test('a caption is a second field, and optional', () => {
    assert.match(zplLabel('PLA-001', { caption: 'pEGFP-N1 midiprep' }) as string, /pEGFP-N1 midiprep/);
    assert.ok(!(zplLabel('PLA-001') as string).includes('^A0N'));
  });

  test('ZPL control characters are refused rather than sent', () => {
    // ^ and ~ end a field; a code containing one would run the rest of itself
    // as printer commands.
    const r = zplLabel('PLA^001');
    assert.ok(typeof r === 'object' && 'error' in r);
    const r2 = zplLabel('PLA~001');
    assert.ok(typeof r2 === 'object' && 'error' in r2);
  });

  test('a caption cannot smuggle them in either', () => {
    const zpl = zplLabel('PLA-001', { caption: 'a^b~c' }) as string;
    assert.ok(!zpl.includes('a^b'));
  });

  test('a code Code 128 cannot carry is refused here too', () => {
    const r = zplLabel('PLA–001');
    assert.ok(typeof r === 'object' && 'error' in r);
  });
});

describe('whether a label is big enough to scan', () => {
  test('an address label carries a lab code comfortably', () => {
    const fit = fitsLabel(enc('PLA-001'), 63.5 - 3);
    assert.ok(fit.scannable);
    assert.ok(fit.moduleMm > MIN_MODULE_MM);
  });

  test('a cryo label cannot, and says so before the roll is printed', () => {
    // 132 modules across 22 mm is 0.17 mm a bar, and a 203 dpi printer's dot
    // is 0.125 mm: the bar lands on one dot or two depending where it falls.
    const fit = fitsLabel(enc('PLA-001'), 25 - 3);
    assert.equal(fit.scannable, false);
    assert.match(fit.why!, /under the 0.25 mm/);
  });

  test('a shorter code fits where a longer one does not', () => {
    assert.equal(fitsLabel(enc('PLA-001'), 25 - 3).scannable, false);
    assert.equal(fitsLabel(enc('P1'), 25 - 3).scannable, true);
  });
});
