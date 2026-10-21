import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, DATABASES, PROGRAMS, programInfo, cleanQuery, problemsWith, warningsFor,
  putParams, statusParams, resultParams, readQBlastInfo, readSubmission, readStatus,
  coveredBases, pace, noteContact, emptyPace, nextPollIn,
  parseReport,
  type BlastRequest, type Hsp, type BlastReport,
} from '../src/lib/blast.ts';

const CALLER = { tool: 'genenet', email: 'lab@example.org' };

/**
 * The two replies below are copied from real NCBI responses, not invented.
 *
 * They differ from each other in a way that matters and that nobody would
 * guess: the submission block writes `RID = DHKHG3VA016`, with spaces round
 * the equals, and the status block writes `Status=WAITING` with none. A parser
 * written against either one alone fails on the other.
 */
const PUT_REPLY = `
<form>
<!--QBlastInfoBegin
    RID = DHKHG3VA016
    RTOE = 30
QBlastInfoEnd
-->
</form>`;

const STATUS_WAITING = `
                QBlastInfoBegin
\t                Status=WAITING
                QBlastInfoEnd
                --></p>`;

const STATUS_READY = `
    QBlastInfoBegin
        Status=READY
        ThereAreHits=yes
    QBlastInfoEnd
`;

const STATUS_NO_HITS = `
    QBlastInfoBegin
        Status=READY
        ThereAreHits=no
    QBlastInfoEnd
`;

const req = (over: Partial<BlastRequest> = {}): BlastRequest => ({
  query: 'ATGAGTAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGT',
  program: 'megablast',
  database: 'core_nt',
  ...over,
});

describe('reading what NCBI sends back', () => {
  test('the info block is read whether or not the equals has spaces round it', () => {
    assert.deepEqual(readQBlastInfo(PUT_REPLY), { RID: 'DHKHG3VA016', RTOE: '30' });
    assert.deepEqual(readQBlastInfo(STATUS_WAITING), { Status: 'WAITING' });
  });

  test('a page with no info block reads as nothing rather than throwing', () => {
    assert.deepEqual(readQBlastInfo('<html>down for maintenance</html>'), {});
    assert.deepEqual(readQBlastInfo(''), {});
  });

  test('an unterminated block is still read as far as it goes', () => {
    assert.deepEqual(readQBlastInfo('QBlastInfoBegin\n RID = ABC123\n'), { RID: 'ABC123' });
  });

  test('the request id and the estimate come off a submission', () => {
    const r = readSubmission(PUT_REPLY);
    assert.deepEqual(r, { rid: 'DHKHG3VA016', estimateSec: 30 });
  });

  test('a refused submission is an error, not an id', () => {
    // NCBI answers a rejected request with 200 and an HTML page, so the
    // absence of an id is the only signal there is.
    const r = readSubmission('<html><p class="error">Message ID#24 Error: Failed to read the Blast query</p></html>');
    assert.ok('error' in r);
    assert.match((r as { error: string }).error, /Failed to read/);
  });

  test('a submission with no id and no complaint still says something', () => {
    const r = readSubmission('<html>nothing useful</html>') as { error: string };
    assert.match(r.error, /no job id/);
  });

  test('an unreadable estimate falls back rather than becoming NaN', () => {
    const r = readSubmission('QBlastInfoBegin\nRID = X1\nRTOE = soon\nQBlastInfoEnd') as { estimateSec: number };
    assert.equal(r.estimateSec, 30);
  });
});

