import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_FORMATS, IMPORT_ACCEPT, IMPORT_EXTENSIONS, IMPORT_HINT,
  IMPORT_FORMAT_LIST, formatFromFilename,
} from '../src/lib/import-formats.ts';

/**
 * The guard on the bug this list exists to prevent.
 *
 * A reader can work perfectly and still be unreachable, because the file
 * picker decides which files a person is allowed to choose. SnapGene .dna was
 * read, written, tested and named in the error message, and still could not be
 * selected -- the `accept` attribute was a fourth, shorter list nobody updated.
 */

describe('every reader is reachable from the picker', () => {
  test('.dna is offered, which was the whole problem', () => {
    assert.ok(IMPORT_EXTENSIONS.includes('.dna'));
    assert.match(IMPORT_ACCEPT, /\.dna/);
  });

  test('the formats the importer reads are all in the list', () => {
    // These are the readers src/app/actions/sequences.ts dispatches to. A
    // reader added without an extension here is a reader nobody can use.
    for (const ext of ['.gb', '.gbk', '.genbank', '.fasta', '.fa', '.fna', '.embl', '.gff', '.gff3', '.dna', '.ab1', '.txt']) {
      assert.ok(IMPORT_EXTENSIONS.includes(ext), `${ext} is missing`);
    }
  });

  test('the accept attribute is exactly the extensions, comma separated', () => {
    assert.deepEqual(IMPORT_ACCEPT.split(','), IMPORT_EXTENSIONS);
  });

  test('every extension has a leading dot and no spaces', () => {
    // A file input ignores an entry it cannot parse, silently.
    for (const ext of IMPORT_EXTENSIONS) assert.match(ext, /^\.[a-z0-9]+$/, ext);
  });

  test('no extension is claimed twice', () => {
    assert.equal(new Set(IMPORT_EXTENSIONS).size, IMPORT_EXTENSIONS.length);
  });

  test('every format names at least one extension and has a label', () => {
    for (const f of IMPORT_FORMATS) {
      assert.ok(f.extensions.length > 0, f.label);
      assert.ok(f.label.trim().length > 0);
    }
  });
});

describe('what the three places that show this list get', () => {
  test('the hint names one extension per format', () => {
    assert.equal(IMPORT_HINT.split(' · ').length, IMPORT_FORMATS.length);
  });

  test('the error message names SnapGene, so the advice matches the picker', () => {
    assert.match(IMPORT_FORMAT_LIST, /SnapGene/);
    assert.match(IMPORT_FORMAT_LIST, /GenBank/);
  });
});

describe('naming a file', () => {
  test('a known extension is named', () => {
    assert.equal(formatFromFilename('pUC19.dna'), 'SnapGene');
    assert.equal(formatFromFilename('plasmid.GB'), 'GenBank');
    assert.equal(formatFromFilename('reads.fasta'), 'FASTA');
  });

  test('an unknown extension is not named and not an error', () => {
    /*
     * The content decides the format, not the name, so an unfamiliar
     * extension is a thing to be quiet about rather than to refuse. Refusing
     * here is how a renamed GenBank file became unimportable.
     */
    assert.equal(formatFromFilename('mystery.xyz'), null);
    assert.equal(formatFromFilename('no-extension'), null);
    assert.equal(formatFromFilename(''), null);
  });

  test('a path, not just a name', () => {
    assert.equal(formatFromFilename('/home/me/maps/pBAD.dna'), 'SnapGene');
  });

  test('a double extension reads as the last one', () => {
    assert.equal(formatFromFilename('backup.dna.gb'), 'GenBank');
  });
});
