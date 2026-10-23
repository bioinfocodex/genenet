'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Check } from 'lucide-react';
import { previewInstrumentFile, importInstrumentReadings } from '@/app/actions/results';
import type { Instrument, MeasureSummary } from '@/lib/instruments';

/**
 * Importing the file the instrument wrote, rather than retyping it.
 *
 * The retyping is where the numbers go wrong -- a column shifted, a 260/280
 * read as a 260/230, a plate transposed -- and it is the part nobody checks
 * afterwards, because the file it came from has been closed.
 *
 * What the file holds is shown before anything is written: the format it was
 * read as, the settings the machine printed above the data, and the range of
 * every measurement in it. A range answers "did it read what I think it read"
 * faster than a table of ninety-six numbers.
 */

const FORMATS: { id: Instrument | ''; label: string }[] = [
  { id: '', label: 'Work it out from the file' },
  { id: 'plate-grid', label: 'Plate reader — grid' },
  { id: 'plate-list', label: 'Plate reader — one well per row' },
  { id: 'nanodrop', label: 'NanoDrop' },
  { id: 'qpcr', label: 'qPCR Cq table' },
];

interface Preview {
  instrument: Instrument;
  preamble: string[];
  problems: string[];
  measures: MeasureSummary[];
  total: number;
}

export default function InstrumentImport({ plateId, schemas }: {
  plateId: string;
  schemas: { id: string; name: string; fields: { key: string; label: string; type: string }[] }[];
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [format, setFormat] = useState<Instrument | ''>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [measure, setMeasure] = useState('');
  const [schemaId, setSchemaId] = useState(schemas[0]?.id ?? '');
  const [fieldKey, setFieldKey] = useState('');
  const [done, setDone] = useState<{ count: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const schema = schemas.find(s => s.id === schemaId);
  const numberFields = schema?.fields.filter(f => f.type === 'number' || f.type === 'integer') ?? [];

  const read = (raw: string, name = '') => {
    setText(raw); setFilename(name); setPreview(null); setDone(null); setError(null); setMeasure('');
  };

  const look = () => start(async () => {
    setError(null);
    const fd = new FormData();
    fd.append('text', text);
    if (format) fd.append('instrument', format);
    const r = await previewInstrumentFile(fd);
    if ('error' in r) { setError(r.error!); return; }
    setPreview(r as Preview);
    // One measurement in the file is not a choice worth making somebody make.
    if (r.measures!.length === 1) setMeasure(r.measures![0].measure);
  });

  const bring = () => start(async () => {
    setError(null);
    const fd = new FormData();
    fd.append('plateId', plateId);
    fd.append('schemaId', schemaId);
    fd.append('fieldKey', fieldKey);
    fd.append('measure', measure);
    fd.append('text', text);
    if (format) fd.append('instrument', format);
    const r = await importInstrumentReadings(fd);
    if ('error' in r) { setError(r.error); return; }
    setDone({ count: r.count, skipped: r.skipped });
    setPreview(null);
    router.refresh();
  });

  if (schemas.length === 0) {
    return (
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        No assay to file readings under. Make one first, with a number field for the reading.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
        <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" style={{ fontSize: '0.8rem' }}
               onChange={async e => {
                 const f = e.target.files?.[0];
                 if (f) read(await f.text(), f.name);
               }} />
        <select value={format} onChange={e => { setFormat(e.target.value as Instrument | ''); setPreview(null); }}
                className="input-control" style={{ fontSize: '0.8rem', padding: '0.25rem 0.4rem' }}>
          {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
                disabled={pending || !text.trim()} onClick={look}>
          {pending && !preview ? 'Reading…' : 'Read the file'}
        </button>
        {filename && <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{filename}</span>}
      </div>

      <textarea
        value={text}
        onChange={e => read(e.target.value)}
        placeholder="…or paste the export here"
        spellCheck={false}
        rows={5}
        style={{
          width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.74rem',
          padding: '0.5rem', borderRadius: 8, border: '1px solid var(--glass-border)', resize: 'vertical',
        }}
      />

      {error && <p style={{ fontSize: '0.82rem', color: '#b91c1c' }}>{error}</p>}

      {done && (
        <p style={{ fontSize: '0.86rem', marginTop: '0.6rem' }}>
          <Check size={14} style={{ verticalAlign: '-2px', color: '#15803d' }} />{' '}
          {done.count} reading{done.count === 1 ? '' : 's'} filed
          {done.skipped > 0 && `, ${done.skipped} left out — wells not on this plate, or with no number`}.
        </p>
      )}

      {preview && (
        <div style={{ marginTop: '0.8rem', padding: '0.7rem 0.85rem', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
          <div style={{ fontSize: '0.8rem', marginBottom: '0.4rem' }}>
            Read as <strong>{FORMATS.find(f => f.id === preview.instrument)?.label ?? preview.instrument}</strong>
            {' · '}{preview.total} reading{preview.total === 1 ? '' : 's'}
          </div>

          {preview.problems.map(p => (
            <p key={p} style={{ fontSize: '0.8rem', color: '#a3560a', margin: '0.2rem 0' }}>{p}</p>
          ))}

          {/*
            The machine's own preamble. The wavelength, the gain and the read
            time are the first things somebody asks about a number they do not
            believe, and they are in here rather than in the data.
          */}
          {preview.preamble.length > 0 && (
            <details style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              <summary style={{ cursor: 'pointer' }}>What the machine printed above the data</summary>
              <pre style={{ margin: '0.3rem 0 0', whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>
                {preview.preamble.join('\n')}
              </pre>
            </details>
          )}

          {preview.measures.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
              <thead>
                <tr>{['', 'Measurement', 'Readings', 'Range'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.2rem 0.4rem', borderBottom: '1px solid var(--glass-border)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {preview.measures.map(m => (
                  <tr key={m.measure}>
                    <td style={{ padding: '0.2rem 0.4rem' }}>
                      <input type="radio" name="measure" checked={measure === m.measure}
                             onChange={() => setMeasure(m.measure)} />
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>{m.measure}</td>
                    <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-muted)' }}>
                      {m.count}{m.blank > 0 && ` (${m.blank} with no number)`}
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                      {m.min === null ? '—' : `${m.min} – ${m.max}`}{m.unit ? ` ${m.unit}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span style={label}>File under</span>
              <select value={schemaId} onChange={e => { setSchemaId(e.target.value); setFieldKey(''); }}
                      className="input-control" style={{ fontSize: '0.8rem', padding: '0.25rem 0.4rem' }}>
                {schemas.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span style={label}>As which reading</span>
              <select value={fieldKey} onChange={e => setFieldKey(e.target.value)}
                      className="input-control" style={{ fontSize: '0.8rem', padding: '0.25rem 0.4rem' }}>
                <option value="">—</option>
                {numberFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" style={{ fontSize: '0.8rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                    disabled={pending || !measure || !fieldKey}
                    onClick={bring}>
              <FileUp size={13} /> {pending ? 'Filing…' : 'File these readings'}
            </button>
          </div>

          {numberFields.length === 0 && schema && (
            <p style={{ fontSize: '0.78rem', color: '#a3560a', margin: '0.4rem 0 0' }}>
              {schema.name} has no number field for a reading to go in.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-muted)',
};
