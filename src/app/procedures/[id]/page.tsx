import React from 'react';
import { prisma } from '@/lib/prisma';
import SignaturePanel from '@/components/SignaturePanel';
import { signaturesFor } from '@/lib/signature';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Edit, Copy, Archive, BookOpen, Clock, User, Tag, Shield, ChevronRight } from 'lucide-react';
import { archiveProcedure, duplicateProcedure } from '@/app/actions/procedures';

export const dynamic = 'force-dynamic';

const statusColor: Record<string, string> = {
  Draft: 'badge-orange',
  Review: 'badge-purple',
  Approved: 'badge-green',
};

export default async function ProcedureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const procedure = await prisma.procedure.findUnique({
    where: { id },
    include: {
      author: true,
      steps: { orderBy: { stepNumber: 'asc' } },
      materials: true,
      equipment: true,
      versions: { include: { updatedBy: true }, orderBy: { updatedAt: 'desc' } },
    },
  });

  if (!procedure) notFound();


  const signatures = await signaturesFor('Procedure', procedure.id);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        <Link href="/procedures" style={{ color: 'var(--accent-blue)' }}>Procedures</Link>
        <ChevronRight size={14} />
        <span>{procedure.procedureId}</span>
      </div>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.2rem 0.5rem', borderRadius: 4, border: '1px solid var(--glass-border)' }}>{procedure.procedureId}</span>
              <span className={`badge ${statusColor[procedure.status] ?? ''}`}>{procedure.status}</span>
              <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{procedure.version}</span>
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{procedure.name}</h1>
            {procedure.description && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 600 }}>{procedure.description}</p>}
          </div>
          {!procedure.isArchived && (
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
              <Link href={`/procedures/${procedure.id}/edit`} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                <Edit size={15} /> Edit
              </Link>
              <form action={duplicateProcedure} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={procedure.id} />
                <button type="submit" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                  <Copy size={15} /> Duplicate
                </button>
              </form>
              <form action={archiveProcedure} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={procedure.id} />
                <button type="submit" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--accent-red)', borderColor: 'rgba(220,38,38,0.3)' }}>
                  <Archive size={15} /> Archive
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem', flexWrap: 'wrap', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border)' }}>
          <Meta icon={<Tag size={14} />} label="Category" value={procedure.category} />
          <Meta icon={<User size={14} />} label="Author" value={procedure.author.name} />
          {procedure.reviewer && <Meta icon={<User size={14} />} label="Reviewer" value={procedure.reviewer} />}
          {procedure.contributors && <Meta icon={<User size={14} />} label="Contributors" value={procedure.contributors} />}
          <Meta icon={<Clock size={14} />} label="Updated" value={new Date(procedure.updatedAt).toLocaleDateString()} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Steps */}
          {procedure.steps.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BookOpen size={18} color="var(--accent-blue)" /> Protocol Steps
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {procedure.steps.map(step => (
                  <div key={step.id} style={{ display: 'flex', gap: '1rem' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-blue)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{step.stepNumber}</div>
                    <div>
                      {step.title && <div style={{ fontWeight: 600, fontSize: '0.92rem', marginBottom: '0.35rem', color: 'var(--text-primary)' }}>{step.title}</div>}
                      <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{step.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Safety Notes */}
          {procedure.safetyNotes && (
            <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid rgba(217,119,6,0.25)', background: 'rgba(217,119,6,0.04)' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-orange)' }}>
                <Shield size={18} /> Safety Notes
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{procedure.safetyNotes}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Materials */}
          {procedure.materials.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>Required Materials</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {procedure.materials.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', padding: '0.4rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{m.materialName}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{[m.quantity, m.unit].filter(Boolean).join(' ') || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Equipment */}
          {procedure.equipment.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>Equipment</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {procedure.equipment.map(eq => (
                  <span key={eq.id} style={{ padding: '0.25rem 0.65rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', borderRadius: 20, fontSize: '0.78rem', color: 'var(--accent-blue)' }}>{eq.equipmentName}</span>
                ))}
              </div>
            </div>
          )}

          {/* Version History */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={15} /> Version History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {procedure.versions.map(v => (
                <div key={v.id} style={{ fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--accent-blue)', fontWeight: 600 }}>{v.versionNumber}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(v.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{v.changeLog}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.15rem' }}>by {v.updatedBy.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <SignaturePanel model="Procedure" recordId={procedure.id} signatures={signatures} />
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{value}</span>

  </div>
  );
}
