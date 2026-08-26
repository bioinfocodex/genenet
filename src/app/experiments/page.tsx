import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Beaker } from 'lucide-react';
import ExpectedGel from '@/components/ExpectedGel';
import PlasmidMap from '@/components/PlasmidMap';

export const dynamic = 'force-dynamic';

export default async function ExperimentsPage() {
  const experiments = await prisma.experiment.findMany({
    include: { user: true },
    orderBy: { createdAt: 'desc' }
  });

  const protocols = [
    "PCR",
    "Plasmid extraction",
    "Restriction digestion",
    "Fragment ligation",
    "Plasmid construction",
    "Colonies PCR",
    "Transformation to yeast"
  ];

  const getResultNotes = (data: string) => {
    try {
      return JSON.parse(data).notes || data;
    } catch {
      return data;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Genetic Engineering Hub</h1>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
           {protocols.slice(0, 3).map(p => (
             <Link key={p} href={`/experiments/new?protocol=${encodeURIComponent(p)}`} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>+ {p}</Link>
           ))}
           <Link href="/experiments/new" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>Explore Templates</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
         {experiments.map(exp => (
           <div key={exp.id} className="glass-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}>
              <div style={{ padding: '1.25rem', background: 'var(--accent-purple-10)', borderRadius: '12px', color: 'var(--accent-purple)' }}>
                 <Beaker size={32} />
              </div>
              <div style={{ flex: 1 }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.35rem' }}>
                    <h3 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--text-primary)' }}>{exp.title}</h3>
                    <span className={`badge ${exp.status === 'COMPLETED' ? 'badge-green' : exp.status === 'IN_PROGRESS' ? 'badge-purple' : 'badge-orange'}`}>
                       {exp.status.replace('_', ' ')}
                    </span>
                 </div>
                 <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Protocol: <strong style={{color: 'var(--text-primary)', fontWeight: 600}}>{exp.protocol}</strong> &nbsp;•&nbsp; Logged by {exp.user.name} &nbsp;•&nbsp; {new Date(exp.createdAt).toLocaleDateString()}
                 </div>
                 
                 {exp.resultData && (
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-purple)' }}>
                       {getResultNotes(exp.resultData)}
                    </div>
                 )}

                 {exp.expectedParams && (() => {
                    try {
                      const params = JSON.parse(exp.expectedParams);
                      // Render PCR Gel
                      if ((exp.protocol === 'PCR' || exp.protocol === 'Colonies PCR') && params.bandSizes) {
                         return <ExpectedGel bands={params.bandSizes} />;
                      }
                      // Render Plasmid Map
                      if ((exp.protocol === 'Restriction digestion' || exp.protocol === 'Plasmid construction' || exp.protocol === 'Plasmid extraction') && params.totalBp && params.cuts) {
                         return <PlasmidMap name={params.plasmidName || 'Vector'} totalBp={params.totalBp} cuts={params.cuts} />;
                      }
                    } catch { 
                      return null; 
                    }
                 })()}

              </div>
           </div>
         ))}
      </div>
    </div>
  );
}
