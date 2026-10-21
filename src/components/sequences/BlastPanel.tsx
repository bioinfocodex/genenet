'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ExternalLink, Upload } from 'lucide-react';
import { runBlast, checkBlast } from '@/app/actions/blast';
import {
  PROGRAMS, DATABASES, programInfo, cleanQuery, problemsWith, warningsFor,
  type BlastProgram, type BlastDatabase, type BlastReport, type BlastHit,
} from '@/lib/blast';

/**
 * What is this sequence?
 *
 * The question the lab's own records cannot answer, asked of NCBI. Everything
 * about the shape of this panel comes from the fact that the answer does not
 * arrive in the same breath as the question: a search takes from twenty
 * seconds to several minutes, so the panel has to be able to be left, and the
 * request id is shown because it is the thing that outlives the page.
 */

type Phase =
  | { at: 'idle' }
  | { at: 'starting' }
  | { at: 'waiting'; rid: string; since: number; nextAt: number }
  | { at: 'done'; rid: string; report: BlastReport }
  | { at: 'empty'; rid: string }
  | { at: 'error'; message: string; rid?: string };

export default function BlastPanel({ sequence, selection, title, kind = 'dna' }: {
  sequence: string;
  selection?: { start: number; end: number } | null;
  title?: string;
  /** What the record holds. A DNA record cannot be blastp'd. */
  kind?: 'dna' | 'protein';
}) {
  const [chosenProgram, setProgram] = useState<BlastProgram>('megablast');
  const [chosenDatabase, setDatabase] = useState<BlastDatabase>('core_nt');
  const [expect, setExpect] = useState('10');
  const [resume, setResume] = useState('');
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Only the programs that take what this record holds.
   *
   * blastp was in the list on a DNA record, and the failure was silent rather
   * than loud: A, C, G and T are all amino acid letters, so a plasmid cleaned
   * as a protein stays a plasmid-shaped string of alanine, cysteine, glycine
   * and threonine, and NCBI searches it without complaint.
   */
  const programs = useMemo(() => PROGRAMS.filter(p => p.query === kind), [kind]);

  /*
   * The choice, corrected as it is read rather than corrected afterwards.
   *
   * Changing the program can strand the database -- blastx cannot search
   * core_nt -- and putting that right in an effect means a render in which the
   * two disagree, which is a render that could submit. Deriving both leaves no
   * such moment.
   */
  const program = programs.some(p => p.id === chosenProgram) ? chosenProgram : programs[0].id;
  const info = programInfo(program);
  const database = info.databases.includes(chosenDatabase) ? chosenDatabase : info.databases[0];

  /** The selection, or the whole molecule when nothing is selected. */
  const query = useMemo(() => (
    selection && selection.end >= selection.start
      ? sequence.slice(selection.start - 1, selection.end)
      : sequence
  ), [sequence, selection]);

  const cleaned = cleanQuery(query, info.query);
  const req = { query, program, database, expect: Number(expect) || undefined, title };
  const problems = problemsWith(req);
  const warnings = warningsFor(req);

  /** A second hand, only while there is something to count down. */
  useEffect(() => {
    if (phase.at !== 'waiting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.at]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /*
   * One timer, driven by the phase rather than by a function calling itself.
   *
   * The recursive version read `nextAt` out of a closure captured before the
   * state it describes existed, so the second wait was scheduled against the
   * first one's deadline. Hanging the timer off the phase means the moment to
   * ask again is in exactly one place, and the countdown on screen reads the
   * same value.
   */
  useEffect(() => {
    if (phase.at !== 'waiting') return;
    const { rid, since, nextAt } = phase;
    const t = setTimeout(async () => {
      const fd = new FormData();
      fd.append('rid', rid);
      const r = await checkBlast(fd);
      if (!r.ok) { setPhase({ at: 'error', message: r.error, rid }); return; }
      if (r.state === 'waiting') {
        setPhase({ at: 'waiting', rid, since, nextAt: Date.now() + r.pollInMs });
        return;
      }
      if (r.state === 'no-hits') { setPhase({ at: 'empty', rid }); return; }
      setPhase({ at: 'done', rid, report: r.report });
    }, Math.max(0, nextAt - Date.now()));
    timer.current = t;
    return () => clearTimeout(t);
  }, [phase]);

  const start = (since: number) => {
    setPhase({ at: 'starting' });
    void (async () => {
      const fd = new FormData();
      fd.append('query', query);
      fd.append('program', program);
      fd.append('database', database);
      fd.append('expect', expect);
      if (title) fd.append('title', title);
      const r = await runBlast(fd);
      if (!r.ok) { setPhase({ at: 'error', message: r.error }); return; }
      setPhase({ at: 'waiting', rid: r.rid, since, nextAt: since + r.pollInMs });
    })();
  };

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase({ at: 'idle' });
  };

  /*
   * Collecting a search that was started somewhere else, or earlier.
   *
   * The whole point of saying the request id out loud is that it outlives the
   * page: a search takes minutes, people close tabs, and NCBI keeps the result
   * for a day. Without somewhere to put the id back, the id was a fact with
   * nothing to do -- and the only way to see a finished search was to not have
   * left it.
   */
  const collectExisting = (since: number) => {
    const typed = resume.trim().toUpperCase();
    const rid = typed || (phase.at === 'error' ? phase.rid ?? '' : '');
    if (!rid) return;
    setPhase({ at: 'waiting', rid, since, nextAt: since });
  };

  return (
    <div style={{ padding: '1rem 1.25rem' }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.2rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <Search size={16} /> BLAST at NCBI
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.9rem' }}>
        {selection && selection.end >= selection.start
          ? <>The selection, {selection.start.toLocaleString()}–{selection.end.toLocaleString()} ({cleaned.length.toLocaleString()} {info.query === 'dna' ? 'bp' : 'aa'}).</>
          : <>The whole sequence, {cleaned.length.toLocaleString()} {info.query === 'dna' ? 'bp' : 'aa'}. Select a region to search part of it.</>}
      </p>

      {/*
        Said before the button, not after. A search sends the sequence to a
        third party, and an unpublished construct is exactly the kind of thing
        somebody would want to know that about before clicking, not once it has
        already left.
      */}
      <p style={{
        fontSize: '0.78rem', color: '#a3560a', background: 'rgba(217,119,6,0.09)',
        border: '1px solid rgba(217,119,6,0.25)', borderRadius: 8,
        padding: '0.4rem 0.6rem', margin: '0 0 0.9rem',
      }}>
        This sends the sequence above to NCBI, who keep the search for 24 hours.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' }}>
        <Field label="Program">
          <select value={program} onChange={e => setProgram(e.target.value as BlastProgram)}
                  className="input-control" style={input} disabled={phase.at === 'waiting' || phase.at === 'starting'}>
            {programs.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Database">
          <select value={database} onChange={e => setDatabase(e.target.value as BlastDatabase)}
                  className="input-control" style={{ ...input, minWidth: 230 }} disabled={phase.at === 'waiting' || phase.at === 'starting'}>
            {info.databases.map(d => <option key={d} value={d}>{DATABASES[d]}</option>)}
          </select>
        </Field>
        <Field label="Expect">
          <input value={expect} onChange={e => setExpect(e.target.value)} className="input-control"
                 style={{ ...input, width: 80 }} disabled={phase.at === 'waiting' || phase.at === 'starting'} />
        </Field>
        <button
          className="btn btn-primary"
          style={{ fontSize: '0.82rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}
          disabled={problems.length > 0 || phase.at === 'starting' || phase.at === 'waiting'}
          /*
            The clock is read here, in the click, and handed in. The elapsed
            time this panel shows counts from when somebody asked -- which
            includes the seconds the server spends waiting out NCBI's
            ten-second gap before the request even goes.
          */
          onClick={() => start(Date.now())}
        >
          <Upload size={14} />
          {phase.at === 'starting' ? 'Submitting…' : phase.at === 'waiting' ? 'Running…' : 'Search NCBI'}
        </button>
        {phase.at === 'waiting' && (
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={stop}>
            Stop waiting
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>{info.about}</p>

      {problems.map(p => <Note key={p} tone="bad">{p}</Note>)}
      {problems.length === 0 && warnings.map(w => <Note key={w} tone="warn">{w}</Note>)}

      {phase.at === 'waiting' && (
        <div style={{ fontSize: '0.82rem', marginTop: '0.6rem' }}>
          <strong>Running at NCBI.</strong>{' '}
          {Math.round((now - phase.since) / 1000)}s so far; next check in{' '}
          {Math.max(0, Math.ceil((phase.nextAt - now) / 1000))}s.
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Request id <code>{phase.rid}</code>. NCBI keeps it for 24 hours, so this can be left and
            the result collected later.
          </div>
        </div>
      )}

      {/*
        Offered after a failure as well as before a search. A poll that failed
        because the network dropped has not lost the search -- it is still
        running at NCBI under the id shown above -- and the one thing to do
        about it is ask again.
      */}
      {(phase.at === 'idle' || phase.at === 'error') && (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          <Field label="Or collect a request id">
            <input value={resume || (phase.at === 'error' ? phase.rid ?? '' : '')}
                   onChange={e => setResume(e.target.value)} placeholder="DHM47F0A014"
                   className="input-control" style={{ ...input, width: 160, fontFamily: 'monospace' }} />
          </Field>
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
                  disabled={!(resume.trim() || (phase.at === 'error' && phase.rid))}
                  onClick={() => collectExisting(Date.now())}>
            Collect
          </button>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            A search started here or at NCBI, within the last 24 hours.
          </span>
        </div>
      )}

      {phase.at === 'empty' && (
        <Note tone="warn">Nothing in {DATABASES[database]} matched, at an expect threshold of {expect}.</Note>
      )}

      {phase.at === 'error' && <Note tone="bad">{phase.message}</Note>}

      {phase.at === 'done' && <Hits report={phase.report} rid={phase.rid} subject={subjectKind(database)} />}
    </div>
  );
}

/** Which NCBI collection a hit's accession lives in, for the link to it. */
function subjectKind(db: BlastDatabase): 'nuccore' | 'protein' {
  return db === 'core_nt' || db === 'refseq_select_rna' ? 'nuccore' : 'protein';
}

function Hits({ report, rid, subject }: { report: BlastReport; rid: string; subject: 'nuccore' | 'protein' }) {
  if (report.hits.length === 0) {
    return <Note tone="warn">The report came back with no hits in it.</Note>;
  }
  return (
    <div style={{ marginTop: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <strong style={{ fontSize: '0.86rem' }}>{report.hits.length} hits</strong>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          {report.program} against {report.database}, query {report.queryLength.toLocaleString()} long
        </span>
        <a href={`https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Get&RID=${rid}`} target="_blank" rel="noreferrer"
           style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          the full report at NCBI <ExternalLink size={11} />
        </a>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr>
            {['Accession', 'Description', 'Identity', 'Query covered', 'E value', 'Score'].map((h, i) => (
              <th key={h} style={{
                textAlign: i > 1 ? 'right' : 'left', padding: '0.3rem 0.5rem',
                borderBottom: '1px solid var(--glass-border)', fontWeight: 600, whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.hits.map(h => <HitRow key={h.accession + h.evalue} hit={h} subject={subject} />)}
        </tbody>
      </table>
    </div>
  );
}

function HitRow({ hit, subject }: { hit: BlastHit; subject: 'nuccore' | 'protein' }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <a href={`https://www.ncbi.nlm.nih.gov/${subject}/${encodeURIComponent(hit.accession)}`}
           target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace' }}>
          {hit.accession}
        </a>
      </td>
      <td style={cell}>
        {hit.title}
        {hit.organism && (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}> — {hit.organism}</span>
        )}
      </td>
      <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hit.identity.toFixed(1)}%</td>
      <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {hit.coverage.toFixed(0)}%
        {hit.hsps.length > 1 && (
          <span style={{ color: 'var(--text-muted)' }} title="Several separate alignments to this record">
            {' '}({hit.hsps.length}×)
          </span>
        )}
      </td>
      <td style={{ ...cell, textAlign: 'right', fontFamily: 'monospace' }}>{formatE(hit.evalue)}</td>
      <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(hit.bitScore)}</td>
    </tr>
  );
}

/**
 * E values span forty orders of magnitude, and both ends matter: 0 is a
 * certainty and 3e-4 is a maybe. Exponential below a thousandth, plain above.
 */
function formatE(e: number): string {
  if (e === 0) return '0';
  if (!Number.isFinite(e)) return '—';
  return e < 0.001 || e >= 1000 ? e.toExponential(0) : String(Math.round(e * 1000) / 1000);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{
        fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--text-muted)',
      }}>{label}</span>
      {children}
    </label>
  );
}

function Note({ tone, children }: { tone: 'bad' | 'warn'; children: React.ReactNode }) {
  const colour = tone === 'bad' ? '#b91c1c' : '#a3560a';
  return (
    <p style={{ fontSize: '0.8rem', color: colour, margin: '0.35rem 0 0' }}>{children}</p>
  );
}

const input: React.CSSProperties = { fontSize: '0.8rem', padding: '0.26rem 0.4rem' };
const cell: React.CSSProperties = { padding: '0.32rem 0.5rem', verticalAlign: 'top' };
