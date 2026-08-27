'use client';
import React from 'react';
import { 
  Info, 
  Dna, 
  Zap, 
  Hash, 
  BarChart, 
  PieChart 
} from 'lucide-react';
// This panel reports DNA statistics; the amino-acid tables and the protein
// molecular-weight helper were imported but never used. estimateProteinMW does
// not exist in molbuilder-logic at all, which broke the build.
import { wallaceTm } from '@/lib/molbuilder-logic';
import type { SequenceFeature } from '@/components/SequenceViewer';

interface MolbuilderStatsProps {
  seq: string;
  selection?: { start: number; end: number } | null;
  features: SequenceFeature[];
  onClose: () => void;
}

export default function MolbuilderStats({
  seq,
  selection,
  features,
  onClose
}: MolbuilderStatsProps) {
  
  const targetSeq = selection ? seq.substring(selection.start, selection.end) : seq;
  const isSel = !!selection;
  const len = targetSeq.length;

  // Stats calculation
  const A = (targetSeq.match(/A/gi) || []).length;
  const T = (targetSeq.match(/T/gi) || []).length;
  const G = (targetSeq.match(/G/gi) || []).length;
  const C = (targetSeq.match(/C/gi) || []).length;
  const GC = len > 0 ? ((G + C) / len * 100).toFixed(1) : '0';
  const tm = wallaceTm(targetSeq);
  // ~650 Da per base pair, the standard double-stranded approximation. This
  // was 330, which is the per-nucleotide figure for a single strand and so
  // reported half the mass of any plasmid or other duplex shown here.
  const mw = (len * 650 / 1000).toFixed(1); // Da -> kDa

  return (
    <div className="seq-stats-sidebar animate-fade-in" style={{ 
      width: '300px', 
      borderLeft: '1px solid var(--seq-border)', 
      background: 'white',
      padding: '0'
    }}>
      <div className="stats-section" style={{ 
        padding: '1.25rem', 
        borderBottom: '1px solid var(--seq-border)',
        background: 'linear-gradient(to bottom, #fcfdfe, #ffffff)' 
      }}>
        <div className="stats-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BarChart size={16} color="var(--accent-blue)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>
              {isSel ? 'Region Analysis' : 'Sequence Stats'}
            </span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>

        {isSel && (
          <div style={{ padding: '0.6rem 0.8rem', background: 'var(--accent-blue-15)', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-blue)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Selection</div>
            <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: '0.85rem' }}>
              {selection.start + 1} – {selection.end} ({len} bp)
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <StatRow label="Length" value={`${len.toLocaleString()} bp`} icon={<Hash size={14} />} />
          <StatRow label="GC Content" value={`${GC}%`} icon={<Zap size={14} />} />
          
          {/* GC Bar */}
          <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', position: 'relative', overflow: 'hidden', margin: '0.25rem 0' }}>
            <div style={{ 
              position: 'absolute', 
              top: 0, left: 0, height: '100%', 
              width: `${GC}%`, 
              background: parseFloat(GC) < 40 ? '#ef4444' : parseFloat(GC) > 65 ? '#f59e0b' : '#10b981',
              borderRadius: '3px',
              transition: 'width 0.3s ease'
            }} />
          </div>

          <StatRow label="Tm (Wallace)" value={`${tm}°C`} icon={<Info size={14} />} />
          <StatRow label="Molecular Weight (dsDNA)" value={`${mw} kDa`} icon={<Dna size={14} />} />
        </div>
      </div>

      <div className="stats-section" style={{ padding: '1.25rem' }}>
        <div className="stats-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <PieChart size={16} color="var(--accent-purple)" />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>Nucleotide Frequency</span>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <FreqItem label="A" count={A} total={len} color="#3b82f6" />
          <FreqItem label="T" count={T} total={len} color="#ef4444" />
          <FreqItem label="G" count={G} total={len} color="#10b981" />
          <FreqItem label="C" count={C} total={len} color="#f59e0b" />
        </div>
      </div>

      <div className="stats-section" style={{ padding: '1.25rem', borderBottom: 'none' }}>
        <div className="stats-title" style={{ marginBottom: '1rem' }}>Overlapping Features</div>
        {features.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>No features in this range.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {features.slice(0, 8).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', borderRadius: '6px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: f.color || '#94a3b8' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{f.end - f.start + 1}bp</span>
              </div>
            ))}
            {features.length > 8 && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', marginTop: '0.25rem' }}>+ {features.length - 8} more features</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="stats-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
        {icon}
        <span>{label}</span>
      </div>
      <span style={{ fontWeight: 700, color: '#1e293b', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function FreqItem({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total * 100).toFixed(1) : '0';
  return (
    <div style={{ padding: '0.6rem', background: '#fcfdfe', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 800, color, marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>{pct}%</div>
      <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{count} bases</div>
    </div>
  );
}
