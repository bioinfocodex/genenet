import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickAnnealing, amplify, homologyPrimers, goldenGatePrimers, gatewayPrimers, topoPrimers,
  ATTB1_TAIL, ATTB2_TAIL,
} from '../src/lib/primer-design.ts';
import { revComp } from '../src/lib/alignment.ts';
import { nnTm } from '../src/lib/tm.ts';
import { assembleByHomology } from '../src/lib/homology-cloning.ts';
import { fragmentOf } from '../src/lib/assembly.ts';
import { findAttSites } from '../src/lib/gateway.ts';

const filler = (seed: number, n: number) => {
  let x = seed * 7919 + 13;
  const SITES = ['GGTCTC', 'GAGACC'];
  let out = '';
  while (out.length < n) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'[(x >>> 16) % 4];
    if (SITES.some(s => out.endsWith(s))) out = out.slice(0, -1);
  }
  return out;
};

describe('choosing how much template to bind', () => {
  test('length follows temperature, not a fixed number', () => {
    // A GC-rich target reaches the target Tm in fewer bases than an AT-rich one.
    const gcRich = pickAnnealing('GCGCGGCCGCGGCCGCGGCCGCGGCCGCGGCC', { targetTm: 60 });
    const atRich = pickAnnealing('ATATTTAAATTATAAATTTATAAATTTAAATTATAAAT', { targetTm: 60 });
    assert.ok(gcRich.length < atRich.length, `${gcRich.length} should be under ${atRich.length}`);
  });

  test('it reaches the target where the sequence allows', () => {
    const a = pickAnnealing(filler(1, 200), { targetTm: 60 });
    assert.ok(nnTm(a) >= 58, `got ${nnTm(a).toFixed(1)} °C`);
  });

  test('it respects the bounds', () => {
    const a = pickAnnealing(filler(2, 200), { targetTm: 90, min: 18, max: 24 });
    assert.ok(a.length >= 18 && a.length <= 24, `length ${a.length}`);
  });

  test('a template shorter than the minimum is used whole', () => {
    assert.equal(pickAnnealing('ACGTACGTAC', { min: 18 }), 'ACGTACGTAC');
  });

  test('it lands the 3′ end on a G or C when it can', () => {
    // A GC clamp is worth a degree of Tm, and shifting the end by a base or two
    // is what a designer does by hand. Doing it here beats reporting it.
    let clamped = 0, total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = pickAnnealing(filler(seed, 200), { targetTm: 60 });
      total++;
      if (/[GC]$/.test(a)) clamped++;
    }
    assert.ok(clamped / total > 0.85, `only ${clamped}/${total} primers got a GC clamp`);
  });

  test('it does not sacrifice the melting temperature to get one', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = pickAnnealing(filler(seed, 200), { targetTm: 60 });
      assert.ok(nnTm(a) >= 58, `seed ${seed}: ${nnTm(a).toFixed(1)} °C`);
    }
  });
});

describe('plain amplification', () => {
  const template = filler(10, 900);

  test('the primers bind the two ends of the template', () => {
    const p = amplify(template, 'gene');
    assert.ok(template.startsWith(p.forward.anneals), 'forward must match the 5′ end');
    assert.ok(template.endsWith(revComp(p.reverse.anneals)), 'reverse must match the 3′ end');
  });

  test('with no tail, the oligo is the annealing sequence', () => {
    const p = amplify(template);
    assert.equal(p.forward.tail, '');
    assert.equal(p.forward.sequence, p.forward.anneals);
  });

  test('the reported Tm is the annealing part', () => {
    const p = amplify(template);
    assert.equal(p.forward.tm, nnTm(p.forward.anneals));
  });
});

describe('homology primers', () => {
  const frags = [
    { name: 'vector', sequence: filler(20, 2000) },
    { name: 'gene', sequence: filler(21, 700) },
    { name: 'tag', sequence: filler(22, 300) },
  ];

  test('each primer carries its neighbour on the 5′ end', () => {
    const pairs = homologyPrimers(frags, 25);
    assert.equal(pairs.length, 3);
    // gene's forward primer should carry the tail of vector.
    assert.equal(pairs[1].forward.tail, frags[0].sequence.slice(-25));
    // gene's reverse primer should carry the start of tag, reverse-complemented.
    assert.equal(pairs[1].reverse.tail, revComp(frags[2].sequence.slice(0, 25)));
  });

  test('the annealing half still matches the template', () => {
    const pairs = homologyPrimers(frags, 25);
    for (let i = 0; i < frags.length; i++) {
      assert.ok(frags[i].sequence.startsWith(pairs[i].forward.anneals));
      assert.ok(frags[i].sequence.endsWith(revComp(pairs[i].reverse.anneals)));
    }
  });

  test('the products these primers make actually assemble', () => {
    // The real test: build what PCR would give, and check the assembler joins
    // it. Designing homology that does not then assemble is the failure worth
    // catching, and it is invisible if you only inspect the primers.
    const overlap = 25;
    const pairs = homologyPrimers(frags, overlap);
    const products = frags.map((f, i) => {
      const fwdTail = pairs[i].forward.tail;
      const revTail = pairs[i].reverse.tail;
      return fragmentOf(f.name, f.name, fwdTail + f.sequence + revComp(revTail));
    });
    const r = assembleByHomology(products, 'gibson');
    assert.equal(r.assemblies.length, 1, `expected one construct, got ${r.assemblies.length}`);
    assert.equal(r.checks.length, 3);
    for (const c of r.checks) assert.equal(c.occurrences, 1, 'each arm should be unique');
  });
});

