/**
 * Regenerate src/lib/restrictionEnzymes.data.ts from REBASE.
 *
 *   node scripts/build-enzymes.mjs [path-to-link_itype2]
 *
 * REBASE (rebase.neb.com) is Roberts RJ et al., NAR. The itype2 file lists
 * Type II enzymes with, per line: name, prototype, recognition site,
 * methylation site, supplier codes, references. A non-empty supplier column
 * means the enzyme can actually be bought, which is the right filter for a
 * cloning tool -- the full database is mostly enzymes nobody can obtain.
 *
 * Two notations for the cut:
 *   G^AATTC       the caret marks the top-strand cut inside the site
 *   GGTCTC(1/5)   Type IIS: cuts 1 nt past the site on top, 5 on the bottom
 *
 * For a caret site the bottom-strand cut is its mirror, at length - top, which
 * is exact for the palindromic and interrupted-palindromic sites that make up
 * this file. The overhang is then the span between the two cuts: positive is a
 * 5' overhang, negative a 3' overhang, zero blunt.
 */
import { readFileSync, writeFileSync } from 'fs';

const src = process.argv[2] ?? '/tmp/rb-link_itype2';
const out = 'src/lib/restrictionEnzymes.data.ts';

const rows = [];
for (const line of readFileSync(src, 'latin1').split('\n')) {
  if (!line.trim() || /^[ \t]/.test(line)) continue;
  const p = line.replace(/\n$/, '').split('\t');
  if (p.length < 5) continue;
  const [name, prototype, site, methylation, suppliers] = p;
  if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(name)) continue;
  if (!suppliers.trim()) continue;                 // not purchasable
  if (/^\(-?\d+\/-?\d+\)/.test(site)) continue;    // Type IIB: cuts both sides
  rows.push({ name, prototype: prototype.trim(), site, methylation: methylation.trim() });
}

const enzymes = [];
for (const { name, prototype, site, methylation } of rows) {
  let pattern, cutTop, cutBottom;

  const iis = site.match(/^([ACGTRYSWKMBDHVN]+)\((-?\d+)\/(-?\d+)\)$/);
  if (iis) {
    pattern = iis[1];
    cutTop = pattern.length + Number(iis[2]);
    cutBottom = pattern.length + Number(iis[3]);
  } else if (site.includes('^')) {
    const i = site.indexOf('^');
    pattern = site.replace('^', '');
    cutTop = i;
    cutBottom = pattern.length - i;
  } else {
    continue;
  }

  if (!/^[ACGTRYSWKMBDHVN]+$/.test(pattern)) continue;
  if (cutTop < 0) continue; // cuts before the site; not representable here

  const span = cutBottom - cutTop;
  const overhangType = span > 0 ? '5prime' : span < 0 ? '3prime' : 'blunt';

  // Only a fixed site yields a fixed overhang sequence. For Type IIS the
  // overhang is whatever the target happens to be, so only its length is known.
  let overhang = '';
  if (!iis && span !== 0) {
    const lo = Math.min(cutTop, cutBottom);
    const hi = Math.max(cutTop, cutBottom);
    const seq = pattern.slice(lo, hi);
    if (/^[ACGT]+$/.test(seq)) overhang = seq;
  }

  enzymes.push({
    name, pattern, cutBefore: cutTop, cutBottom,
    overhang, overhangType,
    overhangLength: Math.abs(span),
    typeIIS: !!iis,
      // The enzyme this one is an isoschizomer of. Empty when it is itself the
      // prototype, so grouping uses `prototype || name`.
      prototype,
      // REBASE's own methylation column: which base within the site the
      // enzyme's cognate methyltransferase modifies. Not the same question as
      // "is this blocked in a dam+ strain", which depends on the sequence
      // around the site and is computed rather than tabulated.
      methylation,
    });
}

enzymes.sort((a, b) => a.name.localeCompare(b.name, 'en'));

const version = (readFileSync(src, 'latin1').match(/REBASE version (\d+)/) ?? [])[1] ?? 'unknown';
const body = enzymes.map(e =>
  `  ${JSON.stringify(e.name)}: { name: ${JSON.stringify(e.name)}, pattern: ${JSON.stringify(e.pattern)}, ` +
  `cutBefore: ${e.cutBefore}, cutBottom: ${e.cutBottom}, overhang: ${JSON.stringify(e.overhang)}, ` +
  `overhangType: '${e.overhangType}', overhangLength: ${e.overhangLength}` +
  (e.typeIIS ? ', typeIIS: true' : '') +
  (e.prototype ? `, prototype: ${JSON.stringify(e.prototype)}` : '') +
  (e.methylation ? `, methylation: ${JSON.stringify(e.methylation)}` : '') + ' },'
).join('\n');

writeFileSync(out, `// GENERATED FILE -- do not edit by hand.
// Regenerate with: node scripts/build-enzymes.mjs
//
// Source: REBASE version ${version}, the Restriction Enzyme Database
// (rebase.neb.com), Roberts RJ, Vincze T, Posfai J, Macelis D.
// Filtered to enzymes with at least one commercial supplier, which is what a
// lab can actually use. Type IIB enzymes that cut on both sides of their site
// are omitted, as one cut offset cannot describe them.
import type { Enzyme } from './restrictionEnzymes';

export const REBASE_ENZYMES: Record<string, Enzyme> = {
${body}
};
`);

console.log(`  ${enzymes.length} enzymes written to ${out} (REBASE ${version})`);
console.log(`    Type IIS: ${enzymes.filter(e => e.typeIIS).length}`);
console.log(`    blunt: ${enzymes.filter(e => e.overhangType === 'blunt').length}`);
console.log(`    5' overhang: ${enzymes.filter(e => e.overhangType === '5prime').length}`);
console.log(`    3' overhang: ${enzymes.filter(e => e.overhangType === '3prime').length}`);
console.log(`    with a prototype (isoschizomers): ${enzymes.filter(e => e.prototype).length}`);
console.log(`    with methylation recorded: ${enzymes.filter(e => e.methylation).length}`);
