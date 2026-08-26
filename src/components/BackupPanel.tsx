'use client';
import { useState, useTransition } from 'react';
import { Database, Download, HardDriveDownload, Check, AlertTriangle, CloudUpload } from 'lucide-react';
import { backUpNow } from '@/app/actions/backup';

type BackupRow = { name: string; bytes: number; createdAt: string };
type Props = {
  backups: BackupRow[];
  location: { dir: string; synced: boolean; note: string };
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function humanWhen(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function BackupPanel({ backups, location }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState(backups);

  const runBackup = () => {
    setResult(null);
    startTransition(async () => {
      const r = await backUpNow();
      if ('error' in r) {
        setResult({ ok: false, text: r.error });
        return;
      }
      setResult({ ok: true, text: `Saved ${r.name} (${humanSize(r.bytes)})` });
      setRows(prev => [{ name: r.name, bytes: r.bytes, createdAt: new Date().toISOString() }, ...prev]);
    });
  };

  const newest = rows[0];

  return (
    <section
      style={{
        border: '1px solid var(--glass-border)', borderRadius: 12,
        background: 'var(--bg-secondary)', padding: '1.25rem', marginTop: '1.5rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
        <Database size={18} style={{ color: 'var(--accent-blue)' }} />
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Backup &amp; export</h2>
      </header>

      {newest ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.9rem' }}>
          Last backup {humanWhen(newest.createdAt)} · {rows.length} kept
        </p>
      ) : (
        <p style={{
          fontSize: '0.82rem', margin: '0 0 0.9rem',
          color: 'var(--accent-orange)', display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <AlertTriangle size={14} /> No backups yet — this workspace has never been backed up.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        <button
          onClick={runBackup}
          disabled={isPending}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: isPending ? 'wait' : 'pointer' }}
        >
          <HardDriveDownload size={15} />
          {isPending ? 'Backing up…' : 'Back up now'}
        </button>

        <a
          href="/api/backup/export"
          className="btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', textDecoration: 'none' }}
        >
          <Download size={15} />
          Export workspace as JSON
        </a>
      </div>

      {result && (
        <p style={{
          fontSize: '0.8rem', margin: '0 0 0.9rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          color: result.ok ? 'var(--accent-green)' : 'var(--accent-red)',
        }}>
          {result.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
          {result.text}
        </p>
      )}

      <div style={{
        fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6,
        borderTop: '1px solid var(--glass-border)', paddingTop: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
          {location.synced && <CloudUpload size={13} style={{ marginTop: 2, flexShrink: 0 }} />}
          <span>
            {location.note}
            <br />
            <code style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>{location.dir}</code>
          </span>
        </div>
        <p style={{ margin: '0.6rem 0 0' }}>
          A backup is a restorable copy of the database. The JSON export is for reading
          the records outside GeneNet — moving to another tool, or handing data to a
          collaborator. Uploaded images are not in either file; they stay in the uploads
          folder.
        </p>
      </div>

      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.9rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {rows.slice(0, 5).map(b => (
            <li key={b.name} style={{
              display: 'flex', justifyContent: 'space-between', gap: '1rem',
              fontSize: '0.75rem', color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span style={{ flexShrink: 0 }}>{humanSize(b.bytes)} · {humanWhen(b.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