describe('what the status means', () => {
  test('waiting', () => assert.equal(readStatus(STATUS_WAITING).state, 'waiting'));

  test('finished with hits, and finished without, are different answers', () => {
    // Not a distinction to collapse: no hits is a result, and reporting it as
    // a failure would have the panel claim a problem where there is none.
    assert.equal(readStatus(STATUS_READY).state, 'ready');
    assert.equal(readStatus(STATUS_NO_HITS).state, 'no-hits');
  });

  test('a failure carries NCBI\'s own complaint where there is one', () => {
    const s = readStatus('QBlastInfoBegin\nStatus=FAILED\nQBlastInfoEnd\n<p class="error">Message ID#36 query length exceeded</p>');
    assert.equal(s.state, 'failed');
    assert.match(s.message!, /query length exceeded/);
  });

  test('an id NCBI has forgotten is its own state, and says the lifetime', () => {
    const s = readStatus('QBlastInfoBegin\nStatus=UNKNOWN\nQBlastInfoEnd');
    assert.equal(s.state, 'expired');
    assert.match(s.message!, /24 hours/);
  });

  test('finished, with the hits field missing, is read as having hits', () => {
    // The safer reading. Being wrong this way costs one request for a report
    // with nothing in it; being wrong the other way announces that nothing
    // matched, on the strength of a field that was not there.
    assert.equal(readStatus('QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd').state, 'ready');
  });

  test('a reply with no status is treated as still running, not as finished', () => {
    // The costly mistake would be concluding: a search reported as finished
    // when it is not would be collected as an empty result.
    assert.equal(readStatus('<html>server busy</html>').state, 'waiting');
  });
});

describe('what is sent', () => {
  test('megablast is blastn with the switch, not a program of its own', () => {
    const p = putParams(req({ program: 'megablast' }), CALLER);
    assert.equal(p.get('PROGRAM'), 'blastn');
    assert.equal(p.get('MEGABLAST'), 'on');

    const plain = putParams(req({ program: 'blastn' }), CALLER);
    assert.equal(plain.get('PROGRAM'), 'blastn');
    assert.equal(plain.get('MEGABLAST'), null, 'and the switch is absent, not off');
  });

  test('the query is cleaned and, with a title, sent as FASTA', () => {
    const p = putParams(req({ query: 'atg agt\naaa', title: 'pSTYLE-1' }), CALLER);
    assert.equal(p.get('QUERY'), '>pSTYLE-1\nATGAGTAAA');
  });

  test('a title with newlines in it cannot break the FASTA record', () => {
    const p = putParams(req({ title: 'two\nlines' }), CALLER);
    assert.equal(p.get('QUERY')!.split('\n').length, 2);
    assert.ok(p.get('QUERY')!.startsWith('>two lines\n'));
  });

  test('every request identifies the caller, which is the price of the service', () => {
    for (const p of [putParams(req(), CALLER), statusParams('X1', CALLER), resultParams('X1', CALLER)]) {
      assert.equal(p.get('tool'), 'genenet');
      assert.equal(p.get('email'), 'lab@example.org');
    }
  });

  test('the status request asks for the status, and the result request for JSON', () => {
    assert.equal(statusParams('X1', CALLER).get('FORMAT_OBJECT'), 'SearchInfo');
    assert.equal(resultParams('X1', CALLER).get('FORMAT_TYPE'), 'JSON2_S');
    assert.equal(resultParams('X1', CALLER).get('FORMAT_OBJECT'), null);
  });

  test('the defaults are NCBI\'s own, and are overridable', () => {
    assert.equal(putParams(req(), CALLER).get('EXPECT'), '10');
    assert.equal(putParams(req({ expect: 1e-5 }), CALLER).get('EXPECT'), '0.00001');
    assert.equal(putParams(req({ hitlistSize: 5 }), CALLER).get('HITLIST_SIZE'), '5');
  });
});

describe('reading the query', () => {
  test('ambiguity codes survive, because an N in a read is information', () => {
    assert.equal(cleanQuery('acgtnryACGT', 'dna'), 'ACGTNRYACGT');
  });

  test('numbers, spaces and FASTA punctuation are dropped', () => {
    assert.equal(cleanQuery('  1 atg cgt\n 61 aaa ', 'dna'), 'ATGCGTAAA');
  });

  test('a stop codon is kept in a protein query', () => {
    assert.equal(cleanQuery('mkv*', 'protein'), 'MKV*');
  });
});

