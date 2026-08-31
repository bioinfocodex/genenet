'use client';
import { useState, useMemo } from 'react';
import { GitBranch, Download, AlertTriangle } from 'lucide-react';
import { alignPair } from '@/lib/alignment';
import {
  pairwiseDistanceMatrix, neighbourJoining, upgma, toNewick,
  type DistanceModel, type TreeNode,
} from '@/lib/phylogenetics';

/**
 * Tree building over sequences already in the library.
 *
 * The alignment, the distances and the tree are all shown, not just the
 * picture: a tree drawn from a bad alignment looks exactly like a tree drawn
 * from a good one, and the number of usable sites is what tells them apart.
 */

type Seq = { id: string; name: string; size: number; type: string; sequence: string };
type Method = 'nj' | 'upgma';

interface Result {
  tree: TreeNode;
  newick: string;
  names: string[];
  d: number[][];
  sitesUsed: number;
  identity: number;
  saturated: string[];
}

/** Tip coordinates for a rectangular phylogram. */
interface Laid { node: TreeNode; x: number; y: number; parentX: number }

function layout(root: TreeNode, useLengths: boolean): { rows: Laid[]; depth: number; tips: number } {
  const rows: Laid[] = [];
  let tip = 0;
  let maxX = 0;

  const walk = (n: TreeNode, x: number): number => {
    const nx = x + (useLengths ? n.length : (n.children?.length ? 1 : 1));
    if (!n.children?.length) {
      const y = tip++;
      maxX = Math.max(maxX, nx);
      rows.push({ node: n, x: nx, y, parentX: x });
      return y;
    }
    const ys = n.children.map(c => walk(c, nx));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    rows.push({ node: n, x: nx, y, parentX: x });
    return y;
  };
  walk(root, 0);
  return { rows, depth: maxX || 1, tips: tip };
}

