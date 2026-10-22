'use client';
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Columns3, Settings2, AlertTriangle, X } from 'lucide-react';
import {
  boardOf, boardSummary, sittingFor, isStuck, planStages, MAX_STAGES,
  type Stage, type Placed,
} from '@/lib/stages';
import { describeSpan } from '@/lib/custody';
import { commentHref } from '@/lib/mentions';
import { setStages, moveCard, removeCard } from '@/app/actions/stages';

/**
 * Where everything in a project has got to.
 *
 * A project was a list of records and a list of tasks; what it could not say
 * was which constructs are designed, which are cloned and which are waiting to
 * be verified. That answer lived on a whiteboard, and the whiteboard was right
 * until somebody rubbed it out.
 */
export default function StageBoard({ projectId, stages, cards }: {
  projectId: string;
  stages: Stage[];
  cards: (Placed & { id: string })[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const board = useMemo(() => boardOf(stages, cards), [stages, cards]);
  const summary = useMemo(() => boardSummary(board), [board]);

  const move = (card: Placed & { id: string }, stageId: string | null) => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('kind', card.kind);
      fd.append('targetId', card.targetId);
      fd.append('label', card.label);
      if (stageId) fd.append('stageId', stageId);
      const r = await moveCard(fd);
      if ('error' in r) { setError(r.error!); return; }
      router.refresh();
    });
  };

  if (stages.length === 0 && !editing) {
    return (
      <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
          <Columns3 size={16} />
          <h2 style={{ fontSize: '0.95rem', margin: 0, flex: 1 }}>Workflow</h2>
          <button className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.2rem 0.5rem' }}
                  onClick={() => setEditing(true)}>
            Set the stages
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          No stages yet. Name the steps this project&apos;s work goes through — design, clone, verify, express —
          and records can be moved along them.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.3rem' }}>
        <Columns3 size={16} />
        <h2 style={{ fontSize: '0.95rem', margin: 0 }}>Workflow</h2>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" style={{ fontSize: '0.76rem', padding: '0.2rem 0.5rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}
                onClick={() => setEditing(e => !e)}>
          <Settings2 size={12} /> {editing ? 'Done' : 'Stages'}
        </button>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.8rem' }}>{summary}</p>

      {editing && <StageEditor projectId={projectId} stages={stages} onDone={() => { setEditing(false); router.refresh(); }} />}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, board.columns.length)}, minmax(150px, 1fr))`, gap: '0.6rem', overflowX: 'auto' }}>
        {board.columns.map(col => (
          <div key={col.stage.id} style={{
            background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.5rem',
            border: '1px solid var(--glass-border)', minHeight: 90,
          }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              {col.stage.name}
              <span style={{ fontWeight: 400 }}> · {col.cards.length}</span>
            </div>
            {col.cards.map(c => (
              <Card key={`${c.kind}:${c.targetId}`} card={c as Placed & { id: string }}
                    stages={stages} pending={pending} onMove={move} projectId={projectId} />
            ))}
          </div>
        ))}
      </div>

      {/*
        Not hidden. A board that quietly leaves out part of a project gets read
        as the whole picture, which is worse than having no board at all.
      */}
      {board.unplaced.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            Not on the board · {board.unplaced.length}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {board.unplaced.map(c => (
              <Card key={`${c.kind}:${c.targetId}`} card={c as Placed & { id: string }}
                    stages={stages} pending={pending} onMove={move} projectId={projectId} inline />
            ))}
          </div>
        </div>
      )}

      {board.orphaned.length > 0 && (
        <p style={{ fontSize: '0.8rem', color: '#a3560a', marginTop: '0.6rem' }}>
          <AlertTriangle size={12} style={{ verticalAlign: '-2px' }} />{' '}
          {board.orphaned.length} record{board.orphaned.length === 1 ? ' is' : 's are'} in a stage that no longer
          exists. Put {board.orphaned.length === 1 ? 'it' : 'them'} somewhere, or they will stay out of sight.
        </p>
      )}

      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}

function Card({ card, stages, pending, onMove, projectId, inline }: {
  card: Placed & { id: string };
  stages: Stage[];
  pending: boolean;
  onMove: (card: Placed & { id: string }, stageId: string | null) => void;
  projectId: string;
  inline?: boolean;
}) {
  const router = useRouter();
  const [, startRemove] = useTransition();
  const href = commentHref(card.kind, card.targetId);
  const sat = sittingFor(card);
  const stuck = isStuck(card);

  return (
    <div style={{
      background: 'white', border: '1px solid var(--glass-border)', borderRadius: 6,
      padding: '0.35rem 0.45rem', marginBottom: inline ? 0 : '0.35rem',
      borderLeft: stuck ? '3px solid #b91c1c' : undefined,
      minWidth: inline ? 150 : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
        {href
          ? <Link href={href} style={{ fontSize: '0.8rem', fontWeight: 600 }}>{card.label}</Link>
          : <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{card.label}</span>}
        <span style={{ flex: 1 }} />
        <button title="Take off the board"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 1 }}
                onClick={() => startRemove(async () => {
                  const fd = new FormData();
                  fd.append('projectId', projectId);
                  fd.append('id', card.id);
                  await removeCard(fd);
                  router.refresh();
                })}>
          <X size={11} />
        </button>
      </div>
      {sat !== null && (
        <div style={{ fontSize: '0.68rem', color: stuck ? '#b91c1c' : 'var(--text-muted)' }}>
          {describeSpan(sat)} here
        </div>
      )}
      <select
        value={card.stageId ?? ''}
        disabled={pending}
        onChange={e => onMove(card, e.target.value || null)}
        className="input-control"
        style={{ width: '100%', fontSize: '0.7rem', padding: '0.1rem 0.2rem', marginTop: '0.2rem' }}
      >
        <option value="">— not placed</option>
        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

function StageEditor({ projectId, stages, onDone }: {
  projectId: string;
  stages: Stage[];
  onDone: () => void;
}) {
  const [text, setText] = useState(stages.map(s => s.name).join('\n'));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const plan = planStages(text.split('\n'));

  return (
    <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.8rem', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>
        One stage per line, in order. A stage kept under the same name keeps the records in it.
      </p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(MAX_STAGES, Math.max(4, text.split('\n').length))}
                spellCheck={false}
                style={{ width: '100%', fontSize: '0.82rem', padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--glass-border)', resize: 'vertical', fontFamily: 'inherit' }} />
      {plan.problems.map(p => (
        <p key={p} style={{ fontSize: '0.78rem', color: '#a3560a', margin: '0.3rem 0 0' }}>{p}</p>
      ))}
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <button className="btn btn-primary" style={{ fontSize: '0.78rem' }}
                disabled={pending || plan.stages.length === 0}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('projectId', projectId);
                  fd.append('names', text);
                  const r = await setStages(fd);
                  if ('error' in r) { setError(r.error!); return; }
                  onDone();
                })}>
          {pending ? 'Saving…' : 'Save stages'}
        </button>
        <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={onDone}>Cancel</button>
      </div>
      {error && <p style={{ fontSize: '0.78rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{error}</p>}
    </div>
  );
}