describe('what a search cannot be asked', () => {
  test('an empty selection is refused with the reason', () => {
    const p = problemsWith(req({ query: '12345 \n' }));
    assert.equal(p.length, 1);
    assert.match(p[0], /no A, C, G or T/);
  });

  test('a query shorter than the word size is refused, and the way out is named', () => {
    // The trap this exists for: megablast seeds on exact 28-mers, so a 20 bp
    // primer comes back empty and reads as "not in the database" rather than
    // "not asked properly".
    const p = problemsWith(req({ query: 'A'.repeat(20), program: 'megablast' }));
    assert.equal(p.length, 1);
    assert.match(p[0], /word size of 28/);
    assert.match(p[0], /Use blastn/);

    assert.deepEqual(problemsWith(req({ query: 'ACGT'.repeat(5), program: 'blastn' })), [],
      'the same query is answerable by blastn, whose word size is 11');
  });

  test('a program cannot be sent at a database it does not search', () => {
    const p = problemsWith(req({ program: 'megablast', database: 'swissprot' }));
    assert.equal(p.length, 1);
    assert.match(p[0], /cannot search/);
  });

  test('every program offers at least one database, and names only real ones', () => {
    for (const prog of PROGRAMS) {
      assert.ok(prog.databases.length > 0, prog.id);
      for (const db of prog.databases) assert.ok(db in DATABASES, `${prog.id} -> ${db}`);
    }
  });

  test('a warning never stops a search', () => {
    const short = req({ query: 'ACGTACGTACGTACGTAC', program: 'blastn' }); // 18 bp
    assert.deepEqual(problemsWith(short), []);
    assert.ok(warningsFor(short).some(w => /chance matches/.test(w)));
  });

  test('a long query is called out as slow, not as wrong', () => {
    const long = req({ query: 'ACGT'.repeat(3000) });
    assert.deepEqual(problemsWith(long), []);
    assert.ok(warningsFor(long).some(w => /several minutes/.test(w)));
  });
});

describe('how much of the query a hit covers', () => {
  const hsp = (queryFrom: number, queryTo: number): Hsp => ({
    bitScore: 100, evalue: 1e-20, identity: queryTo - queryFrom + 1,
    alignLen: queryTo - queryFrom + 1, gaps: 0,
    queryFrom, queryTo, hitFrom: 1, hitTo: queryTo - queryFrom + 1, hitStrand: 1,
  });

  test('one alignment covers its own span', () => {
    assert.equal(coveredBases([hsp(1, 100)]), 100);
    assert.equal(coveredBases([hsp(51, 60)]), 10);
  });

  test('two separate alignments cover both, which is more than either', () => {
    assert.equal(coveredBases([hsp(1, 100), hsp(201, 300)]), 200);
  });

  test('overlapping alignments are counted once, not twice', () => {
    // The reason this is a union rather than a sum: a gene matching across
    // exons gives alignments that overlap at the edges, and adding them gives
    // coverage above 100%, which is not a number that can be true.
    assert.equal(coveredBases([hsp(1, 100), hsp(50, 150)]), 150);
    assert.equal(coveredBases([hsp(1, 100), hsp(1, 100)]), 100);
  });

  test('abutting alignments leave no gap between them', () => {
    assert.equal(coveredBases([hsp(1, 10), hsp(11, 20)]), 20);
  });

  test('alignments arriving out of order are handled', () => {
    // 1-120 once, and 201-300: 120 + 100.
    assert.equal(coveredBases([hsp(201, 300), hsp(1, 100), hsp(80, 120)]), 220);
  });

  test('no alignments cover nothing', () => assert.equal(coveredBases([]), 0));
});

