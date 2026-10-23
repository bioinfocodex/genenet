'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Users, WifiOff } from 'lucide-react';
import { diff, applyAll, transformOver, type Op, type Presence } from '@/lib/ot';

/**
 * The body of a draft entry, with whoever else has it open.
 *
 * Two scientists writing up the same experiment at once is not an edge case;
 * it is a Friday afternoon. Before this, the second to press save overwrote
 * the first, and neither was told.
 *
 * The client keeps three things: the text on screen, the version the server
 * last confirmed, and the ops it has sent but not had back. An op arriving
 * from somebody else is rebased over those outstanding ops before being
 * applied, which is what stops the cursor jumping and the text tearing while
 * somebody is mid-sentence.
 */

interface Props {
  entryId: string;
  initial: string;
  me: string;
  /** Called with the current text so the parent can keep its own copy. */
  onChange?: (text: string) => void;
  editable: boolean;
}

export default function LiveBody({ entryId, initial, me, onChange, editable }: Props) {
  const [text, setText] = useState(initial);
  const [people, setPeople] = useState<Presence[]>([]);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * This connection, not this person. Two tabs belonging to one scientist are
   * two editors -- their own text, their own outstanding changes, their own
   * cursor -- and identifying them by user means the second tab reads the
   * first tab's change as its own, skips it, and diverges without a word.
   */
  const client = useRef<string>('');
  if (!client.current) {
    client.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  const area = useRef<HTMLTextAreaElement>(null);
  /** The server's version this client has caught up to. */
  const version = useRef(0);
  /** Sent, not yet acknowledged. Incoming ops are rebased over these. */
  const pending = useRef<Op[]>([]);
  /** What the textarea held last time we looked, to diff against. */
  const last = useRef(initial);
  const sending = useRef(false);

  const push = useCallback(async (ops: Op[], at?: number) => {
    if (sending.current) return;
    sending.current = true;
    try {
      const res = await fetch(`/api/coedit/${entryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: version.current, ops, at, client: client.current }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        setProblem(body.error ?? 'This editing session has ended. Reload the page.');
        setLive(false);
        return;
      }
      const body = await res.json();
      if (typeof body.version === 'number') {
        version.current = body.version;
        /*
         * The ops are dropped from `pending` only once the server has them.
         * Clearing them when they are sent would leave an incoming change
         * rebased over nothing, and it would land at a position that no
         * longer exists.
         */
        pending.current = pending.current.filter(p => !ops.includes(p));
      }
    } catch {
      setLive(false);
    } finally {
      sending.current = false;
    }
  }, [entryId]);

  // ── The stream ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editable) return;
    const source = new EventSource(`/api/coedit/${entryId}?client=${client.current}`);

    source.onopen = () => { setLive(true); setProblem(null); };
    source.onerror = () => setLive(false);

    source.onmessage = e => {
      const event = JSON.parse(e.data);

      if (event.kind === 'init') {
        version.current = event.version;
        setPeople(event.people);
        /*
         * The server's copy wins on joining. A local draft typed before the
         * stream opened would otherwise be silently merged into somebody
         * else's text at positions that never applied to it.
         */
        setText(event.text);
        last.current = event.text;
        onChange?.(event.text);
        return;
      }

      if (event.kind === 'people') { setPeople(event.people); return; }

      if (event.kind === 'ops') {
        version.current = event.version;
        if (event.author === client.current) return;   // our own, already on screen

        setText(current => {
          // Rebase the incoming ops over anything of ours still in flight.
          const rebased = event.ops.flatMap((op: Op) => transformOver(op, pending.current));
          const next = applyAll(current, rebased);
          last.current = next;
          onChange?.(next);

          // Keep the caret where the writer left it rather than where its
          // index happens to land after somebody else's edit above.
          const el = area.current;
          if (el) {
            const before = el.selectionStart;
            let moved = before;
            for (const op of rebased) {
              if ('insert' in op) {
                if (op.at < moved) moved += op.insert.length;
              } else if (op.at + op.remove <= moved) moved -= op.remove;
              else if (op.at < moved) moved = op.at;
            }
            queueMicrotask(() => {
              if (area.current && document.activeElement === area.current) {
                area.current.setSelectionRange(moved, moved);
              }
            });
          }
          return next;
        });
      }
    };

    return () => source.close();
  }, [entryId, editable, me, onChange]);

  // ── Typing ────────────────────────────────────────────────────────────────
  const onInput = (value: string) => {
    const ops = diff(last.current, value);
    last.current = value;
    setText(value);
    onChange?.(value);
    if (ops.length === 0) return;
    pending.current.push(...ops);
    void push(ops, area.current?.selectionStart);
  };

  /** A heartbeat, so other people's lists do not keep somebody who has gone. */
  useEffect(() => {
    if (!editable || !live) return;
    const t = setInterval(() => void push([], area.current?.selectionStart), 8_000);
    return () => clearInterval(t);
  }, [editable, live, push]);

  /*
   * By person, not by connection. Presence is keyed on the connection so two
   * tabs are two editors to the transform -- but a scientist should not be
   * told that they themselves are editing this too, which is what filtering
   * on the connection id produced.
   */
  const others = people.filter(p => p.userId !== me);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', minHeight: 20 }}>
        {others.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Users size={13} />
            {others.map(p => p.name).join(', ')} {others.length === 1 ? 'is' : 'are'} editing this too
          </span>
        )}
        {editable && !live && (
          <span style={{ fontSize: '0.78rem', color: '#a3560a', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <WifiOff size={13} /> Not live — your changes are saved when you press save
          </span>
        )}
        {problem && <span style={{ fontSize: '0.78rem', color: '#b91c1c' }}>{problem}</span>}
      </div>

      <textarea
        ref={area}
        value={text}
        readOnly={!editable}
        onChange={e => onInput(e.target.value)}
        onSelect={() => { if (live) void push([], area.current?.selectionStart); }}
        rows={18}
        placeholder="What happened. Link records with [[sequence:id|name]], [[sample:id|name]], [[plate:id|name]]."
        style={{
          width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85rem',
          lineHeight: 1.6, padding: '0.7rem', borderRadius: 8,
          border: '1px solid var(--glass-border)', resize: 'vertical',
        }}
      />
    </div>
  );
}
