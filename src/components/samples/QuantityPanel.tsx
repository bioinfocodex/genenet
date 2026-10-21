'use client';
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Beaker, Trash2, AlertTriangle } from 'lucide-react';
import {
  remaining, format, formatConcentration, parseQuantity, amountIn,
  CONCENTRATION_PRESETS, unit,
  type Stock, type Draw, type Concentration,
} from '@/lib/quantities';
import { setSampleQuantity, recordSampleUse, deleteSampleUse } from '@/app/actions/samples';

/**
 * How much is in the tube, and how much is left.
 *
 * The number on the left of this panel is the one the inventory exists to
 * give: whether it is worth walking to the freezer. It is computed from the
 * uses underneath it and is never stored, so it cannot be stale -- it can only
 * be as right as the list of uses, which is a thing somebody can read and
 * correct.
 */

export interface UseRow {
  id: string;
  amount: number;
  unit: string;
  note: string | null;
  usedAt: string;
  usedBy: string | null;
}

export interface SampleQuantity {
  id: string;
  amount: number | null;
  amountUnit: string | null;
  concValue: number | null;
  concPer: string | null;
  concVolume: string | null;
  lot: string | null;
  expiresAt: string | null;
}

export default function QuantityPanel({ sample, uses }: { sample: SampleQuantity; uses: UseRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draw, setDraw] = useState('');
  const [note, setNote] = useState('');

  const stock: Stock | null = useMemo(() => (
    sample.amount !== null && sample.amountUnit
      ? {
          initial: { value: sample.amount, unit: sample.amountUnit },
          concentration: sample.concValue && sample.concPer && sample.concVolume
            ? { value: sample.concValue, per: sample.concPer, volume: sample.concVolume }
            : null,
        }
      : null
  ), [sample]);

  const draws: Draw[] = useMemo(
    () => uses.map(u => ({ amount: { value: u.amount, unit: u.unit }, note: u.note ?? undefined })),
    [uses],
  );

  const left = stock ? remaining(stock, draws) : null;
  const concentration: Concentration | null = stock?.concentration ?? null;

  /** The total mass in the tube now, where a concentration makes that meaningful. */
  const massLeft = left && concentration && unit(left.left.unit)?.dimension === 'volume'
    ? amountIn(left.left, concentration)
    : null;

  const expired = sample.expiresAt ? new Date(sample.expiresAt) < new Date() : false;

  const run = (fn: () => Promise<{ error?: string } | { ok: true }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r && 'error' in r && r.error) { setError(r.error); return; }
      setDraw(''); setNote(''); setEditing(false);
      router.refresh();
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.75rem' }}>
        <Beaker size={16} />
        <h2 style={{ fontSize: '0.95rem', margin: 0, flex: 1 }}>Amount</h2>
        <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}
                onClick={() => setEditing(e => !e)}>
          {editing ? 'Cancel' : stock ? 'Edit' : 'Record what is in it'}
        </button>
      </div>

      {!stock && !editing && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          No amount recorded, so there is nothing to draw down. Until there is, this tube can only be
          found, not spent.
        </p>
      )}

      {stock && left && (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div style={{
              fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1,
              color: left.empty ? 'var(--text-muted)' : 'var(--text-primary)',
            }}>
              {format(left.left)}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              left of {format(stock.initial)}
              {massLeft && <> · about {format(massLeft)}</>}
            </div>
          </div>
          {concentration && (
            <Fact label="Concentration" value={formatConcentration(concentration)} />
          )}
          {sample.lot && <Fact label="Lot" value={sample.lot} />}
          {sample.expiresAt && (
            <Fact
              label={expired ? 'Expired' : 'Expires'}
              value={new Date(sample.expiresAt).toLocaleDateString()}
              tone={expired ? 'bad' : undefined}
            />
          )}
        </div>
      )}

      {left?.empty && !left.overdrawn && (
        <Banner tone="muted">Empty. Every bit of it is accounted for below.</Banner>
      )}

      {/*
        An overdraw is shown, not swallowed. The uses add up to more than the
        tube ever held, which means the tube was mislabelled or a use was
        entered twice -- and either way somebody has to look, which they
        cannot do if the panel just says nought.
      */}
      {left?.overdrawn && (
        <Banner tone="bad">
          <AlertTriangle size={13} style={{ verticalAlign: '-2px' }} />{' '}
          The uses below add up to {format(left.overdrawn)} more than was ever in this tube.
          Either it held more than was recorded, or one of them is wrong.
        </Banner>
      )}

      {left?.unusable.map((u, i) => (
        <Banner key={i} tone="warn">{format(u.draw.amount)} could not be counted: {u.why}</Banner>
      ))}

      {editing && <QuantityForm sample={sample} pending={pending} onSave={fd => run(() => setSampleQuantity(fd))} />}

      {stock && !editing && (
        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={label}>
            <span style={labelText}>Take</span>
            <input value={draw} onChange={e => setDraw(e.target.value)}
                   placeholder={concentration ? '5 µL or 1 µg' : `e.g. 5 ${unit(stock.initial.unit)?.label || 'items'}`}
                   className="input-control" style={{ ...input, width: 130 }} />
          </label>
          <label style={label}>
            <span style={labelText}>What for</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional"
                   className="input-control" style={{ ...input, width: 200 }} />
          </label>
          <button
            className="btn btn-primary" style={{ fontSize: '0.78rem' }}
            disabled={pending || !draw.trim() || !parseQuantity(draw)}
            onClick={() => {
              const fd = new FormData();
              fd.append('id', sample.id);
              fd.append('amount', draw);
              fd.append('note', note);
              run(() => recordSampleUse(fd));
            }}
          >
            {pending ? 'Recording…' : 'Record use'}
          </button>
          {draw.trim() && !parseQuantity(draw) && (
            <span style={{ fontSize: '0.76rem', color: '#a3560a' }}>
              Not an amount — try 5 µL, 1 µg, or 2 tubes.
            </span>
          )}
        </div>
      )}

      {error && <Banner tone="bad">{error}</Banner>}

      {uses.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.9rem' }}>
          <thead>
            <tr>
              {['Taken', 'What for', 'By', 'When', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {uses.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{format({ value: u.amount, unit: u.unit })}</td>
                <td style={{ ...cell, color: u.note ? undefined : 'var(--text-muted)' }}>{u.note || '—'}</td>
                <td style={cell}>{u.usedBy ?? '—'}</td>
                <td style={{ ...cell, color: 'var(--text-muted)' }}>{new Date(u.usedAt).toLocaleDateString()}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <button
                    title="Remove this use; the tube fills back up by that much"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.append('useId', u.id);
                      run(() => deleteSampleUse(fd));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuantityForm({ sample, pending, onSave }: {
  sample: SampleQuantity;
  pending: boolean;
  onSave: (fd: FormData) => void;
}) {
  const [amount, setAmount] = useState(
    sample.amount !== null && sample.amountUnit
      ? format({ value: sample.amount, unit: sample.amountUnit }, { humanise: false })
      : '',
  );
  const [conc, setConc] = useState(sample.concValue ? String(sample.concValue) : '');
  const [per, setPer] = useState(sample.concPer ?? 'ng');
  const [vol, setVol] = useState(sample.concVolume ?? 'uL');
  const [lot, setLot] = useState(sample.lot ?? '');
  const [expires, setExpires] = useState(sample.expiresAt ? sample.expiresAt.slice(0, 10) : '');

  const parsed = amount.trim() ? parseQuantity(amount) : null;

  return (
    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={label}>
        <span style={labelText}>How much is in it</span>
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="50 µL"
               className="input-control" style={{ ...input, width: 120 }} />
      </label>
      <label style={label}>
        <span style={labelText}>Concentration</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <input value={conc} onChange={e => setConc(e.target.value)} placeholder="200"
                 className="input-control" style={{ ...input, width: 70 }} />
          <select value={`${per}/${vol}`} onChange={e => { const [p, v] = e.target.value.split('/'); setPer(p); setVol(v); }}
                  className="input-control" style={input}>
            {CONCENTRATION_PRESETS.map(p => (
              <option key={`${p.per}/${p.volume}`} value={`${p.per}/${p.volume}`}>
                {formatConcentration({ value: 1, per: p.per, volume: p.volume }).replace(/^1 /, '')}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label style={label}>
        <span style={labelText}>Lot</span>
        <input value={lot} onChange={e => setLot(e.target.value)} className="input-control" style={{ ...input, width: 110 }} />
      </label>
      <label style={label}>
        <span style={labelText}>Expires</span>
        <input type="date" value={expires} onChange={e => setExpires(e.target.value)} className="input-control" style={input} />
      </label>
      <button
        className="btn btn-primary" style={{ fontSize: '0.78rem' }}
        disabled={pending || (!!amount.trim() && !parsed)}
        onClick={() => {
          const fd = new FormData();
          fd.append('id', sample.id);
          fd.append('amount', amount);
          fd.append('concValue', conc);
          fd.append('concPer', per);
          fd.append('concVolume', vol);
          fd.append('lot', lot);
          fd.append('expiresAt', expires);
          onSave(fd);
        }}
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {amount.trim() && !parsed && (
        <span style={{ fontSize: '0.76rem', color: '#a3560a' }}>Try 50 µL, 10 µg, or 3 tubes.</span>
      )}
    </div>
  );
}

function Fact({ label: name, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <div style={labelText}>{name}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: tone === 'bad' ? '#b91c1c' : undefined }}>{value}</div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'bad' | 'warn' | 'muted'; children: React.ReactNode }) {
  const colour = tone === 'bad' ? '#b91c1c' : tone === 'warn' ? '#a3560a' : 'var(--text-muted)';
  return <p style={{ fontSize: '0.8rem', color: colour, margin: '0.6rem 0 0' }}>{children}</p>;
}

const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };
const labelText: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-muted)',
};
const input: React.CSSProperties = { fontSize: '0.8rem', padding: '0.26rem 0.4rem' };
const cell: React.CSSProperties = { padding: '0.3rem 0.5rem', verticalAlign: 'top' };
