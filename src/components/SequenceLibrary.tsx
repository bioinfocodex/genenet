'use client';
import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Trash2, ExternalLink } from 'lucide-react';
import { deleteSequenceAction } from '@/app/actions/sequences';
import SequenceViewer, { type SequenceFeature } from './SequenceViewer';

interface SeqRecord {
  id: string;
  name: string;
  type: string;
  sequence: string;
  size: number;
  description: string | null;
  tags: string | null;
  features: string | null;
  createdAt: Date;
}

interface Props {
  sequences: SeqRecord[];
}

export default function SequenceLibrary({ sequences }: Props) {
  const genes = sequences.filter(s => s.type === 'gene');
  const plasmids = sequences.filter(s => s.type === 'plasmid');

  if (sequences.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {genes.length > 0 && (
        <section>
          <SectionHeader label="Gene Sequences" count={genes.length} color="var(--accent-green)" />
          <SequenceTable sequences={genes} accent="var(--accent-green)" badge="GENE" />
        </section>
      )}
      {plasmids.length > 0 && (
        <section>
          <SectionHeader label="Plasmid / Vector Sequences" count={plasmids.length} color="var(--accent-blue)" />
          <SequenceTable sequences={plasmids} accent="var(--accent-blue)" badge="PLASMID" />
        </section>
      )}
    </div>
  );
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.75rem', color, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label} ({count})
    </h2>
  );
}

function SequenceTable({ sequences, accent, badge }: { sequences: SeqRecord[]; accent: string; badge: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const handleDelete = (id: string) => {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(() => deleteSequenceAction(fd));
  };

  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
            {['', 'Name', 'Size', 'Description', 'Tags', 'Added', ''].map((h, i) => (
              <th key={i} style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sequences.map((seq, i) => {
            const isOpen = expandedId === seq.id;
            const isLast = i === sequences.length - 1;
            let parsedFeatures: SequenceFeature[] = [];
            try { parsedFeatures = JSON.parse(seq.features ?? '[]'); } catch { parsedFeatures = []; }

            return (
              <React.Fragment key={seq.id}>
                <tr
                  style={{ borderBottom: isOpen ? 'none' : isLast ? 'none' : '1px solid var(--glass-border)', cursor: 'pointer', transition: 'background 0.12s', background: isOpen ? 'var(--accent-blue-15)' : 'transparent' }}
                  onClick={() => toggle(seq.id)}
                >
                  {/* Expand toggle */}
                  <td style={{ padding: '0.85rem 0.5rem 0.85rem 1rem', width: 32 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isOpen ? accent + '22' : 'var(--bg-primary)', border: `1px solid ${isOpen ? accent + '44' : 'var(--glass-border)'}`, color: isOpen ? accent : 'var(--text-muted)', transition: 'all 0.15s' }}>
                      {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </div>
                  </td>

                  {/* Name */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, color: accent, background: `${accent}1a`, border: `1px solid ${accent}33`, padding: '0.1rem 0.35rem', borderRadius: '3px' }}>{badge}</span>
                      <Link href={`/sequences/${seq.id}`} onClick={e => e.stopPropagation()} style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        {seq.name}
                        <ExternalLink size={11} style={{ opacity: 0.4 }} />
                      </Link>
                      {parsedFeatures.length > 0 && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--accent-purple)', background: 'var(--accent-purple-10)', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                          {parsedFeatures.length} feature{parsedFeatures.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Size */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{seq.size.toLocaleString()} bp</span>
                  </td>

                  {/* Description */}
                  <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', maxWidth: '180px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{seq.description ?? '—'}</span>
                  </td>

                  {/* Tags */}
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {seq.tags
                      ? seq.tags.split(',').map(t => (
                          <span key={t} style={{ fontSize: '0.68rem', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', padding: '0.1rem 0.45rem', borderRadius: '4px', marginRight: '0.25rem' }}>{t.trim()}</span>
                        ))
                      : <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>}
                  </td>

                  {/* Date */}
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(seq.createdAt).toLocaleDateString()}
                  </td>

                  {/* Delete */}
                  <td style={{ padding: '0.85rem 1rem' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDelete(seq.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '0.2rem' }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>

                {/* Expanded viewer row */}
                {isOpen && (
                  <tr style={{ borderBottom: isLast ? 'none' : '1px solid var(--glass-border)' }}>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <SequenceViewer
                        id={seq.id}
                        name={seq.name}
                        sequence={seq.sequence}
                        size={seq.size}
                        seqType={seq.type}
                        initialFeatures={parsedFeatures}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
