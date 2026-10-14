'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Scissors, Trash2 } from 'lucide-react';
import { ENZYMES } from '@/lib/restrictionEnzymes';
import {
  prepared, bluntEnds, dephosphorylate, phosphorylate, ligationCheck,
  strandCuts, digestToFragments, annealOligos,
  type PreparedFragment,
} from '@/lib/fragments';
import { assemble, type Assembly } from '@/lib/assembly';
import { carryFeatures, type ParentAnnotation } from '@/lib/carry-features';
import { normaliseFeatures } from '@/lib/features';
import { saveConstruct } from '@/app/actions/sequences';

/**
 * The bench between a digest and a ligation.
 *
 * The Cloning Wizard asks for a method and gives a product. This asks for
 * nothing: fragments go on the bench from a digest, from a sequence whole, or
 * from two annealed oligos, and are then blunted, dephosphorylated or
 * phosphorylated one at a time until their ends fit. It is for the plan the
 * wizard has no name for -- a fill-in to destroy a site, a vector treated with
 * phosphatase so it cannot close empty, an adaptor to change one end.
 */

export interface SeqRecord {
  id: string;
  name: string;
  type: string;
  sequence: string;
  size: number;
  features?: string | null;
}

interface BenchItem {
  key: string;
  fragment: PreparedFragment;
  /** What it came from and what has been done to it, in order. */
  history: string[];
  /** The library record it descends from, for carrying annotation and lineage. */
  parent?: SeqRecord;
}

const endLabel = (type: string, overhang: string) =>
  type === 'blunt' ? 'blunt' : `${type} ${overhang}`;

