import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { AudioLines } from 'lucide-react';
import { oligoStats, bindingsInLibrary, LIBRARY_MIN_ANNEAL } from '@/lib/oligos';
import { checkOligo } from '@/lib/secondary-structure';
import { nnTm } from '@/lib/tm';
import OligoEditor from './client';

export const dynamic = 'force-dynamic';

export default async function OligoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const oligo = await prisma.oligo.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  });
  if (!oligo) notFound();

  // Computed on every visit rather than stored: a plasmid edited yesterday is
  // searched as it is today.
  const library = await prisma.geneSequence.findMany({ select: { id: true, name: true, type: true, sequence: true } });
  const hits = bindingsInLibrary(
    oligo.sequence,
    library.map(s => ({ id: s.id, name: s.name, sequence: s.sequence, circular: s.type === 'plasmid' })),
  );

  const stats = oligoStats(oligo.sequence);
  const structure = checkOligo(oligo.sequence);
  const annealTm = (n: number) => Math.round(nnTm(oligo.sequence.slice(oligo.sequence.length - n)) * 10) / 10;

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ fontSize: '0.82rem', marginBottom: '0.6rem' }}>
        <Link href="/oligos">Oligos</Link> <span style={{ color: 'var(--text-muted)' }}>›</span> {oligo.code}
      </div>

      <div className="glass-panel" style={{ padding: '1.4rem 1.6rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.6rem' }}>
          <AudioLines size={22} />
          <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent-blue)' }}>{oligo.code}</span>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{oligo.name}</h1>
          {oligo.archived && <span style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>archived</span>}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', wordBreak: 'break-all', padding: '0.6rem 0.8rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
          5′-{oligo.sequence}-3′
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.84rem', flexWrap: 'wrap' }}>
          <span><strong>{stats.length}</strong> nt</span>
          <span>GC <strong>{stats.gc}%</strong></span>
          <span>Tm <strong>{Number.isNaN(stats.tm) ? '—' : `${stats.tm}°C`}</strong> <span style={{ color: 'var(--text-muted)' }}>(whole oligo)</span></span>
          {oligo.location && <span>Location <strong>{oligo.location}</strong></span>}
          {oligo.modifications && <span>Modifications <strong>{oligo.modifications}</strong></span>}
          <span style={{ color: 'var(--text-muted)' }}>Added by {oligo.createdBy.name}, {oligo.createdAt.toLocaleDateString()}</span>
        </div>
        {oligo.notes && <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: '0.6rem', marginBottom: 0 }}>{oligo.notes}</p>}
        {structure.warnings.length > 0 && (
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {structure.warnings.map(w => (
              <div key={w} style={{ fontSize: '0.8rem', padding: '0.45rem 0.7rem', borderRadius: 6, background: 'rgba(217,119,6,0.08)', color: 'var(--accent-orange)' }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>Binds in {hits.length} sequence{hits.length === 1 ? '' : 's'}</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.8rem' }}>
          Every sequence in the library where at least the last {LIBRARY_MIN_ANNEAL} bases of the 3′ end match exactly, on
          either strand. Searched now, against the sequences as they stand.
        </p>
        {hits.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Nothing in the library. The template it was ordered for may not have been added yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>{['Sequence', 'Anneals at', 'Strand', 'Anneal', 'Anneal Tm', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.4rem 0.6rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {hits.flatMap(h => h.sites.map((s, i) => (
                <tr key={`${h.sequenceId}-${s.start}-${s.strand}`} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td style={cell}>{i === 0 && <Link href={`/sequences/${h.sequenceId}`} style={{ fontWeight: 600 }}>{h.sequenceName}</Link>}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{(s.start + 1).toLocaleString()}–{(s.end + 1).toLocaleString()}{s.wrapsOrigin ? ' (through origin)' : ''}</td>
                  <td style={cell}>{s.strand}</td>
                  <td style={cell}>{s.exact ? `full ${s.annealLength} nt` : `${s.annealLength} nt + ${s.tailLength} nt tail`}</td>
                  <td style={cell}>{annealTm(s.annealLength)}°C</td>
                  <td style={{ ...cell, color: '#a3560a' }}>{i === 0 && h.sites.length > 1 ? `${h.sites.length} sites: expect extra bands` : ''}</td>
                </tr>
              )))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <OligoEditor oligo={{
        id: oligo.id, name: oligo.name, modifications: oligo.modifications ?? '',
        location: oligo.location ?? '', notes: oligo.notes ?? '', archived: oligo.archived,
      }} />
    </div>
  );
}

const cell: React.CSSProperties = { padding: '0.4rem 0.6rem', verticalAlign: 'top' };
