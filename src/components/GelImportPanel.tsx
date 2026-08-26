'use client';
import { useState, useTransition, useRef } from 'react';
import { Upload, ImageIcon, X, Link2, Trash2, CheckCircle } from 'lucide-react';
import { uploadGelImage, attachGelToTask, detachGelFromTask, deleteGelImage } from '@/app/actions/gelImages';
import Image from 'next/image';

type ExperimentType = 'PCR' | 'DIGESTION' | 'LIGATION' | 'OTHER';

interface Task { id: string; title: string; }
interface GelImg {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  experimentType: string | null;
  notes: string | null;
  capturedAt: string | Date;
  task: { id: string; title: string } | null;
}

interface Props {
  images: GelImg[];
  tasks: Task[];
  /** If provided, restricts the panel to one task context */
  taskId?: string;
}

const EXP_TYPES: ExperimentType[] = ['PCR', 'DIGESTION', 'LIGATION', 'OTHER'];

export default function GelImportPanel({ images: initial, tasks, taskId }: Props) {
  const [images, setImages] = useState<GelImg[]>(initial);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<GelImg | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  // Upload form state
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expType, setExpType] = useState<ExperimentType>('PCR');
  const [notes, setNotes] = useState('');
  const [linkedTaskId, setLinkedTaskId] = useState<string>(taskId ?? '');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError('');
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png', 'tif', 'tiff'].includes(ext)) {
      setUploadError('Unsupported format — use .jpg, .png, or .tif');
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    setUploadSuccess('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('experimentType', expType);
    fd.append('notes', notes);
    fd.append('taskId', linkedTaskId);
    const result = await uploadGelImage(fd);
    setUploading(false);
    if (result && 'error' in result) {
      setUploadError(result.error ?? 'Upload failed');
    } else {
      setUploadSuccess(`"${file.name}" imported successfully`);
      setFile(null);
      setNotes('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const isTif = (img: GelImg) => img.fileType === 'tif';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Upload section */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Upload size={16} color="var(--accent-blue)" /> Import Gel Image
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* File picker */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${file ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                borderRadius: 10, padding: '1.5rem', textAlign: 'center', cursor: 'pointer',
                background: file ? 'var(--accent-blue-15)' : 'transparent', transition: 'all 0.15s',
              }}
            >
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.tif,.tiff" onChange={handleFileChange} style={{ display: 'none' }} />
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <ImageIcon size={22} color="var(--accent-blue)" />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent-blue)', fontSize: '0.9rem' }}>{file.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB · click to change</div>
                  </div>
                </div>
              ) : (
                <>
                  <Upload size={28} style={{ opacity: 0.35, marginBottom: '0.4rem' }} />
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>Click to select gel image</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>.jpg · .png · .tif</div>
                </>
              )}
            </div>
          </div>

          {/* Experiment type */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Experiment Type</label>
            <select value={expType} onChange={e => setExpType(e.target.value as ExperimentType)} className="input-control" style={{ width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' }}>
              {EXP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Link to task */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Attach to Task</label>
            <select value={linkedTaskId} onChange={e => setLinkedTaskId(e.target.value)} className="input-control" style={{ width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' }} disabled={!!taskId}>
              <option value="">None (unassigned)</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="input-control" placeholder="e.g. 1.5% gel · 80V · 45 min" style={{ width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem' }} />
          </div>
        </div>

        {uploadError && <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, fontSize: '0.82rem', color: 'var(--accent-red)' }}>⚠ {uploadError}</div>}
        {uploadSuccess && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.9rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 7, fontSize: '0.82rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CheckCircle size={14} /> {uploadSuccess}
          </div>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleUpload} disabled={!file || uploading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <Upload size={15} /> {uploading ? 'Uploading…' : 'Import Image'}
          </button>
        </div>
      </div>

      {/* Gallery */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ImageIcon size={16} color="var(--accent-blue)" /> Gel Images {images.length > 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({images.length})</span>}
        </h3>

        {images.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>No gel images yet — import one above.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {images.map(img => (
              <div
                key={img.id}
                onClick={() => setSelected(img)}
                className="glass-card"
                style={{ cursor: 'pointer', overflow: 'hidden', border: selected?.id === img.id ? '2px solid var(--accent-blue)' : '2px solid transparent', transition: 'border 0.15s' }}
              >
                <div style={{ height: 110, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {isTif(img) ? (
                    <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.75rem' }}>
                      <ImageIcon size={28} style={{ opacity: 0.4, marginBottom: '0.3rem' }} />
                      <div>.TIF file</div>
                    </div>
                  ) : (
                    <img src={img.filePath} alt={img.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>
                <div style={{ padding: '0.5rem 0.6rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.fileName}</div>
                  {img.experimentType && <span style={{ fontSize: '0.65rem', color: 'var(--accent-blue)', fontWeight: 600 }}>{img.experimentType}</span>}
                  {img.task && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {img.task.title}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem', position: 'relative' }}>
            <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>

            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '1rem', paddingRight: '2rem' }}>{selected.fileName}</h3>

            {/* Image preview */}
            <div style={{ background: '#1e293b', borderRadius: 8, overflow: 'hidden', marginBottom: '1.25rem', textAlign: 'center' }}>
              {isTif(selected) ? (
                <div style={{ padding: '3rem', color: '#64748b' }}>
                  <ImageIcon size={48} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
                  <div style={{ fontSize: '0.85rem' }}>.TIF files cannot be previewed in browser</div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{selected.filePath}</div>
                </div>
              ) : (
                <img src={selected.filePath} alt={selected.fileName} style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }} />
              )}
            </div>

            {/* Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <Meta label="Type" value={selected.experimentType ?? '—'} />
              <Meta label="Captured" value={new Date(selected.capturedAt).toLocaleString()} />
              <Meta label="Format" value={selected.fileType.toUpperCase()} />
              <Meta label="Linked Task" value={selected.task?.title ?? 'Unassigned'} />
            </div>

            {selected.notes && (
              <div style={{ background: 'var(--bg-primary)', borderRadius: 7, padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                {selected.notes}
              </div>
            )}

            {/* Assign to task */}
            {!taskId && (
              <form action={attachGelToTask} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
                <input type="hidden" name="gelId" value={selected.id} />
                <select name="taskId" className="input-control" style={{ flex: 1, padding: '0.45rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' }}>
                  <option value="">Unassigned</option>
                  {tasks.map(t => <option key={t.id} value={t.id} selected={selected.task?.id === t.id}>{t.title}</option>)}
                </select>
                <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Link2 size={13} /> Assign
                </button>
              </form>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              {selected.task && (
                <form action={detachGelFromTask}>
                  <input type="hidden" name="gelId" value={selected.id} />
                  <button type="submit" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>Detach from Task</button>
                </form>
              )}
              <form action={deleteGelImage} onSubmit={() => setSelected(null)}>
                <input type="hidden" name="id" value={selected.id} />
                <button type="submit" className="btn" style={{ fontSize: '0.8rem', color: 'var(--accent-red)', border: '1px solid var(--accent-red)', background: 'transparent', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.9rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Trash2 size={13} /> Delete
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
