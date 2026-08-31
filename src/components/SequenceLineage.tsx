import Link from 'next/link';
import { GitBranch, CornerDownRight } from 'lucide-react';
import type { LineageNode } from '@/lib/lineage';

/**
 * Where a construct came from, drawn as descent rather than listed as prose.
 *
 * Indentation carries the generations, so a construct assembled from parts that
 * were themselves assembled reads as the chain it is. A parent whose record has
 * been deleted is still shown, greyed and unlinked: the fact that something was
 * used is worth more than the fact that it is gone.
 */

function Row({ node }: { node: LineageNode }) {
  const isRoot = node.depth === 0;
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        paddingLeft: `${node.depth * 1.4}rem`,
        paddingTop: '0.35rem', paddingBottom: '0.35rem',
      }}>
        {!isRoot && <CornerDownRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        {node.id && !node.missing ? (
          <Link href={`/sequences/${node.id}`} style={{
            fontSize: '0.86rem', fontWeight: isRoot ? 700 : 600,
            color: isRoot ? 'var(--text-primary)' : 'var(--accent-blue)',
          }}>
            {node.name}
          </Link>
        ) : (
          <span style={{
            fontSize: '0.86rem', fontWeight: isRoot ? 700 : 600,
            color: 'var(--text-muted)', fontStyle: node.missing ? 'italic' : 'normal',
          }} title={node.missing ? 'This record no longer exists' : 'Recorded by name only'}>
            {node.name}
          </span>
        )}
        {node.method && (
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 3,
            background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
            color: 'var(--text-muted)', whiteSpace: 'nowrap',
          }}>
            {node.method}
          </span>
        )}
        {node.missing && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>deleted</span>
        )}
        {node.unlinked && !node.missing && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} title="recorded by name only">
            not linked
          </span>
        )}
      </div>
      {node.parents.map((p, i) => <Row key={`${p.id ?? p.name}-${i}`} node={p} />)}
    </>
  );
}

export default function SequenceLineage({
  ancestry, descendants,
}: {
  ancestry: LineageNode;
  descendants: { id: string; name: string; method: string; at: Date }[];
}) {
  const hasParents = ancestry.parents.length > 0;
  if (!hasParents && descendants.length === 0) return null;

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h2 style={{
        fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <GitBranch size={16} /> Lineage
      </h2>

      {hasParents ? (
        <div>
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.3rem',
          }}>
            Built from
          </div>
          <Row node={ancestry} />
        </div>
      ) : (
        <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>
          No recorded parents. Constructs assembled in the Cloning Wizard record theirs; an imported
          or hand-entered sequence has none to record.
        </p>
      )}

      {descendants.length > 0 && (
        <div style={{ marginTop: hasParents ? '1.25rem' : '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
          }}>
            Used to make
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {descendants.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Link href={`/sequences/${d.id}`} style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
                  {d.name}
                </Link>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 3,
                  background: 'var(--bg-primary)', border: '1px solid var(--glass-border)',
                  color: 'var(--text-muted)', whiteSpace: 'nowrap',
                }}>
                  {d.method}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