export default function WorkbenchClient({ sequences }: { sequences: SeqRecord[] }) {
  const [bench, setBench] = useState<BenchItem[]>([]);
  const [sourceId, setSourceId] = useState(sequences[0]?.id ?? '');
  const [enzymeText, setEnzymeText] = useState('EcoRI BamHI');
  const [topOligo, setTopOligo] = useState('');
  const [bottomOligo, setBottomOligo] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [circular, setCircular] = useState(true);
  const [allowBlunt, setAllowBlunt] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const source = sequences.find(s => s.id === sourceId);
  let nextKey = bench.length;
  const add = (items: BenchItem[]) => { setBench(prev => [...prev, ...items]); setSaved(null); };

  const namedEnzymes = useMemo(() => {
    const names = enzymeText.split(/[\s,+]+/).filter(Boolean);
    return {
      found: names.filter(n => ENZYMES[n]).map(n => ({ ...ENZYMES[n], name: n })),
      unknown: names.filter(n => !ENZYMES[n]),
    };
  }, [enzymeText]);

  const digest = () => {
    if (!source || namedEnzymes.found.length === 0) return;
    const isCircular = source.type === 'plasmid';
    const cuts = strandCuts(source.sequence, isCircular, namedEnzymes.found);
    if (cuts.length === 0) { setError(`${namedEnzymes.found.map(e => e.name).join(' + ')} does not cut ${source.name}.`); return; }
    setError(null);
    const pieces = digestToFragments(source.sequence, isCircular, cuts);
    add(pieces.map((f, i) => ({
      key: `b${nextKey++}-${i}`,
      fragment: { ...f, id: `${source.id}-${i}`, name: `${source.name} ${f.name}` },
      history: [`${namedEnzymes.found.map(e => e.name).join(' + ')} digest of ${source.name}`],
      parent: source,
    })));
  };

  const addWhole = () => {
    if (!source) return;
    setError(null);
    add([{
      key: `b${nextKey++}`,
      fragment: prepared({ id: source.id, name: source.name, seq: source.sequence, left: { type: 'blunt', overhang: '' }, right: { type: 'blunt', overhang: '' } }, false),
      history: [`${source.name}, whole and blunt (a PCR product, so no phosphates)`],
      parent: source,
    }]);
  };

  const addOligos = () => {
    const { fragment, error: err } = annealOligos(`oligo${nextKey}`, 'annealed oligos', topOligo, bottomOligo);
    if (err) { setError(err); return; }
    setError(null);
    add([{ key: `b${nextKey++}`, fragment, history: ['annealed from two oligos'] }]);
    setTopOligo(''); setBottomOligo('');
  };

  const apply = (key: string, what: 'blunt' | 'dephos' | 'phos') => {
    setBench(prev => prev.map(item => {
      if (item.key !== key) return item;
      if (what === 'dephos') return { ...item, fragment: dephosphorylate(item.fragment), history: [...item.history, 'dephosphorylated'] };
      if (what === 'phos') return { ...item, fragment: phosphorylate(item.fragment), history: [...item.history, 'phosphorylated (T4 PNK)'] };
      const r = bluntEnds(item.fragment);
      return { ...item, fragment: r.fragment, history: [...item.history, ...(r.notes.length ? r.notes : ['blunted (no overhangs to change)'])] };
    }));
    setSaved(null);
  };

  const chosen = bench.filter(b => picked.includes(b.key));

  // Why a chosen pair will or will not be joined, in the order picked.
  const ligationNotes = useMemo(() => {
    const notes: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const a = chosen[i];
      const b = chosen[(i + 1) % chosen.length];
      if (!circular && i === chosen.length - 1) break;
      const r = ligationCheck(a.fragment, b.fragment, { allowBlunt });
      if (!r.joins) notes.push(`${a.fragment.name} → ${b.fragment.name}: ${r.reason}`);
    }
    return notes;
  }, [chosen, circular, allowBlunt]);

  // The engine knows geometry, not chemistry: it will happily arrange ends
  // that fit while no phosphate exists to seal them. A product shown under a
  // warning that it cannot be made is a product someone will order primers
  // against, so there is nothing to show until the chemistry allows it.
  const result = useMemo(() => {
    if (chosen.length === 0 || ligationNotes.length > 0) return null;
    try {
      return assemble(chosen.map(c => c.fragment), {
        mode: 'overhang',
        topology: circular ? 'circular' : 'linear',
        allowBlunt,
        limit: 4,
      });
    } catch (e) {
      return { assemblies: [] as Assembly[], problems: [{ kind: 'no-assembly' as const, message: (e as Error).message }], steps: 0 };
    }
  }, [chosen, circular, allowBlunt, ligationNotes]);

  const product = result?.assemblies[0] ?? null;
  const carried = useMemo(() => {
    if (!product) return null;
    const parents = new Map<string, ParentAnnotation>();
    for (const c of chosen) {
      if (c.parent && !parents.has(c.parent.id)) {
        parents.set(c.parent.id, { name: c.parent.name, sequence: c.parent.sequence, circular: c.parent.type === 'plasmid', features: normaliseFeatures(c.parent.features) });
      }
    }
    return carryFeatures(product.sequence, product.topology === 'circular', [...parents.values()]);
  }, [product, chosen]);

  const save = () => {
    if (!product) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the construct a name first.'); return; }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('name', trimmed);
      fd.append('sequence', product.sequence);
      fd.append('method', 'workbench ligation');
      fd.append('topology', product.topology);
      fd.append('parts', chosen.map(c => c.fragment.name).join(', '));
      fd.append('parents', JSON.stringify([...new Map(chosen.filter(c => c.parent).map(c => [c.parent!.id, { id: c.parent!.id, name: c.parent!.name }])).values()]));
      fd.append('features', JSON.stringify(carried?.features ?? []));
      const r = await saveConstruct(fd);
      if ('error' in r) setError(r.error);
      else { setSaved(r.id); router.refresh(); }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Put something on the bench</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={label}>
            <span style={labelText}>Sequence</span>
            <select value={sourceId} onChange={e => setSourceId(e.target.value)} className="input-control" style={{ ...input, minWidth: 220 }}>
              {sequences.map(s => <option key={s.id} value={s.id}>{s.name} ({s.size.toLocaleString()} bp{s.type === 'plasmid' ? ', circular' : ''})</option>)}
            </select>
          </label>
          <label style={label}>
            <span style={labelText}>Enzymes</span>
            <input value={enzymeText} onChange={e => setEnzymeText(e.target.value)} list="wb-enzymes" className="input-control" style={{ ...input, width: 180 }} />
          </label>
          <datalist id="wb-enzymes">{Object.keys(ENZYMES).map(e => <option key={e} value={e} />)}</datalist>
          <button className="btn btn-primary" style={btn} onClick={digest} disabled={!source || namedEnzymes.found.length === 0}>
            <Scissors size={14} /> Digest
          </button>
          <button className="btn btn-secondary" style={btn} onClick={addWhole} disabled={!source}>Add whole, blunt</button>
        </div>
        {namedEnzymes.unknown.length > 0 && (
          <div style={{ fontSize: '0.78rem', color: '#a3560a', marginTop: '0.4rem' }}>Not an enzyme here: {namedEnzymes.unknown.join(', ')}</div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.75rem' }}>
          <label style={label}>
            <span style={labelText}>Top oligo 5′→3′</span>
            <input value={topOligo} onChange={e => setTopOligo(e.target.value.toUpperCase())} className="input-control" style={{ ...input, width: 240, fontFamily: 'monospace' }} placeholder="AATTCGGATCCG" />
          </label>
          <label style={label}>
            <span style={labelText}>Bottom oligo 5′→3′</span>
            <input value={bottomOligo} onChange={e => setBottomOligo(e.target.value.toUpperCase())} className="input-control" style={{ ...input, width: 240, fontFamily: 'monospace' }} placeholder="GATCCGGATCCG" />
          </label>
          <button className="btn btn-secondary" style={btn} onClick={addOligos} disabled={!topOligo || !bottomOligo}>Anneal oligos</button>
        </div>
        {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.5rem' }}>{error}</div>}
      </section>

      <section className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>On the bench ({bench.length})</h2>
        {bench.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Nothing yet. Digest a sequence, or anneal two oligos.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>{['', 'Fragment', 'Length', "5′ end", "3′ end", 'Phosphates', 'Treat', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--glass-border)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {bench.map(item => (
                <tr key={item.key} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td style={cell}>
                    <input type="checkbox" checked={picked.includes(item.key)}
                      onChange={e => setPicked(p => e.target.checked ? [...p, item.key] : p.filter(k => k !== item.key))} />
                  </td>
                  <td style={cell}>
                    <div style={{ fontWeight: 600 }}>{item.fragment.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.history.join(' · ')}</div>
                  </td>
                  <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{item.fragment.seq.length.toLocaleString()} bp</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{endLabel(item.fragment.left.type, item.fragment.left.overhang)}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{endLabel(item.fragment.right.type, item.fragment.right.overhang)}</td>
                  <td style={cell}>{item.fragment.phosphate.left || item.fragment.phosphate.right ? 'yes' : <span style={{ color: '#a3560a' }}>none</span>}</td>
                  <td style={cell}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary" style={tiny} onClick={() => apply(item.key, 'blunt')}>Blunt</button>
                      <button className="btn btn-secondary" style={tiny} onClick={() => apply(item.key, 'dephos')}>CIP</button>
                      <button className="btn btn-secondary" style={tiny} onClick={() => apply(item.key, 'phos')}>PNK</button>
                    </div>
                  </td>
                  <td style={cell}>
                    <button onClick={() => { setBench(p => p.filter(b => b.key !== item.key)); setPicked(p => p.filter(k => k !== item.key)); }}
                      title="Take it off the bench" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>Ligate ({chosen.length} selected)</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.82rem', marginBottom: '0.6rem' }}>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input type="checkbox" checked={circular} onChange={e => setCircular(e.target.checked)} /> close into a circle
          </label>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input type="checkbox" checked={allowBlunt} onChange={e => setAllowBlunt(e.target.checked)} /> allow blunt joins
          </label>
        </div>

        {chosen.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Tick the fragments to ligate.</p>}
        {ligationNotes.map(n => <div key={n} style={{ fontSize: '0.8rem', color: '#a3560a' }}>⚠ {n}</div>)}
        {ligationNotes.length > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            No product while these ends cannot be joined. Treat the fragments, or pick different ones.
          </div>
        )}
        {result?.problems.map((p, i) => <div key={i} style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{p.message}</div>)}

        {product && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              {product.sequence.length.toLocaleString()} bp · {product.topology}
              {carried && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {carried.features.length} feature{carried.features.length === 1 ? '' : 's'} carried</span>}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.3rem 0' }}>
              {product.order.map(o => `${o.name}${o.flipped ? ' (flipped)' : ''}`).join(' → ')}
            </div>
            {result && result.assemblies.length > 1 && (
              <div style={{ fontSize: '0.8rem', color: '#b91c1c' }}>
                These fragments go together {result?.assemblies.length} different ways. Screen colonies, or use ends that fit only one way.
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name the construct" className="input-control" style={{ ...input, width: 220 }} />
              <button className="btn btn-primary" style={btn} onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save to the library'}</button>
              {saved && <a href={`/sequences/${saved}`} style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>Saved. Open it →</a>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };
const labelText: React.CSSProperties = { fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' };
const input: React.CSSProperties = { padding: '0.4rem 0.55rem', fontSize: '0.84rem' };
const btn: React.CSSProperties = { fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' };
const tiny: React.CSSProperties = { fontSize: '0.72rem', padding: '0.15rem 0.45rem' };
const cell: React.CSSProperties = { padding: '0.4rem 0.5rem', verticalAlign: 'top' };
export const WorkbenchIcon = FlaskConical;