describe('pacing, which is what keeps the institution unblocked', () => {
  const T0 = 1_700_000_000_000;

  test('a first contact waits for nothing', () => {
    assert.equal(pace(emptyPace(), { kind: 'submit' }, T0).waitMs, 0);
  });

  test('two contacts of any kind are ten seconds apart', () => {
    const after = noteContact(emptyPace(), { kind: 'submit' }, T0);
    assert.equal(pace(after, { kind: 'submit' }, T0 + 1000).waitMs, 9000);
    assert.equal(pace(after, { kind: 'poll', rid: 'NEW' }, T0 + 1000).waitMs, 9000);
    assert.equal(pace(after, { kind: 'submit' }, T0 + LIMITS.contactGapMs).waitMs, 0);
  });

  test('one request id is polled no more than once a minute', () => {
    let r = noteContact(emptyPace(), { kind: 'poll', rid: 'R1' }, T0);
    assert.equal(pace(r, { kind: 'poll', rid: 'R1' }, T0 + 30_000).waitMs, 30_000);
    assert.equal(pace(r, { kind: 'poll', rid: 'R1' }, T0 + LIMITS.pollGapMs).waitMs, 0);

    // A different id is only subject to the ten-second rule.
    r = noteContact(r, { kind: 'poll', rid: 'R1' }, T0);
    assert.equal(pace(r, { kind: 'poll', rid: 'R2' }, T0 + 30_000).waitMs, 0);
  });

  test('the longer of the two waits wins', () => {
    // Polled 50s ago, and the server contacted 1s ago for something else:
    // ten seconds from the contact beats the ten remaining from the poll.
    let r = noteContact(emptyPace(), { kind: 'poll', rid: 'R1' }, T0);
    r = noteContact(r, { kind: 'poll', rid: 'OTHER' }, T0 + 55_000);
    const v = pace(r, { kind: 'poll', rid: 'R1' }, T0 + 56_000);
    assert.equal(v.waitMs, 9000, 'the contact gap, which outlasts the 4s left on the poll gap');
  });

  test('a hundred searches in a day is where NCBI starts throttling, so the hundred-and-first is refused', () => {
    let r = emptyPace();
    for (let i = 0; i < LIMITS.searchesPerDay; i++) r = noteContact(r, { kind: 'submit' }, T0 + i * 60_000);
    const v = pace(r, { kind: 'submit' }, T0 + LIMITS.searchesPerDay * 60_000);
    assert.ok(v.refuse, 'refused rather than queued');
    assert.match(v.refuse!, /BLAST\+/, 'and told what to do instead');
  });

  test('yesterday\'s searches do not count against today', () => {
    let r = emptyPace();
    for (let i = 0; i < LIMITS.searchesPerDay; i++) r = noteContact(r, { kind: 'submit' }, T0 + i * 1000);
    const nextDay = T0 + LIMITS.ridLifetimeMs + 1000;
    assert.equal(pace(r, { kind: 'submit' }, nextDay).refuse, undefined);
  });

  test('polling is never refused on the daily count: a search already sent must be collectable', () => {
    let r = emptyPace();
    for (let i = 0; i < LIMITS.searchesPerDay * 2; i++) r = noteContact(r, { kind: 'submit' }, T0 + i * 1000);
    assert.equal(pace(r, { kind: 'poll', rid: 'R1' }, T0 + 10_000_000).refuse, undefined);
  });

  test('old submissions are forgotten rather than accumulating for ever', () => {
    let r = emptyPace();
    for (let i = 0; i < 50; i++) r = noteContact(r, { kind: 'submit' }, T0 + i * 1000);
    // Past the last of them by a day, so every one has aged out.
    r = noteContact(r, { kind: 'submit' }, T0 + 50_000 + LIMITS.ridLifetimeMs);
    assert.equal(r.submittedAt.length, 1);
  });

  test('noting a contact does not alter the record it was given', () => {
    const before = noteContact(emptyPace(), { kind: 'poll', rid: 'R1' }, T0);
    const copy = { ...before, lastPollAt: { ...before.lastPollAt } };
    noteContact(before, { kind: 'poll', rid: 'R2' }, T0 + 60_000);
    assert.deepEqual(before, copy);
  });
});

describe('when to ask again', () => {
  test("the first wait is NCBI's own estimate, floored at the contact gap", () => {
    assert.equal(nextPollIn(0, 30), 30_000);
    assert.equal(nextPollIn(0, 2), LIMITS.contactGapMs, 'never sooner than the server allows');
    assert.equal(nextPollIn(0, 600), 120_000, 'and never longer than two minutes between looks');
  });

  test('after that it is a minute, which is the rule', () => {
    assert.equal(nextPollIn(1, 30), LIMITS.pollGapMs);
    assert.equal(nextPollIn(9, 600), LIMITS.pollGapMs);
  });
});

describe('the programs on offer', () => {
  test('an unknown program falls back rather than throwing', () => {
    assert.equal(programInfo('nonsense' as never).id, PROGRAMS[0].id);
  });

  test('each program knows whether it takes DNA or protein', () => {
    assert.equal(programInfo('blastp').query, 'protein');
    assert.equal(programInfo('blastx').query, 'dna', 'blastx translates the query, so it is given DNA');
  });
});

