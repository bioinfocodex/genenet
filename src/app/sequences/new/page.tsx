'use client';
import { useState, useTransition, useRef } from 'react';
import { createSequence, importSequence } from '@/app/actions/sequences';
import Link from 'next/link';
import { Upload, FileText } from 'lucide-react';

type Mode = 'manual' | 'fasta' | 'genbank' | 'file';

export default function NewSequencePage() {
  const [mode, setMode] = useState<Mode>('manual');
  const [sequenceInput, setSequenceInput] = useState('');
  const [type, setType] = useState<'gene' | 'plasmid'>('gene');
  const [importRaw, setImportRaw] = useState('');
  const [isPending, startTransition] = useTransition();
  const [fileInfo, setFileInfo] = useState<{ name: string; format: string } | null>(null);
  const [fileError, setFileError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const cleaned = sequenceInput.toUpperCase().replace(/[^ACGTRYMKSWHBVDN]/g, '');
  const isValid = cleaned.length > 0;
  const invalidChars = sequenceInput.toUpperCase().replace(/[ACGTRYMKSWHBVDN\s\n0-9]/g, '').length > 0;

  const handleManualSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    startTransition(() => { createSequence(new FormData(form)); });
  };

  const handleImport = () => {
    if (!importRaw.trim()) return;
    const fd = new FormData();
    fd.append('format', mode === 'genbank' ? 'genbank' : 'fasta');
    fd.append('raw', importRaw);
    startTransition(() => { importSequence(fd); });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    setFileInfo(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const format = ['gb', 'gbk'].includes(ext) ? 'genbank' : ['fasta', 'fa'].includes(ext) ? 'fasta' : null;
    if (!format) { setFileError('Unsupported format. Use .fasta, .fa, .gb, or .gbk'); return; }
    setFileInfo({ name: file.name, format });
  };

  const handleFileImport = () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !fileInfo) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      if (!raw?.trim()) { setFileError('File appears to be empty'); return; }
      const fd = new FormData();
      fd.append('format', fileInfo.format);
      fd.append('raw', raw);
      startTransition(() => { importSequence(fd); });
    };
    reader.onerror = () => setFileError('Could not read file');
    reader.readAsText(file);
  };

  const tabs: [Mode, string][] = [['manual', 'Manual entry'], ['fasta', 'Import FASTA'], ['genbank', 'Import GenBank'], ['file', 'Upload File']];

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/sequences" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Sequence Library</Link>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Add Sequence</h1>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        {tabs.map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '0.5rem 1.1rem', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: '0.85rem',
              fontWeight: mode === m ? 600 : 400,
              color: mode === m ? 'var(--accent-blue)' : 'var(--text-muted)',
              borderBottom: `2px solid ${mode === m ? 'var(--accent-blue)' : 'transparent'}`,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Manual entry ─────────────────────────────────────────────────── */}
      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Sequence Type</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {(['gene', 'plasmid'] as const).map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.6rem 1.25rem', borderRadius: '8px', border: `2px solid ${type === t ? (t === 'gene' ? 'var(--accent-green)' : 'var(--accent-blue)') : 'var(--glass-border)'}`, background: type === t ? (t === 'gene' ? 'rgba(5,150,105,0.07)' : 'rgba(37,99,235,0.07)') : 'white', fontWeight: type === t ? 600 : 400, color: type === t ? (t === 'gene' ? 'var(--accent-green)' : 'var(--accent-blue)') : 'var(--text-secondary)', transition: 'all 0.2s' }}>
                  <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} style={{ display: 'none' }} />
                  {t === 'gene' ? '🧬 Gene Insert' : '🔵 Plasmid / Vector'}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Name *</label>
            <input type="text" name="name" required className="input-control" placeholder={type === 'gene' ? 'e.g. GFP, HIS3' : 'e.g. pUC19, pYES2'} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input type="text" name="description" className="input-control" placeholder="e.g. Green fluorescent protein" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>DNA Sequence *</label>
              <div style={{ fontSize: '0.8rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {isValid && <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>✓ {cleaned.length.toLocaleString()} bp</span>}
                {invalidChars && <span style={{ color: 'var(--accent-orange)' }}>⚠ Non-IUPAC chars will be removed</span>}
              </div>
            </div>
            <textarea name="sequence" required value={sequenceInput} onChange={e => setSequenceInput(e.target.value)} className="input-control" rows={8} placeholder="Paste DNA sequence here (ACGT, IUPAC codes, spaces/numbers ignored)" style={{ fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>Tags <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input type="text" name="tags" className="input-control" placeholder="e.g. fluorescent, yeast (comma-separated)" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <Link href="/sequences" className="btn btn-secondary">Cancel</Link>
            <button type="submit" className="btn btn-primary" disabled={!isValid || isPending}>
              {isPending ? 'Saving…' : '+ Add to Library'}
            </button>
          </div>
        </form>
      )}

      {/* ── FASTA import ──────────────────────────────────────────────────── */}
      {mode === 'fasta' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Paste a FASTA-formatted sequence. The name and description are parsed from the <code style={{ fontFamily: 'monospace' }}>&gt;header</code> line. Features are not available in FASTA format — use GenBank for annotated sequences.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>FASTA sequence</label>
            <textarea
              value={importRaw}
              onChange={e => setImportRaw(e.target.value)}
              className="input-control"
              rows={12}
              placeholder={`>GFP Green fluorescent protein\nATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGA\nCGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTA\n...`}
              style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <Link href="/sequences" className="btn btn-secondary">Cancel</Link>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importRaw.trim() || isPending}>
              {isPending ? 'Importing…' : 'Import FASTA'}
            </button>
          </div>
        </div>
      )}

      {/* ── GenBank import ────────────────────────────────────────────────── */}
      {mode === 'genbank' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Paste a GenBank flat file (.gb / .gbk). Name, description, features (CDS, gene, promoter, etc.) and the ORIGIN sequence are all parsed automatically.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>GenBank flat file</label>
            <textarea
              value={importRaw}
              onChange={e => setImportRaw(e.target.value)}
              className="input-control"
              rows={16}
              placeholder={`LOCUS       pUC19                 2686 bp    DNA     circular SYN\nDEFINITION  Cloning vector pUC19.\nFEATURES             Location/Qualifiers\n     rep_origin      complement(1629..2217)\n                     /label="pMB1 ori"\n...\nORIGIN\n        1 tcgcgcgttt cggtgatgac ggtgaaaacc tctgacacat gcagctcccg gagacggtca\n...`}
              style={{ fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <Link href="/sequences" className="btn btn-secondary">Cancel</Link>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importRaw.trim() || isPending}>
              {isPending ? 'Importing…' : 'Import GenBank'}
            </button>
          </div>
        </div>
      )}

      {/* ── File upload ───────────────────────────────────────────────────── */}
      {mode === 'file' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Upload a sequence file from your computer. Supported formats: <strong>.fasta</strong>, <strong>.fa</strong>, <strong>.gb</strong>, <strong>.gbk</strong>. GenBank files include features and annotations; FASTA files contain sequence only.
          </div>

          {/* Drop zone / file picker */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${fileInfo ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
              borderRadius: '10px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer',
              background: fileInfo ? 'var(--accent-blue-15)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".fasta,.fa,.gb,.gbk"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {fileInfo ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={32} color="var(--accent-blue)" />
                <div style={{ fontWeight: 600, color: 'var(--accent-blue)', fontSize: '0.95rem' }}>{fileInfo.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Format detected: <strong>{fileInfo.format === 'genbank' ? 'GenBank' : 'FASTA'}</strong>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click to choose a different file</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <Upload size={32} color="var(--text-muted)" style={{ opacity: 0.5 }} />
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Click to select a file</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>.fasta · .fa · .gb · .gbk</div>
              </div>
            )}
          </div>

          {fileError && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--accent-red)' }}>
              ⚠ {fileError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <Link href="/sequences" className="btn btn-secondary">Cancel</Link>
            <button
              className="btn btn-primary"
              onClick={handleFileImport}
              disabled={!fileInfo || isPending}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Upload size={15} />
              {isPending ? 'Importing…' : `Import ${fileInfo?.format === 'genbank' ? 'GenBank' : 'FASTA'} File`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
