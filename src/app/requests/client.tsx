'use client';
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Inbox, Plus, AlertTriangle } from 'lucide-react';
import {
  REQUEST_KINDS, kindById, bodyFor, STATE_LABELS, allowedMoves, rolesOf,
  lateBy, isOpen, type RequestState,
} from '@/lib/requests';
import { commentHref } from '@/lib/mentions';
import { describeSpan } from '@/lib/custody';
import { createRequest, moveRequest } from '@/app/actions/requests';

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  state: RequestState;
  outcome: string | null;
  createdAt: string;
  neededBy: string | null;
  requesterId: string;
  requesterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  projectName: string | null;
  subjects: { kind: string; targetId: string; label: string }[];
}

type Filter = 'open' | 'mine' | 'asked' | 'all';

export default function RequestsClient({ items, summary, me, people, projects }: {
  items: Item[];
  summary: string;
  me: string;
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [composing, setComposing] = useState(false);

  const shown = useMemo(() => items.filter(i => {
    if (filter === 'open') return isOpen(i.state);
    if (filter === 'mine') return i.assigneeId === me && isOpen(i.state);
    if (filter === 'asked') return i.requesterId === me;
    return true;
  }), [items, filter, me]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Inbox size={24} /> Requests
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.2rem', fontSize: '0.86rem' }}>{summary}</p>
        </div>
        <button className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                onClick={() => setComposing(c => !c)}>
          <Plus size={15} /> {composing ? 'Cancel' : 'Ask for something'}
        </button>
      </div>

      {composing && <Compose people={people} projects={projects} onDone={() => setComposing(false)} />}

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        {([['open', 'Waiting'], ['mine', 'I am doing'], ['asked', 'I asked for'], ['all', 'Everything']] as [Filter, string][])
          .map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={filter === f ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.78rem', padding: '0.22rem 0.6rem' }}>
              {label}
            </button>
          ))}
      </div>

      {shown.length === 0
        ? <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>Nothing here.</p>
        : shown.map(i => <Row key={i.id} item={i} me={me} />)}
    </div>
  );
}

function Row({ item, me }: { item: Item; me: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const moves = allowedMoves(item.state, rolesOf(item, me));
  const late = lateBy(item);
  const kind = kindById(item.kind);

  const go = (to: RequestState) => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('id', item.id);
      fd.append('to', to);
      fd.append('outcome', outcome);
      const r = await moveRequest(fd);
      if ('error' in r) { setError(r.error!); return; }
      setOutcome('');
      router.refresh();
    });
  };

  return (
    <div className="glass-panel" style={{
      padding: '0.8rem 1.1rem', marginBottom: '0.6rem',
      borderLeft: late !== null ? '3px solid #b91c1c' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(o => !o)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.92rem', fontWeight: 600, textAlign: 'left', color: 'inherit', fontFamily: 'inherit' }}>
          {item.title}
        </button>
        <State state={item.state} />
        {kind && <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{kind.name}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.76rem', color: late !== null ? '#b91c1c' : 'var(--text-muted)' }}>
          {late !== null && <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} />}{' '}
          {late !== null
            ? `${describeSpan(late)} past the day it was wanted`
            : item.neededBy ? `wanted by ${item.neededBy}` : 'no date'}
        </span>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
        {item.requesterName} asked
        {item.assigneeName ? ` · ${item.assigneeName} is doing it` : ' · nobody has taken it on'}
        {item.projectName && ` · ${item.projectName}`}
        {item.subjects.length > 0 && ` · ${item.subjects.length} ${kind?.subjects ?? 'records'}`}
      </div>

      {open && (
        <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--glass-border)', paddingTop: '0.6rem' }}>
          {item.body && (
            <p style={{ fontSize: '0.84rem', whiteSpace: 'pre-wrap', margin: '0 0 0.6rem', lineHeight: 1.5 }}>{item.body}</p>
          )}
          {item.subjects.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
              {item.subjects.map(s => {
                const href = commentHref(s.kind, s.targetId);
                return href
                  ? <Link key={s.targetId} href={href} style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{s.label}</Link>
                  : <span key={s.targetId} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.label}</span>;
              })}
            </div>
          )}
          {item.outcome && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>
              <strong>{STATE_LABELS[item.state]}:</strong> {item.outcome}
            </p>
          )}

          {moves.length > 0 && (
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {/*
                A reason is asked for before declining rather than after. A
                refusal with no reason leaves the asker not knowing whether to
                ask again, ask somebody else, or do it themselves.
              */}
              {moves.some(m => m.to === 'DECLINED' || m.to === 'WITHDRAWN') && (
                <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Why (needed to decline)"
                       className="input-control" style={{ fontSize: '0.78rem', padding: '0.22rem 0.4rem', width: 220 }} />
              )}
              {moves.map(m => (
                <button key={m.to} title={m.about} disabled={pending}
                        className={m.to === 'DONE' ? 'btn btn-primary' : 'btn btn-secondary'}
                        style={{ fontSize: '0.78rem', padding: '0.22rem 0.55rem' }}
                        onClick={() => go(m.to)}>
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

function State({ state }: { state: RequestState }) {
  const colour: Record<RequestState, string> = {
    OPEN: '#a3560a', ACCEPTED: '#1d4ed8', DONE: '#15803d',
    DECLINED: '#b91c1c', WITHDRAWN: 'var(--text-muted)',
  };
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      color: colour[state], border: `1px solid ${colour[state]}44`, borderRadius: 6, padding: '0.05rem 0.35rem',
    }}>
      {STATE_LABELS[state]}
    </span>
  );
}

function Compose({ people, projects, onDone }: {
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [kindId, setKindId] = useState(REQUEST_KINDS[0].id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(bodyFor(REQUEST_KINDS[0]));
  const [neededBy, setNeededBy] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kind = kindById(kindId)!;

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <Field label="What kind">
          <select value={kindId} className="input-control" style={input}
                  onChange={e => { setKindId(e.target.value); setBody(bodyFor(kindById(e.target.value)!)); }}>
            {REQUEST_KINDS.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
        <Field label="Wanted by">
          <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} className="input-control" style={input} />
        </Field>
        <Field label="Anybody in particular">
          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="input-control" style={input}>
            <option value="">Leave it in the queue</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input-control" style={input}>
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0.4rem' }}>{kind.about}</p>

      <input value={title} onChange={e => setTitle(e.target.value)}
             placeholder="One line: what you need" className="input-control"
             style={{ width: '100%', fontSize: '0.88rem', padding: '0.4rem 0.6rem', marginBottom: '0.5rem' }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={7}
                style={{
                  width: '100%', fontSize: '0.83rem', padding: '0.5rem 0.6rem', borderRadius: 8,
                  border: '1px solid var(--glass-border)', resize: 'vertical', fontFamily: 'inherit',
                }} />

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
        <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} disabled={pending || !title.trim()}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('kind', kindId);
                  fd.append('title', title);
                  fd.append('body', body);
                  fd.append('neededBy', neededBy);
                  fd.append('assigneeId', assigneeId);
                  fd.append('projectId', projectId);
                  const r = await createRequest(fd);
                  if ('error' in r) { setError(r.error!); return; }
                  onDone();
                  router.refresh();
                })}>
          {pending ? 'Asking…' : 'Ask'}
        </button>
        <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={onDone}>Cancel</button>
      </div>
      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { fontSize: '0.83rem', padding: '0.35rem 0.5rem', width: '100%' };