describe('the pacing record does not grow for ever', () => {
  const T0 = 1_700_000_000_000;

  test('request ids older than NCBI keeps them are dropped', () => {
    // The one piece of state here that nothing else ever clears: without this
    // the map gains an entry per search and keeps it for the life of the
    // process. An id NCBI has forgotten cannot be polled, so there is nothing
    // left to pace against.
    let r = emptyPace();
    for (let i = 0; i < 20; i++) r = noteContact(r, { kind: 'poll', rid: `R${i}` }, T0 + i * 1000);
    assert.equal(Object.keys(r.lastPollAt).length, 20);

    r = noteContact(r, { kind: 'poll', rid: 'LATER' }, T0 + 20_000 + LIMITS.ridLifetimeMs);
    assert.deepEqual(Object.keys(r.lastPollAt), ['LATER']);
  });

  test('an id polled within the day is kept, so it is still paced', () => {
    let r = noteContact(emptyPace(), { kind: 'poll', rid: 'R1' }, T0);
    r = noteContact(r, { kind: 'poll', rid: 'R2' }, T0 + 60_000);
    assert.deepEqual(Object.keys(r.lastPollAt).sort(), ['R1', 'R2']);
    assert.equal(pace(r, { kind: 'poll', rid: 'R1' }, T0 + 70_000).waitMs, 0);
    assert.equal(pace(r, { kind: 'poll', rid: 'R2' }, T0 + 70_000).waitMs, 50_000);
  });
});

describe('a slot can be claimed before it is waited for', () => {
  const T0 = 1_700_000_000_000;

  test('a contact noted in the future pushes the next one past it', () => {
    // How the service avoids its own worst failure: two requests arriving
    // together would otherwise both read the same gap, both sleep it, and
    // both reach NCBI in the same instant -- politely, and simultaneously.
    // Writing the contact time before the wait rather than after it means the
    // second caller is pacing against a contact that has not happened yet.
    const claimed = noteContact(emptyPace(), { kind: 'submit' }, T0 + LIMITS.contactGapMs);
    const second = pace(claimed, { kind: 'submit' }, T0);
    assert.equal(second.waitMs, 2 * LIMITS.contactGapMs, 'the claimed slot, and then a gap after it');
  });

  test('the same holds for a claimed poll of one id', () => {
    const claimed = noteContact(emptyPace(), { kind: 'poll', rid: 'R1' }, T0 + 5000);
    assert.equal(pace(claimed, { kind: 'poll', rid: 'R1' }, T0).waitMs, 5000 + LIMITS.pollGapMs);
  });
});

