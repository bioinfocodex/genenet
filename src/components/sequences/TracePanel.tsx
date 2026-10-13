'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isAb1, parseAb1 } from '@/lib/formats/ab1';
import {
  verifyTrace, peakWindow,
  type TraceVerification, type TraceDiscrepancy, type OrientedTrace, type TraceRead,
} from '@/lib/trace-alignment';
import { deleteRead } from '@/app/actions/reads';
import { coverageOf, unresolved, type Agreement, type Coverage } from '@/lib/read-coverage';
import { signRecord } from '@/app/actions/signatures';
import { useRouter } from 'next/navigation';

/**
 * Sanger traces against this sequence: load the .ab1 files a facility sends
 * back, see which reads confirm the construct, and look at the peaks under
 * anything that does not.
 */

const BASE_COLOUR: Record<string, string> = { A: '#16a34a', C: '#2563eb', G: '#111827', T: '#dc2626' };
const KIND_LABEL: Record<TraceDiscrepancy['kind'], string> = {
  match: 'match', mismatch: 'mismatch', insertion: 'insertion', deletion: 'deletion', mixed: 'mixed peak',
};

/** A sign-off that the sequence matches its reads. */
export interface VerificationInfo {
  id: string;
  at: string;
  signerName: string;
  note: string | null;
  /** False once the sequence has been edited since. */
  current: boolean;
}

/** A read stored with the sequence, as the page lists it. */
export interface SavedReadInfo {
  id: string;
  fileName: string;
  sampleName: string | null;
  runDate: string | null;
  uploadedBy: string;
}

interface LoadedRead {
  /** Set once the read is stored with the sequence. */
  id?: string;
  file: string;
  sampleName: string;
  runDate: string;
  uploadedBy?: string;
  trace: TraceRead | null;
  error?: string;
}

function parseTrace(file: string, bytes: Uint8Array): LoadedRead {
  if (!isAb1(bytes)) return { file, sampleName: '', runDate: '', trace: null, error: 'Not an ABI trace file' };
  const t = parseAb1(bytes, { includeTraces: true });
  if (!t) return { file, sampleName: '', runDate: '', trace: null, error: 'The trace file could not be read' };
  return {
    file, sampleName: t.sampleName, runDate: t.runDate,
    trace: {
      name: t.sampleName || file, sequence: t.sequence, quality: t.quality,
      baseOrder: t.baseOrder, traces: t.traces, peakLocations: t.peakLocations,
    },
  };
}

