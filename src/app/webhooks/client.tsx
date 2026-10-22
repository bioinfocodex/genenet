'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Webhook as Hook, Plus, Trash2, Send, Copy, Check, AlertTriangle } from 'lucide-react';
import { createWebhook, setWebhookActive, deleteWebhook, testWebhook, flushWebhooks } from '@/app/actions/webhooks';

/**
 * Where the things that happen here get told to other systems.
 *
 * The useful half of this page is the test button and the delivery list.
 * Configuring a webhook and finding out a week later that it has never worked
 * is the normal failure, and it happens because nothing ever tried it while
 * somebody was watching.
 */

interface DeliveryRow {
  id: string; event: string; state: string; status: number | null;
  note: string | null; attempts: number; createdAt: string; nextAt: string | null;
}
interface HookRow {
  id: string; name: string; url: string; events: string[]; active: boolean;
  deliveries: DeliveryRow[];
}

export default function WebhooksClient({ hooks, events, example }: {
  hooks: HookRow[];
  events: { id: string; label: string }[];
  example: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Hook size={24} /> Webhooks
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.2rem', fontSize: '0.86rem' }}>
            Told outward when something happens here. Every delivery is signed, and failures are retried
            six times over about five minutes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} disabled={pending}
                  onClick={() => start(async () => { await flushWebhooks(); router.refresh(); })}>
            Send anything owed
          </button>
          <button className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                  onClick={() => setAdding(a => !a)}>
            <Plus size={15} /> {adding ? 'Cancel' : 'Add one'}
          </button>
        </div>
      </div>

      {/*
        Shown once and never again, like every other secret here. A list that
        keeps showing it is a list that leaks it.
      */}
      {secret && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid rgba(217,119,6,0.4)' }}>
          <p style={{ fontSize: '0.86rem', margin: '0 0 0.4rem' }}>
            <strong>{secret.name}</strong> — copy its signing secret now. It is not shown again.
          </p>
          <CopyLine value={secret.value} />
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
            The receiver checks <code>X-GeneNet-Signature</code>, which is <code>t=&lt;unix seconds&gt;,v1=&lt;hmac&gt;</code> over
            {' '}<code>&quot;&lt;t&gt;.&lt;body&gt;&quot;</code> with this secret. The timestamp is inside the signed string, so an
            old capture cannot be replayed.
          </p>
        </div>
      )}

      {adding && <AddForm events={events} onDone={(name, value) => { setAdding(false); setSecret({ name, value }); router.refresh(); }} />}

      {hooks.length === 0 && !adding && (
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          Nothing is told anything yet.
        </p>
      )}

      {hooks.map(h => <HookCard key={h.id} hook={h} />)}

      <details className="glass-panel" style={{ padding: '0.9rem 1.2rem', marginTop: '1.25rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 }}>What arrives</summary>
        <pre style={{ fontSize: '0.76rem', overflowX: 'auto', margin: '0.5rem 0 0' }}>{example}</pre>
      </details>
    </div>
  );
}

function HookCard({ hook }: { hook: HookRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const failing = hook.deliveries.filter(d => d.state === 'failed').length;

  return (
    <div className="glass-panel" style={{
      padding: '0.9rem 1.2rem', marginBottom: '0.8rem',
      opacity: hook.active ? 1 : 0.65,
      borderLeft: failing > 0 ? '3px solid #b91c1c' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>{hook.name}</strong>
        <code style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{hook.url}</code>
        {!hook.active && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>paused</span>}
        {failing > 0 && (
          <span style={{ fontSize: '0.74rem', color: '#b91c1c' }}>
            <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} /> {failing} gave up
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem', display: 'flex', gap: '0.2rem', alignItems: 'center' }}
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('id', hook.id);
                  const r = await testWebhook(fd);
                  setResult('error' in r
                    ? r.error!
                    : r.result?.state === 'delivered'
                      ? `The endpoint answered ${r.result.status}.`
                      : `${r.result?.note ?? 'No answer.'}${r.result?.state === 'pending' ? ' It will be tried again.' : ''}`);
                  router.refresh();
                })}>
          <Send size={11} /> Test
        </button>
        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem' }}
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('id', hook.id);
                  fd.append('active', String(!hook.active));
                  await setWebhookActive(fd);
                  router.refresh();
                })}>
          {hook.active ? 'Pause' : 'Resume'}
        </button>
        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem' }}
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('id', hook.id);
                  await deleteWebhook(fd);
                  router.refresh();
                })}>
          <Trash2 size={11} />
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
        {hook.events.join(', ')}
      </div>

      {result && <p style={{ fontSize: '0.8rem', margin: '0.4rem 0 0' }}>{result}</p>}

      {hook.deliveries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginTop: '0.5rem' }}>
          <tbody>
            {hook.deliveries.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '0.2rem 0.4rem 0.2rem 0', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(d.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: '0.2rem 0.4rem' }}>{d.event}</td>
                <td style={{ padding: '0.2rem 0.4rem', color: state(d.state) }}>
                  {d.state}{d.status ? ` ${d.status}` : ''}
                  {d.attempts > 1 && ` · ${d.attempts} tries`}
                </td>
                <td style={{ padding: '0.2rem 0 0.2rem 0.4rem', color: 'var(--text-muted)' }}>
                  {d.note}
                  {d.nextAt && d.state === 'pending' && ` · next ${new Date(d.nextAt).toLocaleTimeString()}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const state = (s: string) => (s === 'delivered' ? '#15803d' : s === 'failed' ? '#b91c1c' : '#a3560a');

function AddForm({ events, onDone }: {
  events: { id: string; label: string }[];
  onDone: (name: string, secret: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <label style={field}>
          <span style={label}>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="LIMS sample feed"
                 className="input-control" style={input} />
        </label>
        <label style={field}>
          <span style={label}>Where to post</span>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.example.org/genenet"
                 className="input-control" style={input} />
        </label>
      </div>

      <div style={{ marginTop: '0.6rem' }}>
        <span style={label}>When</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginTop: '0.25rem' }}>
          {events.map(e => (
            <label key={e.id} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.82rem' }}>
              <input type="checkbox" checked={chosen.includes(e.id)}
                     onChange={ev => setChosen(c => ev.target.checked ? [...c, e.id] : c.filter(x => x !== e.id))} />
              {e.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button className="btn btn-primary" style={{ fontSize: '0.82rem' }}
                disabled={pending || !name.trim() || !url.trim() || chosen.length === 0}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.append('name', name);
                  fd.append('url', url);
                  fd.append('events', chosen.join(','));
                  const r = await createWebhook(fd);
                  if ('error' in r) { setError(r.error!); return; }
                  onDone(name, r.secret!);
                })}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: '0.4rem 0 0' }}>{error}</p>}
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <code style={{ fontSize: '0.78rem', background: 'var(--bg-secondary)', padding: '0.25rem 0.4rem', borderRadius: 4, flex: 1, overflowX: 'auto' }}>
        {value}
      </code>
      <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem' }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
                catch { /* a browser that refuses the clipboard is not worth an error */ }
              }}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };
const label: React.CSSProperties = {
  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-muted)',
};
const input: React.CSSProperties = { fontSize: '0.83rem', padding: '0.35rem 0.5rem', width: '100%' };