describe('Golden Gate primers', () => {
  const frag = { name: 'CDS', sequence: filler(30, 700) };

  test('the tail is the site, a spacer and the chosen overhang', () => {
    const p = goldenGatePrimers(frag, 'BsaI', 'AATG', 'GCTT');
    assert.ok(p.forward.tail.startsWith('GGTCTC'), p.forward.tail);
    assert.ok(p.forward.tail.endsWith('AATG'));
    assert.equal(p.forward.tail.length, 6 + 1 + 4);
  });

  test('the reverse tail carries the other overhang, reverse-complemented', () => {
    const p = goldenGatePrimers(frag, 'BsaI', 'AATG', 'GCTT');
    assert.ok(p.reverse.tail.endsWith(revComp('GCTT')));
  });

  test('an internal site is called out, because it has to be removed first', () => {
    const dirty = { name: 'dirty', sequence: filler(31, 300) + 'GGTCTC' + filler(32, 300) };
    const p = goldenGatePrimers(dirty, 'BsaI', 'AATG', 'GCTT');
    assert.ok(p.warnings.some(w => /internal/.test(w) && /domestication/.test(w)), p.warnings.join(' | '));
  });

  test('an enzyme that cuts inside its site is refused', () => {
    assert.throws(() => goldenGatePrimers(frag, 'EcoRI', 'AATG', 'GCTT'), /cuts inside its site/);
  });
});

describe('Gateway primers', () => {
  const insert = { name: 'GFP', sequence: filler(40, 720) };

  test('the attB tails are added and the annealing half is untouched', () => {
    const p = gatewayPrimers(insert);
    assert.equal(p.forward.tail, ATTB1_TAIL);
    assert.equal(p.reverse.tail, ATTB2_TAIL);
    assert.ok(insert.sequence.startsWith(p.forward.anneals));
    assert.ok(insert.sequence.endsWith(revComp(p.reverse.anneals)));
  });

  test('the tails carry the att cores the BP reaction looks for', () => {
    // The forward primer is the top strand and carries the att1 core directly.
    assert.ok(ATTB1_TAIL.includes('TTTGTACAAAAAAG'), 'attB1 core missing from the tail');
    // The reverse primer is written along the bottom strand, so it carries the
    // att2 core directly too -- and its reverse complement is the attB2 site as
    // it will read in the product.
    assert.ok(ATTB2_TAIL.includes('TTTGTACAAGAAAG'), 'att2 core missing from the tail');
    assert.ok(
      revComp(ATTB2_TAIL).startsWith('ACCCAGCTTTCTTGTACAAAGTGG'),
      'the tail should read back as the published attB2 site',
    );
  });

  test('a product made with these primers is recognised by the BP reaction', () => {
    // The end-to-end claim: tails designed here produce att sites the Gateway
    // module finds, one of each family, which is what makes the reaction
    // directional.
    const p = gatewayPrimers(insert);
    const product = p.forward.sequence + insert.sequence.slice(p.forward.anneals.length,
      insert.sequence.length - p.reverse.anneals.length) + revComp(p.reverse.sequence);
    const sites = findAttSites(product);
    assert.equal(sites.filter(s => s.family === 1).length, 1, 'exactly one attB1');
    assert.equal(sites.filter(s => s.family === 2).length, 1, 'exactly one attB2');
  });
});

describe('TOPO primers', () => {
  const insert = { name: 'amplicon', sequence: filler(50, 800) };

  test('directional adds CACC and nothing else', () => {
    const p = topoPrimers(insert, true);
    assert.equal(p.forward.tail, 'CACC');
    assert.equal(p.reverse.tail, '');
  });

  test('plain TA adds no tail but states the polymerase requirement', () => {
    const p = topoPrimers(insert, false);
    assert.equal(p.forward.tail, '');
    assert.ok(p.warnings.some(w => /Taq/.test(w)), p.warnings.join(' | '));
  });
});

describe('primer quality', () => {
  test('mismatched melting temperatures are reported on the pair', () => {
    // One end GC-rich, the other AT-rich: the cooler primer sets the anneal
    // temperature and the warmer one then binds loosely.
    const lopsided = 'GCGCGGCCGCGGCCGCGGCCGCGG' + filler(60, 400) + 'ATATTTAAATTATAAATTTATAAAT';
    const p = amplify(lopsided, 'lopsided', { targetTm: 75, max: 25 });
    assert.ok(p.tmDelta > 5, `Tm delta was only ${p.tmDelta.toFixed(1)}`);
    assert.ok(p.warnings.some(w => /apart/.test(w)));
  });

  test('a missing GC clamp is noted', () => {
    const p = amplify('ATATATATATATATATATATATATAAAA' + filler(61, 300));
    assert.ok(
      p.forward.warnings.some(w => /GC clamp/.test(w)),
      p.forward.warnings.join(' | '),
    );
  });

  test('a clean primer raises nothing', () => {
    const p = amplify(filler(62, 600), 'clean');
    assert.deepEqual(p.warnings, []);
  });
});