describe('reading the report', () => {
  /*
   * Constructed from the field names NCBI's JSON2 schema documents, not
   * captured from a live search -- said plainly because it matters how much
   * these tests are worth. They pin this module's own decisions: which hit is
   * "best", how coverage is worked out, what happens to a record with a field
   * missing. They cannot catch NCBI calling a field something else.
   */
  const hsp = (over: Record<string, unknown> = {}) => ({
    num: 1, bit_score: 200, score: 400, evalue: 1e-60,
    identity: 100, align_len: 100, gaps: 0,
    query_from: 1, query_to: 100, hit_from: 501, hit_to: 600,
    ...over,
  });

  const report = (hits: unknown[], queryLen = 200) => ({
    BlastOutput2: [{
      report: {
        program: 'blastn',
        search_target: { db: 'core_nt' },
        results: { search: { query_len: queryLen, hits } },
      },
    }],
  });

  const hit = (over: Record<string, unknown> = {}) => ({
    num: 1,
    description: [{ id: 'gi|123', accession: 'NM_000546', title: 'Homo sapiens TP53', taxid: 9606, sciname: 'Homo sapiens' }],
    len: 2591,
    hsps: [hsp()],
    ...over,
  });

  test('a hit is read out whole', () => {
    const r = parseReport(report([hit()]));
    assert.ok(!('error' in r));
    const got = (r as BlastReport).hits[0];
    assert.equal(got.accession, 'NM_000546');
    assert.equal(got.title, 'Homo sapiens TP53');
    assert.equal(got.organism, 'Homo sapiens');
    assert.equal(got.taxid, 9606);
    assert.equal(got.length, 2591);
    assert.equal(got.identity, 100);
    assert.equal(got.coverage, 50, '100 of a 200-long query');
  });

  test('the program and database are carried through from the report', () => {
    const r = parseReport(report([hit()])) as BlastReport;
    assert.equal(r.program, 'blastn');
    assert.equal(r.database, 'core_nt');
    assert.equal(r.queryLength, 200);
  });

  test('identity is the best alignment\'s, and coverage is all of them', () => {
    // The two numbers answer different questions and are not from the same
    // row: "how well does the best bit match" and "how much of my query is
    // accounted for at all".
    const r = parseReport(report([hit({
      hsps: [
        hsp({ bit_score: 300, identity: 100, align_len: 100, query_from: 1, query_to: 100 }),
        hsp({ bit_score: 80, identity: 40, align_len: 80, query_from: 121, query_to: 200 }),
      ],
    })])) as BlastReport;
    assert.equal(r.hits[0].identity, 100, 'the 300-bit alignment, not the 80-bit one');
    assert.equal(r.hits[0].coverage, 90, '100 + 80 of 200');
    assert.equal(r.hits[0].bitScore, 300);
  });

  test('the expect value reported is the best one the hit has', () => {
    const r = parseReport(report([hit({
      hsps: [hsp({ evalue: 1e-5 }), hsp({ evalue: 1e-90, query_from: 150, query_to: 200 })],
    })])) as BlastReport;
    assert.equal(r.hits[0].evalue, 1e-90);
  });

  test('a minus-strand alignment keeps NCBI\'s coordinates and is named as reversed', () => {
    const r = parseReport(report([hit({ hsps: [hsp({ hit_from: 600, hit_to: 501 })] })])) as BlastReport;
    const h = r.hits[0].hsps[0];
    assert.equal(h.hitStrand, -1);
    assert.equal(h.hitFrom, 600, 'not swapped into ascending order');
    assert.equal(h.hitTo, 501);
  });

  test('where NCBI names the strand, its word is taken over the coordinates', () => {
    const r = parseReport(report([hit({ hsps: [hsp({ hit_strand: 'Minus' })] })])) as BlastReport;
    assert.equal(r.hits[0].hsps[0].hitStrand, -1);
  });

  test('a hit with no alignments is left out rather than shown as a zero', () => {
    const r = parseReport(report([hit({ hsps: [] }), hit()])) as BlastReport;
    assert.equal(r.hits.length, 1);
  });

  test('a record with no accession is still shown, named as having none', () => {
    const r = parseReport(report([hit({ description: [{ title: 'an unnamed thing' }] })])) as BlastReport;
    assert.equal(r.hits[0].accession, '(no accession)');
    assert.equal(r.hits[0].title, 'an unnamed thing');
    assert.equal(r.hits[0].organism, undefined);
  });

  test('numbers arriving as strings are read as numbers', () => {
    const r = parseReport(report([hit({ len: '2591', hsps: [hsp({ evalue: '1e-60', bit_score: '200' })] })])) as BlastReport;
    assert.equal(r.hits[0].length, 2591);
    assert.equal(r.hits[0].evalue, 1e-60);
  });

  test('a report in a shape this version does not know refuses rather than half-parsing', () => {
    // The one place here where the shape of the data is somebody else's to
    // change. A confident-looking table of wrong numbers would be worse than
    // a sentence saying the report could not be read.
    for (const bad of [null, {}, { BlastOutput2: [] }, { BlastOutput2: [{}] }, 'a string']) {
      assert.ok('error' in parseReport(bad), JSON.stringify(bad));
    }
  });

  test('a report with no search results in it says so, distinctly', () => {
    const r = parseReport({ BlastOutput2: [{ report: { program: 'blastn', results: {} } }] });
    assert.ok('error' in r);
    assert.match((r as { error: string }).error, /no search results/);
  });

  test('a finished search with nothing in it is an empty list, not an error', () => {
    const r = parseReport(report([]));
    assert.ok(!('error' in r));
    assert.deepEqual((r as BlastReport).hits, []);
  });

  test('a single report not wrapped in an array is read too', () => {
    const one = { BlastOutput2: { report: { program: 'blastn', results: { search: { query_len: 100, hits: [hit()] } } } } };
    const r = parseReport(one) as BlastReport;
    assert.equal(r.hits.length, 1);
  });
});
