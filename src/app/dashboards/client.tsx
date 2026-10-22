'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart, Plus, Trash2, Pencil } from 'lucide-react';
import Chart from '@/components/results/Chart';
import type { Point, ChartKind } from '@/lib/charts';
import { saveDashboard, deleteDashboard } from '@/app/actions/dashboards';

/**
 * Charts somebody set up and wants back tomorrow.
 *
 * Results are rows of typed fields, which is the right way to store them and
 * the wrong way to look at them. The questions people have -- is this going
 * up, where is the curve's midpoint, which corner of the plate is low -- are
 * about shape, and a table of ninety-six numbers has none.
 */

interface Field { key: string; label: string; type: string }
interface Schema { id: string; name: string; fields: Field[] }

interface ChartRow {
  id: string;
  name: string;
  kind: string;
  schemaId: string;
  schemaName: string;
  projectName: string | null;
  xKey: string | null;
  yKey: string;
  groupKey: string | null;
  xLabel: string;
  yLabel: string;
  format: number;
  points: Point[];
  blank: number;
  problem: string | null;
}

const KINDS: { id: ChartKind; label: string; about: string }[] = [
  { id: 'series', label: 'Over time or along a value', about: 'Points joined in order, replicates averaged with their spread.' },
  { id: 'dose', label: 'Dose response', about: 'A four-parameter curve with its midpoint. x is log concentration.' },
  { id: 'heatmap', label: 'Plate heatmap', about: 'Laid out by well, so a low corner or a bad edge is visible.' },
  { id: 'scatter', label: 'Scatter', about: 'Every point as it was recorded, nothing joined or averaged.' },
];

export default function DashboardsClient({ charts, schemas, projects }: {
  charts: ChartRow[];
  schemas: Schema[];
  projects: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<ChartRow | 'new' | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <LineChart size={24} /> Charts
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.2rem', fontSize: '0.86rem' }}>
            Drawn from what is recorded now, not from what was recorded when the chart was saved.
          </p>
        </div>
        <button className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          <Plus size={15} /> {editing === 'new' ? 'Cancel' : 'New chart'}
        </button>
      </div>

      {editing && (
        <Editor
          chart={editing === 'new' ? null : editing}
          schemas={schemas}
          projects={projects}
          onDone={() => setEditing(null)}
        />
      )}

      {charts.length === 0 && !editing && (
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No charts yet. Make one over an assay that has some numbers in it.
        </p>
      )}

      {charts.map(c => (
        <div key={c.id} className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>{c.name}</h2>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              {c.schemaName}
              {c.projectName && ` · ${c.projectName}`}
              {` · ${c.points.length} point${c.points.length === 1 ? '' : 's'}`}
            </span>
            <span style={{ flex: 1 }} />
            <Buttons chart={c} onEdit={() => setEditing(c)} />
          </div>

          {c.problem
            ? <p style={{ fontSize: '0.82rem', color: '#a3560a', margin: 0 }}>{c.problem}</p>
            : (
              <Chart
                kind={c.kind as ChartKind}
                points={c.points}
                xLabel={c.xLabel}
                yLabel={c.yLabel}
                format={c.format}
                blank={c.blank}
              />
            )}
        </div>
      ))}
    </div>
  );
}

function Buttons({ chart, onEdit }: { chart: ChartRow; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem' }} onClick={onEdit}>
        <Pencil size={11} /> Edit
      </button>
      <button className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.18rem 0.45rem' }}
              disabled={pending}
              onClick={() => start(async () => {
                const fd = new FormData();
                fd.append('id', chart.id);
                await deleteDashboard(fd);
                router.refresh();
              })}>
        <Trash2 size={11} />
      </button>
    </>
  );
}

function Editor({ chart, schemas, projects, onDone }: {
  chart: ChartRow | null;
  schemas: Schema[];
  projects: { id: string; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(chart?.name ?? '');
  const [kind, setKind] = useState<ChartKind>((chart?.kind as ChartKind) ?? 'series');
  const [schemaId, setSchemaId] = useState(chart?.schemaId ?? schemas[0]?.id ?? '');
  const [yKey, setYKey] = useState(chart?.yKey ?? '');
  const [xKey, setXKey] = useState(chart?.xKey ?? '');
  const [groupKey, setGroupKey] = useState(chart?.groupKey ?? '');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const schema = schemas.find(s => s.id === schemaId);
  const numbers = schema?.fields.filter(f => f.type === 'number' || f.type === 'integer') ?? [];
  const xables = schema?.fields.filter(f => ['number', 'integer', 'date'].includes(f.type)) ?? [];
  const groupables = schema?.fields.filter(f => ['text', 'select', 'boolean'].includes(f.type)) ?? [];
  const chosen = KINDS.find(k => k.id === kind)!;

  if (schemas.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.84rem', margin: 0 }}>No assays to chart. Make one first, with a number field in it.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Growth at 37 °C"
                 className="input-control" style={input} />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={e => setKind(e.target.value as ChartKind)} className="input-control" style={input}>
            {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Assay">
          <select value={schemaId} onChange={e => { setSchemaId(e.target.value); setYKey(''); setXKey(''); setGroupKey(''); }}
                  className="input-control" style={input}>
            {schemas.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input-control" style={input}>
            <option value="">—</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Y axis">
          <select value={yKey} onChange={e => setYKey(e.target.value)} className="input-control" style={input}>
            <option value="">—</option>
            {numbers.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
        {kind !== 'heatmap' && (
          <Field label="X axis">
            <select value={xKey} onChange={e => setXKey(e.target.value)} className="input-control" style={input}>
              <option value="">When it was measured</option>
              {xables.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Split into series by">
          <select value={groupKey} onChange={e => setGroupKey(e.target.value)} className="input-control" style={input}>
            <option value="">The sample</option>
            {groupables.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0' }}>{chosen.about}</p>
      {numbers.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: '#a3560a', margin: '0.3rem 0 0' }}>
          {schema?.name} has no number field, so there is nothing to put on an axis.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
        <button className="btn btn-primary" style={{ fontSize: '0.82rem' }}
                disabled={pending || !name.trim() || !yKey}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  if (chart) fd.append('id', chart.id);
                  fd.append('name', name);
                  fd.append('kind', kind);
                  fd.append('schemaId', schemaId);
                  fd.append('yKey', yKey);
                  fd.append('xKey', xKey);
                  fd.append('groupKey', groupKey);
                  fd.append('projectId', projectId);
                  const r = await saveDashboard(fd);
                  if ('error' in r) { setError(r.error!); return; }
                  onDone();
                  router.refresh();
                })}>
          {pending ? 'Saving…' : chart ? 'Save' : 'Make the chart'}
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
      <span style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { fontSize: '0.83rem', padding: '0.35rem 0.5rem', width: '100%' };