export default function TracePanel({ sequenceId, reference, circular, savedReads = [], verifications = [] }: {
  sequenceId: string;
  reference: string;
  circular: boolean;
  savedReads?: SavedReadInfo[];
  verifications?: VerificationInfo[];
}) {
  const [reads, setReads] = useState<LoadedRead[]>([]);
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLow, setShowLow] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Reads stored with the sequence are fetched and parsed once, on opening.
  const savedKey = savedReads.map(r => r.id).join(',');
  useEffect(() => {
    if (!savedReads.length) return;
    let cancelled = false;
    setBusy(true);
    Promise.all(savedReads.map(async info => {
      try {
        const res = await fetch(`/api/reads/${info.id}`);
        if (!res.ok) throw new Error(`could not be fetched (${res.status})`);
        const parsed = parseTrace(info.fileName, new Uint8Array(await res.arrayBuffer()));
        return { ...parsed, id: info.id, uploadedBy: info.uploadedBy };
      } catch (e) {
        return { id: info.id, file: info.fileName, sampleName: info.sampleName ?? '', runDate: info.runDate ?? '', trace: null, error: (e as Error).message };
      }
    })).then(loaded => {
      if (cancelled) return;
      setReads(prev => [...loaded, ...prev.filter(p => !p.id || !loaded.some(l => l.id === p.id))]);
      setBusy(false);
    });
    return () => { cancelled = true; };
    // Keyed on the ids, not the array, which is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // Verdicts are worked out against the sequence as it is now, so editing the
  // sequence re-judges every read rather than leaving an old verdict standing.
  const results = useMemo(() => reads.map(r => {
    if (!r.trace) return null;
    try { return verifyTrace(reference, circular, r.trace); } catch { return null; }
  }), [reads, reference, circular]);

  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setNotice(null);
    const list = Array.from(files);
    const parsed = await Promise.all(list.map(async f => parseTrace(f.name, new Uint8Array(await f.arrayBuffer()))));

    // Store the readable ones with the sequence; the rest are shown with why.
    const form = new FormData();
    list.forEach((f, i) => { if (parsed[i].trace) form.append('files', f); });
    if (form.getAll('files').length) {
      try {
        const res = await fetch(`/api/sequences/${sequenceId}/reads`, { method: 'POST', body: form });
        const body = await res.json() as { saved?: { id: string; fileName: string }[]; rejected?: { fileName: string; error: string }[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
        const unclaimed = [...(body.saved ?? [])];
        parsed.forEach(p => {
          const k = unclaimed.findIndex(s => s.fileName === p.file);
          if (k >= 0 && p.trace) { p.id = unclaimed[k].id; unclaimed.splice(k, 1); }
        });
        for (const r of body.rejected ?? []) {
          const p = parsed.find(x => x.file === r.fileName && !x.id);
          if (p) p.error = r.error;
        }
      } catch (e) {
        setNotice(`Shown here but not saved: ${(e as Error).message}`);
      }
    }
    setReads(prev => [...prev, ...parsed]);
    setSelected(reads.length);
    setFocus(null);
    setBusy(false);
  };

  const remove = async (i: number) => {
    const r = reads[i];
    if (r.id) {
      const res = await deleteRead(r.id);
      if ('error' in res) { setNotice(res.error); return; }
    }
    setReads(prev => prev.filter((_, j) => j !== i));
    setSelected(sel => (sel >= i && sel > 0 ? sel - 1 : sel));
    setFocus(null);
  };

  const current = results[selected] ?? null;

  // All usable reads together: what is covered, and what each difference
  // looks like across every read that sees it.
  const coverage = useMemo(() => coverageOf(
    reference.replace(/[^A-Za-z]/g, '').length,
    results.flatMap((v, i) => (v ? [{ name: v.name || reads[i].file, verification: v }] : [])),
  ), [results, reads, reference]);
  const shown = useMemo(
    () => current?.discrepancies.filter(d => showLow || d.confidence === 'high') ?? [],
    [current, showLow],
  );

  const step = (dir: 1 | -1) => {
    if (!shown.length) return;
    const cols = shown.map(d => d.column);
    const from = focus ?? (dir === 1 ? -1 : Infinity);
    const next = dir === 1 ? cols.find(c => c > from) ?? cols[0] : [...cols].reverse().find(c => c < from) ?? cols.at(-1)!;
    setFocus(next);
  };

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label className="btn btn-primary" style={{ fontSize: '0.82rem', cursor: 'pointer', display: 'inline-block' }}>
          {busy ? 'Working…' : 'Add .ab1 trace files'}
          <input type="file" accept=".ab1,.abi,.ab!" multiple hidden disabled={busy} onChange={e => { load(e.target.files); e.target.value = ''; }} />
        </label>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.75rem' }}>
          Saved with this sequence. Ends below Q20 are trimmed; a difference counts when its call is Q30 or better.
        </span>
      </div>

      {coverage && coverage.spans.length > 0 && (
        <ReadsOverview
          coverage={coverage}
          reads={reads.map((r, i) => ({ name: results[i]?.name ?? r.file, verification: results[i] }))}
          onPickRead={(i, column) => { setSelected(i); setFocus(column); }}
        />
      )}

      {(coverage.spans.length > 0 || verifications.length > 0) && (
        <SignOff
          sequenceId={sequenceId}
          coverage={coverage}
          verifications={verifications}
          unsaved={reads.filter(r => !r.id && r.trace).map(r => r.file)}
        />
      )}

      {reads.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
          {reads.map((r, i) => {
            const v = results[i];
            const high = v?.discrepancies.filter(d => d.confidence === 'high').length ?? 0;
            const chip = r.error || !v ? ['error', '#dc2626'] : v.verdict === 'confirmed' ? ['confirmed', '#16a34a'] : v.verdict === 'differs' ? [`${high} difference${high === 1 ? '' : 's'}`, '#ea580c'] : ['unusable', '#64748b'];
            return (
              <div key={r.id ?? `local-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <button
                onClick={() => { setSelected(i); setFocus(null); }}
                style={{
                  flex: 1, minWidth: 0,
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0.7rem', textAlign: 'left',
                  border: `1px solid ${i === selected ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                  background: i === selected ? 'var(--accent-blue-15)' : 'white', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v?.name ?? r.file}</span>
                {v && v.verdict !== 'unusable' && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {v.reversed ? '◀' : '▶'} {v.coverageStart.toLocaleString()}–{v.coverageEnd.toLocaleString()} · Q{v.meanQuality ?? '?'}
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: chip[1], background: `${chip[1]}18`, padding: '0.1rem 0.45rem', borderRadius: 4 }}>{chip[0]}</span>
                {!r.id && !r.error && <span title="Shown here but not stored with the sequence" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>unsaved</span>}
              </button>
              <button
                onClick={() => remove(i)}
                title={r.id ? 'Remove this read from the sequence' : 'Close this read'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0 0.25rem' }}
              >✕</button>
              </div>
            );
          })}
        </div>
      )}

      {notice && (
        <div style={{ padding: '0.5rem 0.8rem', marginBottom: '0.6rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 7, fontSize: '0.8rem', color: '#92400e' }}>{notice}</div>
      )}

      {reads[selected]?.error && (
        <div style={{ padding: '0.6rem 0.9rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, fontSize: '0.82rem', color: '#dc2626' }}>
          {reads[selected].file}: {reads[selected].error}
        </div>
      )}

      {current && current.verdict === 'unusable' && (
        <div style={{ padding: '0.6rem 0.9rem', background: '#f8fafc', border: '1px solid var(--glass-border)', borderRadius: 7, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Too little of this read is above Q20 to judge it. A failed reaction, or a trace from a different template.
        </div>
      )}

      {current && current.verdict !== 'unusable' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {(current.identity * 100).toFixed(1)}% identity over the usable {current.usableEnd - current.usableStart} bp
              {reads[selected].runDate ? ` · run ${reads[selected].runDate}` : ''}
            </span>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={showLow} onChange={e => setShowLow(e.target.checked)} /> include low-quality calls
            </label>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => step(-1)} disabled={!shown.length}>◀ Prev</button>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => step(1)} disabled={!shown.length}>Next ▶</button>
          </div>

          {/* Keyed by read, so picking another starts it at its own beginning. */}
          <TraceViewer key={selected} verification={current} focus={focus} onFocus={setFocus} />

          {shown.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', marginTop: '0.75rem' }}>
              <thead>
                <tr>{['Position', 'Kind', 'Ref → read', 'Quality', 'Second peak', 'Evidence'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.3rem 0.4rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {shown.map(d => (
                  <tr
                    key={d.column}
                    onClick={() => setFocus(d.column)}
                    style={{ cursor: 'pointer', background: d.column === focus ? 'var(--accent-blue-15)' : undefined }}
                  >
                    <td style={cell}>{d.position.toLocaleString()}</td>
                    <td style={cell}>{KIND_LABEL[d.kind]}</td>
                    <td style={{ ...cell, fontFamily: 'monospace' }}>{d.reference} → {d.read}</td>
                    <td style={cell}>{d.quality ?? '—'}</td>
                    <td style={cell}>{d.secondaryRatio != null ? `${Math.round(d.secondaryRatio * 100)}%` : '—'}</td>
                    <td style={{ ...cell, color: d.confidence === 'high' ? '#ea580c' : 'var(--text-muted)' }}>
                      {d.confidence === 'high' ? 'well supported' : 'weak call'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: '0.82rem', color: '#16a34a', marginTop: '0.75rem' }}>
              ✓ No well-supported difference from the reference across {current.coverageStart.toLocaleString()}–{current.coverageEnd.toLocaleString()}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--glass-border)' };

// ─── Chromatogram ─────────────────────────────────────────────────────────────

// ─── Signing off ──────────────────────────────────────────────────────────────

/**
 * Record that the sequence on file is what sequencing shows.
 *
 * The note is written from the evidence rather than typed: which reads, how
 * much they cover, and every difference not explained as a read error, which
 * the signer has to accept in so many words. A sign-off that does not say what
 * it accepted is a tick, not a record.
 */
function SignOff({ sequenceId, coverage, verifications, unsaved }: {
  sequenceId: string;
  coverage: Coverage;
  verifications: VerificationInfo[];
  unsaved: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accept, setAccept] = useState(false);
  const [password, setPassword] = useState('');
  const [extra, setExtra] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const outstanding = unresolved(coverage);
  const n = coverage.length;

  const evidence = [
    `Reads: ${coverage.spans.map(s => `${s.read} ${s.reversed ? '(rev)' : '(fwd)'} ${s.start}-${s.end}`).join('; ')}.`,
    `Covered ${coverage.covered} of ${n} bp (${((coverage.covered / n) * 100).toFixed(1)}%), ${coverage.bothStrands} bp from both strands.`,
    outstanding.length
      ? `Accepted differences: ${outstanding.map(d => `${d.change} (${d.agreement})`).join(', ')}.`
      : 'No unexplained differences.',
  ].join(' ');

  const sign = async () => {
    setError(null);
    setPending(true);
    const fd = new FormData();
    fd.set('model', 'GeneSequence');
    fd.set('recordId', sequenceId);
    fd.set('meaning', 'verified');
    fd.set('password', password);
    fd.set('note', extra.trim() ? `${evidence} ${extra.trim()}` : evidence);
    const r = await signRecord(fd);
    setPending(false);
    if ('error' in r) { setError(r.error); return; }
    setPassword(''); setExtra(''); setAccept(false); setOpen(false);
    router.refresh();
  };

  return (
    <div style={{ marginBottom: '1rem', padding: '0.7rem 0.9rem', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong>Sequence verification</strong>
        {!open && coverage.spans.length > 0 && (
          <button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => setOpen(true)}>
            Sign off as sequence-verified
          </button>
        )}
      </div>
      {verifications.length === 0 && <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>Not signed off yet.</div>}
      {verifications.map(v => (
        <div key={v.id} style={{ marginTop: '0.35rem', color: v.current ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          {v.current ? '✓' : '○'} {v.signerName}, {new Date(v.at).toLocaleString()}{v.current ? '' : ' — superseded: the sequence was edited afterwards'}
          {v.note && <div style={{ color: 'var(--text-secondary)', marginLeft: '1rem' }}>{v.note}</div>}
        </div>
      ))}

      {open && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <div style={{ padding: '0.5rem 0.65rem', background: 'var(--bg-secondary)', borderRadius: 6, color: 'var(--text-secondary)' }}>{evidence}</div>
          {unsaved.length > 0 && (
            <div style={{ color: '#b91c1c' }}>Not stored with the sequence, so not part of the record: {unsaved.join(', ')}.</div>
          )}
          {outstanding.length > 0 && (
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} />
              <span>I accept {outstanding.length === 1 ? 'this difference' : `these ${outstanding.length} differences`} as part of the construct, or as understood.</span>
            </label>
          )}
          <input value={extra} onChange={e => setExtra(e.target.value)} placeholder="Note (optional), e.g. which clone or prep" className="input-control" style={{ padding: '0.35rem 0.55rem', fontSize: '0.8rem' }} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password, to sign" className="input-control" style={{ padding: '0.35rem 0.55rem', fontSize: '0.8rem' }} />
          {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ fontSize: '0.78rem' }} onClick={sign}
              disabled={pending || !password || (outstanding.length > 0 && !accept)}>
              {pending ? 'Signing…' : 'Sign'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Several reads together ───────────────────────────────────────────────────

const AGREEMENT: Record<Agreement, { label: string; colour: string; meaning: string }> = {
  confirmed: { label: 'confirmed', colour: '#dc2626', meaning: 'two or more reads agree: this is in the plasmid' },
  contested: { label: 'contested', colour: '#7c3aed', meaning: 'reads clearly disagree, or a mixed peak: a mixed template?' },
  single: { label: 'one read', colour: '#ea580c', meaning: 'only one read covers it: sequence again to settle' },
  contradicted: { label: 'read error', colour: '#64748b', meaning: 'another read clearly reads the reference base' },
};

const VERDICT_COLOUR: Record<string, string> = { confirmed: '#16a34a', differs: '#ea580c', unusable: '#94a3b8' };

function ReadsOverview({ coverage, reads, onPickRead }: {
  coverage: Coverage;
  reads: { name: string; verification: TraceVerification | null }[];
  onPickRead: (readIndex: number, column: number) => void;
}) {
  const [comparePos, setComparePos] = useState<number | null>(null);
  const n = coverage.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(x === n ? 0 : 1)}%`;
  const open = unresolved(coverage);
  const lanes = coverage.spans;
  const W = 1000;
  const laneH = 9;
  const top = 12;
  const H = top + lanes.length * (laneH + 3) + 4;
  const x = (p: number) => ((p - 1) / n) * W;

  const pieces = (start: number, end: number) =>
    end >= start ? [[start, end]] : [[start, n], [1, end]];

  // Readings of every read that has a base at the chosen position.
  const atPos = comparePos == null ? [] : reads.flatMap((r, i) => {
    const v = r.verification;
    if (!v) return [];
    const column = v.columns.findIndex(c => c.refPos === comparePos && c.kind !== 'insertion');
    return column >= 0 ? [{ i, name: r.name, v, column }] : [];
  });

  return (
    <div style={{ marginBottom: '1rem', padding: '0.75rem 0.9rem', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
        <strong>All reads together</strong>
        <span style={{ color: 'var(--text-secondary)' }}>
          {coverage.covered.toLocaleString()} of {n.toLocaleString()} bp covered ({pct(coverage.covered)}) ·
          {' '}{coverage.bothStrands.toLocaleString()} bp from both strands ·
          {' '}{coverage.singleRead.toLocaleString()} bp on one read only
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, cursor: 'crosshair', display: 'block' }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setComparePos(Math.min(n, Math.max(1, Math.round(((e.clientX - rect.left) / rect.width) * n) + 1)));
        }}
      >
        <title>Click a position to compare every read there</title>
        {/* Depth: red where nothing covers, amber on one read, green on two or more. */}
        {coverage.depth.map((d, i) => (i % Math.max(1, Math.floor(n / W)) === 0 ? (
          <rect key={i} x={x(i + 1)} y={0} width={Math.max(1, W / n * Math.max(1, Math.floor(n / W)))} height={6}
            fill={d === 0 ? '#fecaca' : d === 1 ? '#fde68a' : '#86efac'} />
        ) : null))}
        {lanes.map((sp, k) => pieces(sp.start, sp.end).map(([a, b], j) => (
          <rect key={`${k}-${j}`} x={x(a)} y={top + k * (laneH + 3)} width={Math.max(2, x(b + 1) - x(a))} height={laneH}
            rx={2} fill={VERDICT_COLOUR[sp.verdict]} opacity={0.75}>
            <title>{`${sp.read}: ${sp.start.toLocaleString()}–${sp.end.toLocaleString()} ${sp.reversed ? '(reverse)' : '(forward)'}`}</title>
          </rect>
        )))}
        {coverage.disagreements.map(d => (
          <line key={`${d.position}-${d.reference}`} x1={x(d.position)} x2={x(d.position)} y1={0} y2={H}
            stroke={AGREEMENT[d.agreement].colour} strokeWidth={2} opacity={0.8} />
        ))}
        {comparePos != null && <line x1={x(comparePos)} x2={x(comparePos)} y1={0} y2={H} stroke="#2563eb" strokeWidth={2} />}
      </svg>

      {coverage.gaps.length > 0 && (
        <div style={{ fontSize: '0.76rem', color: '#b91c1c', marginTop: '0.35rem' }}>
          Not covered: {coverage.gaps.slice(0, 6).map(g => `${g.start.toLocaleString()}–${g.end.toLocaleString()}`).join(', ')}
          {coverage.gaps.length > 6 ? ` and ${coverage.gaps.length - 6} more` : ''}
        </div>
      )}

      {coverage.disagreements.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', marginTop: '0.5rem' }}>
          <tbody>
            {coverage.disagreements.map(d => (
              <tr key={`${d.position}-${d.reference}`} onClick={() => setComparePos(d.position)}
                style={{ cursor: 'pointer', borderTop: '1px solid var(--glass-border)', background: comparePos === d.position ? 'var(--accent-blue-15)' : undefined }}>
                <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{d.change}</td>
                <td style={{ padding: '0.3rem 0.4rem', whiteSpace: 'nowrap' }}>
                  <span title={AGREEMENT[d.agreement].meaning} style={{ fontWeight: 700, color: AGREEMENT[d.agreement].colour }}>{AGREEMENT[d.agreement].label}</span>
                </td>
                <td style={{ padding: '0.3rem 0.4rem', color: 'var(--text-secondary)' }}>
                  {d.calls.map(c => `${c.read} ${c.reversed ? '◀' : '▶'} ${c.base || '—'}${c.quality != null ? ` Q${c.quality}` : ''}${c.mixed ? ' (mixed)' : ''}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: '0.78rem', color: '#16a34a', marginTop: '0.4rem' }}>No read differs from the reference anywhere it covers.</div>
      )}

      <div style={{ fontSize: '0.76rem', marginTop: '0.4rem', color: open.length ? '#b91c1c' : 'var(--text-muted)' }}>
        {open.length
          ? `${open.length} difference${open.length === 1 ? '' : 's'} not explained as a read error.`
          : coverage.disagreements.length ? 'Every difference is explained as a read error.' : ''}
      </div>

      {comparePos != null && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem' }}>
            Every read at {comparePos.toLocaleString()}
            <button onClick={() => setComparePos(null)} style={{ marginLeft: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
          </div>
          {atPos.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No read covers this position.</div>}
          {atPos.map(r => (
            <div key={r.i} style={{ marginBottom: '0.5rem' }}>
              <button onClick={() => onPickRead(r.i, r.column)} style={{ fontSize: '0.74rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)', padding: 0 }}>
                {r.name} {r.v.reversed ? '◀' : '▶'} — open this read here
              </button>
              <TraceViewer key={`${r.i}-${comparePos}`} verification={r.v} focus={r.column} onFocus={() => {}} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COL = 12;
const ROW = { ruler: 14, ref: 16, read: 16, quality: 18, trace: 120 };
const HEIGHT = ROW.ruler + ROW.ref + ROW.read + ROW.quality + ROW.trace + 6;

/**
 * Reference, read and trace in aligned columns, drawn to a canvas the width of
 * the view and redrawn on scroll -- an 800-base read is 9,600 px of trace, and
 * only what is on screen is worth drawing.
 */
function TraceViewer({ verification, focus, onFocus }: {
  verification: TraceVerification;
  focus: number | null;
  onFocus: (c: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(800);
  const { columns, trace, discrepancies } = verification;

  const marks = useMemo(() => {
    const m = new Map<number, TraceDiscrepancy>();
    for (const d of discrepancies) m.set(d.column, d);
    return m;
  }, [discrepancies]);

  // Scale to the typical primary peak in the aligned region, so one huge dye
  // blob does not flatten the rest of the read.
  const scale = useMemo(() => primaryPeakScale(trace, columns.map(c => c.readIndex)), [trace, columns]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The first position is jumped to, later ones scrolled to. A smooth scroll
  // started while the viewer is still being laid out is dropped, so a viewer
  // opened at a position showed the start of its read instead.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (focus == null || !scroller.current) return;
    const el = scroller.current;
    const left = Math.max(0, focus * COL - el.clientWidth / 2);
    if (placed.current) el.scrollTo({ left, behavior: 'smooth' });
    else {
      el.scrollLeft = left;
      setScrollLeft(el.scrollLeft);
      placed.current = true;
    }
  }, [focus]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${HEIGHT}px`;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, HEIGHT);

    const first = Math.max(0, Math.floor(scrollLeft / COL) - 1);
    const last = Math.min(columns.length, Math.ceil((scrollLeft + width) / COL) + 1);
    const yRef = ROW.ruler;
    const yRead = yRef + ROW.ref;
    const yQual = yRead + ROW.read;
    const yTrace = yQual + ROW.quality;
    const traceBase = HEIGHT - 4;

    g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    for (let k = first; k < last; k++) {
      const col = columns[k];
      const x = k * COL - scrollLeft;
      const mark = marks.get(k);

      if (mark) {
        g.fillStyle = mark.kind === 'mixed'
          ? 'rgba(124,58,237,0.12)'
          : mark.confidence === 'high' ? 'rgba(220,38,38,0.14)' : 'rgba(217,119,6,0.12)';
        g.fillRect(x, yRef, COL, HEIGHT - yRef);
      }
      if (k === focus) {
        g.strokeStyle = '#2563eb';
        g.lineWidth = 1.5;
        g.strokeRect(x + 0.75, yRef + 0.75, COL - 1.5, HEIGHT - yRef - 1.5);
      }

      if (col.kind !== 'insertion' && col.refPos % 10 === 0) {
        g.fillStyle = '#94a3b8';
        g.font = '10px ui-monospace, Menlo, monospace';
        g.fillText(String(col.refPos), x + COL / 2, ROW.ruler / 2);
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      }

      g.fillStyle = col.ref === '-' ? '#cbd5e1' : '#334155';
      g.fillText(col.ref, x + COL / 2, yRef + ROW.ref / 2);
      g.fillStyle = col.kind === 'match' ? '#64748b' : col.read === '-' ? '#cbd5e1' : '#dc2626';
      g.fillText(col.read, x + COL / 2, yRead + ROW.read / 2);

      if (col.quality != null) {
        const h = Math.min(1, col.quality / 60) * (ROW.quality - 3);
        g.fillStyle = col.quality >= 30 ? '#93c5fd' : col.quality >= 20 ? '#cbd5e1' : '#fda4af';
        g.fillRect(x + 2, yQual + ROW.quality - 1 - h, COL - 4, h);
      }

      if (col.readIndex != null) drawPeaks(g, trace, col.readIndex, x, yTrace, traceBase, scale);
    }
  }, [columns, trace, marks, focus, scrollLeft, width, scale]);

  useEffect(draw, [draw]);

  return (
    <div>
      <div
        ref={scroller}
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const k = Math.floor((e.clientX - rect.left + e.currentTarget.scrollLeft) / COL);
          if (k >= 0 && k < columns.length) onFocus(k);
        }}
        style={{ overflowX: 'auto', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'white', cursor: 'crosshair' }}
      >
        <div style={{ width: columns.length * COL, height: HEIGHT, position: 'relative' }}>
          <canvas ref={canvas} style={{ position: 'sticky', left: 0, top: 0, display: 'block' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        {Object.entries(BASE_COLOUR).map(([b, c]) => <span key={b}><span style={{ color: c, fontWeight: 800 }}>━</span> {b}</span>)}
        <span>Rows: reference · read · quality · trace</span>
        <span><span style={{ color: 'rgba(220,38,38,0.6)' }}>■</span> difference</span>
        <span><span style={{ color: 'rgba(217,119,6,0.6)' }}>■</span> weak call</span>
        <span><span style={{ color: 'rgba(124,58,237,0.6)' }}>■</span> mixed peak</span>
        <span>{verification.reversed ? 'Reverse read, shown as its complement' : 'Forward read'}</span>
      </div>
    </div>
  );
}

function drawPeaks(
  g: CanvasRenderingContext2D, trace: OrientedTrace, readIndex: number,
  x: number, top: number, bottom: number, scale: number,
) {
  const w = peakWindow(trace, readIndex);
  if (!w) return;
  const [from, to] = w;
  const span = Math.max(1, to - from);
  const height = bottom - top;
  g.lineWidth = 1.2;
  for (const base of ['A', 'C', 'G', 'T'] as const) {
    const data = trace.channels[base];
    if (!data.length) continue;
    g.strokeStyle = BASE_COLOUR[base];
    g.beginPath();
    // One point past the window joins this column's curve to the next one.
    for (let t = from; t <= Math.min(to, data.length - 1); t++) {
      const px = x + ((t - from) / span) * COL;
      const py = bottom - Math.min(1.15, (data[t] ?? 0) / scale) * height;
      if (t === from) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
  }
}

function primaryPeakScale(trace: OrientedTrace, readIndices: (number | null)[]): number {
  const heights: number[] = [];
  for (const i of readIndices) {
    if (i == null) continue;
    const p = trace.peaks[i];
    if (p === undefined) continue;
    heights.push(Math.max(...(['A', 'C', 'G', 'T'] as const).map(b => trace.channels[b][p] ?? 0)));
  }
  if (!heights.length) return 1;
  heights.sort((a, b) => a - b);
  return Math.max(1, heights[Math.floor(heights.length * 0.9)]);
}
