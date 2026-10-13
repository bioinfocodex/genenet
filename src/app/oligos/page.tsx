import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-guard';
import { AudioLines } from 'lucide-react';
import { oligoStats } from '@/lib/oligos';
import AddOligos from './add-oligos';

export const dynamic = 'force-dynamic';

export default async function OligosPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  await requireUser();
  const { q = '', archived } = await searchParams;
  const query = q.trim();
  const showArchived = archived === '1';

  // A query that is all bases is looked for inside sequences too, so pasting a
  // stretch of a primer finds the tube.
  const asBases = query.toUpperCase().replace(/[^ACGTU]/g, '').replace(/U/g, 'T');
  const searchesBases = asBases.length >= 6 && asBases.length === query.replace(/\s/g, '').length;

  const oligos = await prisma.oligo.findMany({
    where: {
      ...(showArchived ? {} : { archived: false }),
      ...(query
        ? {
            OR: [
              { code: { contains: query } },
              { name: { contains: query } },
              { notes: { contains: query } },
              { location: { contains: query } },
              ...(searchesBases ? [{ sequence: { contains: asBases } }] : []),
            ],
          }
        : {}),
    },
    include: { createdBy: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '1.9rem', display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <AudioLines size={26} /> Oligos
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', fontSize: '0.88rem', maxWidth: '72ch', lineHeight: 1.6 }}>
            The lab&apos;s primers and oligos, one record per tube. Each is matched against every sequence in the
            library by its 3′ end, so an oligo shows up on any plasmid it anneals to without being filed against it.
          </p>
        </div>
        <AddOligos />
      </div>

      <form style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          name="q"
          defaultValue={query}
          placeholder="Code, name, location, or a stretch of sequence"
          className="input-control"
          style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.88rem' }}
        />
        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} /> archived
        </label>
        <button className="btn btn-secondary" style={{ fontSize: '0.84rem' }}>Search</button>
      </form>

      {oligos.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {query ? `No oligo matches “${query}”.` : 'No oligos yet. Add one, or paste a list from a spreadsheet.'}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                {['Code', 'Name', 'Sequence (5′→3′)', 'Length', 'Tm', 'GC', 'Location'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.55rem 0.8rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {oligos.map(o => {
                const s = oligoStats(o.sequence);
                return (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--glass-border)', opacity: o.archived ? 0.55 : 1 }}>
                    <td style={td}><Link href={`/oligos/${o.id}`} style={{ fontWeight: 700, fontFamily: 'monospace' }}>{o.code}</Link></td>
                    <td style={td}>
                      <Link href={`/oligos/${o.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.name}</Link>
                      {o.modifications && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{o.modifications}</div>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.76rem', wordBreak: 'break-all', maxWidth: 360 }}>{o.sequence}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.length}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{Number.isNaN(s.tm) ? '—' : `${s.tm}°C`}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.gc}%</td>
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>{o.location ?? ''}{o.archived ? ' (archived)' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
        {oligos.length} oligo{oligos.length === 1 ? '' : 's'}. Tm is nearest-neighbour for the whole oligo in a standard PCR buffer (50 mM Na⁺, 1.5 mM Mg²⁺, 0.6 mM dNTP); a tailed oligo anneals at the Tm of its 3′ part, shown on each sequence it binds.
      </p>
    </div>
  );
}

const td: React.CSSProperties = { padding: '0.5rem 0.8rem', verticalAlign: 'top' };