export default function PhylogenyClient({ sequences }: { sequences: Seq[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [model, setModel] = useState<DistanceModel>('jc69');
  const [method, setMethod] = useState<Method>('nj');
  const [useLengths, setUseLengths] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const toggle = (id: string) =>
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const chosen = useMemo(() => sequences.filter(s => picked.includes(s.id)), [sequences, picked]);

  const build = () => {
    setRunning(true); setError(null); setResult(null);
    // Yield so the button paints before the alignment blocks the thread.
    setTimeout(() => {
      try {
        // Each pair aligned on its own: a distance method needs every pair
        // measured well, not every sequence forced into one frame. One
        // sequence placed badly in a progressive alignment otherwise reads as
        // saturated against everything and hangs off a long false branch.
        const taxa = chosen.map((s, i) => ({ id: String(i), name: s.name, sequence: s.sequence }));
        const dm = pairwiseDistanceMatrix(taxa, model);

        // Mean pairwise identity, as a check on whether these belong together.
        let idSum = 0, idN = 0;
        for (let i = 0; i < taxa.length; i++) {
          for (let j = i + 1; j < taxa.length; j++) {
            idSum += alignPair(taxa[i].sequence, taxa[j].sequence).identity; idN++;
          }
        }
        const identity = idN ? idSum / idN : 0;

        // An infinite distance means two sequences are no more alike than
        // chance. A tree cannot place them, so say so rather than drawing one.
        const saturated: string[] = [];
        for (let i = 0; i < dm.names.length; i++) {
          for (let j = i + 1; j < dm.names.length; j++) {
            if (!Number.isFinite(dm.d[i][j])) saturated.push(`${dm.names[i]} / ${dm.names[j]}`);
          }
        }
        if (saturated.length) {
          setError(
            `These pairs are too diverged for the ${model.toUpperCase()} correction: ` +
            `${saturated.join(', ')}. Use p-distance, or drop one of each pair.`,
          );
          setRunning(false);
          return;
        }

        const tree = method === 'nj' ? neighbourJoining(dm) : upgma(dm);
        setResult({
          tree, newick: toNewick(tree), names: dm.names, d: dm.d,
          sitesUsed: dm.sitesUsed, identity, saturated,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not build a tree from those sequences.');
      }
      setRunning(false);
    }, 0);
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.newick], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tree.nwk';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const laid = result ? layout(result.tree, useLengths) : null;
  const W = 620, PAD_L = 12, PAD_R = 150, ROW = 26;
  const H = laid ? Math.max(120, laid.tips * ROW + 40) : 0;
  const sx = (x: number) => PAD_L + (x / (laid?.depth || 1)) * (W - PAD_L - PAD_R);
  const sy = (y: number) => 20 + y * ROW;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Pick sequences */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.2rem' }}>Sequences</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.9rem' }}>
          Pick three or more. They should be the same region from different sources &mdash; a tree
          over unrelated sequences is arithmetic, not biology.
        </p>

        {sequences.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No sequences in the library yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.4rem', maxHeight: 260, overflowY: 'auto' }}>
            {sequences.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem',
                border: `1px solid ${picked.includes(s.id) ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
                borderRadius: 7, cursor: 'pointer', fontSize: '0.83rem',
                background: picked.includes(s.id) ? 'rgba(59,130,246,0.06)' : 'transparent',
              }}>
                <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{s.size}</span>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '1rem' }}>
          <Field label="Distance">
            <select className="input-control" value={model} onChange={e => setModel(e.target.value as DistanceModel)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>
              <option value="p">p-distance (uncorrected)</option>
              <option value="jc69">Jukes–Cantor</option>
              <option value="k2p">Kimura 2-parameter</option>
            </select>
          </Field>
          <Field label="Method">
            <select className="input-control" value={method} onChange={e => setMethod(e.target.value as Method)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>
              <option value="nj">Neighbour-joining</option>
              <option value="upgma">UPGMA</option>
            </select>
          </Field>
          <button onClick={build} disabled={running || chosen.length < 3} className="btn btn-primary" style={{ fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <GitBranch size={14} /> {running ? 'Building…' : 'Build tree'}
          </button>
          {chosen.length > 0 && chosen.length < 3 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {3 - chosen.length} more needed
            </span>
          )}
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0', lineHeight: 1.6 }}>
          {method === 'nj'
            ? 'Neighbour-joining does not assume a constant rate, so a faster-evolving lineage gets a longer branch. Use it for a gene tree.'
            : 'UPGMA assumes a molecular clock: every tip ends up the same distance from the root. Right for a similarity dendrogram, wrong for history unless the clock holds.'}
        </p>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
          <AlertTriangle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: '0.84rem', color: '#991b1b', lineHeight: 1.55 }}>{error}</span>
        </div>
      )}

      {result && laid && (
        <>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Tree</h2>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input type="checkbox" checked={useLengths} onChange={e => setUseLengths(e.target.checked)} />
                  Branch lengths to scale
                </label>
                <button onClick={download} className="btn btn-secondary" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Download size={13} /> Newick
                </button>
              </div>
            </div>

            <Stats
              sites={result.sitesUsed}
              identity={result.identity}
              taxa={result.names.length}
              model={model}
            />

            <div style={{ overflowX: 'auto', marginTop: '0.9rem' }}>
              <svg width={W} height={H} style={{ minWidth: W }}>
                {laid.rows.map((r, i) => {
                  const isTip = !r.node.children?.length;
                  return (
                    <g key={i}>
                      {/* horizontal: the branch itself */}
                      <line x1={sx(r.parentX)} y1={sy(r.y)} x2={sx(r.x)} y2={sy(r.y)} stroke="var(--text-secondary)" strokeWidth={1.5} />
                      {/* vertical: the connector joining this node's children */}
                      {r.node.children?.length ? (() => {
                        const kids = laid.rows.filter(k => r.node.children!.includes(k.node));
                        if (!kids.length) return null;
                        const ys = kids.map(k => k.y);
                        return <line x1={sx(r.x)} y1={sy(Math.min(...ys))} x2={sx(r.x)} y2={sy(Math.max(...ys))} stroke="var(--text-secondary)" strokeWidth={1.5} />;
                      })() : null}
                      {isTip && (
                        <text x={sx(r.x) + 6} y={sy(r.y) + 4} fontSize={11} fill="var(--text-primary)">
                          {r.node.name}
                        </text>
                      )}
                    </g>
                  );
                })}
                {useLengths && (
                  <g>
                    <line x1={sx(0)} y1={H - 14} x2={sx(laid.depth / 4)} y2={H - 14} stroke="var(--text-muted)" strokeWidth={1} />
                    <text x={sx(0)} y={H - 3} fontSize={9} fill="var(--text-muted)">
                      {(laid.depth / 4).toFixed(3)} substitutions/site
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Distances</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0.3rem 0.6rem' }} />
                    {result.names.map(n => (
                      <th key={n} style={{ padding: '0.3rem 0.6rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600 }}>{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.names.map((n, i) => (
                    <tr key={n}>
                      <td style={{ padding: '0.3rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{n}</td>
                      {result.d[i].map((v, j) => (
                        <td key={j} style={{ padding: '0.3rem 0.6rem', textAlign: 'right', fontFamily: 'monospace', color: i === j ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          {i === j ? '—' : v.toFixed(4)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' }}>Newick</div>
              <code style={{ display: 'block', padding: '0.6rem 0.8rem', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: '0.72rem', wordBreak: 'break-all', lineHeight: 1.6 }}>
                {result.newick}
              </code>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      {children}
    </label>
  );
}

function Stats({ sites, identity, taxa, model }: { sites: number; identity: number; taxa: number; model: DistanceModel }) {
  const thin = sites < 100;
  return (
    <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
      <span><span style={{ color: 'var(--text-muted)' }}>Taxa </span>{taxa}</span>
      <span>
        <span style={{ color: 'var(--text-muted)' }}>Sites used </span>
        <span style={{ color: thin ? 'var(--accent-orange)' : 'inherit', fontWeight: thin ? 700 : 400 }}>{sites}</span>
      </span>
      <span><span style={{ color: 'var(--text-muted)' }}>Alignment identity </span>{Math.round(identity * 100)}%</span>
      <span><span style={{ color: 'var(--text-muted)' }}>Model </span>{model === 'p' ? 'p-distance' : model === 'jc69' ? 'Jukes–Cantor' : 'Kimura 2-P'}</span>
      {thin && (
        <span style={{ color: 'var(--accent-orange)' }}>
          Few usable columns &mdash; the branch lengths carry little weight.
        </span>
      )}
    </div>
  );
}
