'use client';
import { useState, useMemo } from 'react';
import {
  ENZYMES,
  digestLinear, digestCircular,
  findInsertFragment, findVectorBackbone,
  areEndsCompatible, designPrimers,
} from '@/lib/restrictionEnzymes';
import { fragmentOf } from '@/lib/assembly';
import { assembleByHomology, type OverlapMethod } from '@/lib/homology-cloning';
import { goldenGate } from '@/lib/golden-gate';
import { ConstructPanel, ProblemList, type JunctionRow } from './cloning/AssemblyResult';
import MultiLaneGel from './MultiLaneGel';
import PlasmidMap from './PlasmidMap';
import Link from 'next/link';

type SeqRecord = {
  id: string;
  name: string;
  type: string;
  sequence: string;
  size: number;
  description: string | null;
};

type CloningMethod = 'restriction' | 'golden-gate' | 'gateway' | 'infusion' | 'ta' | 'gibson';

const STEP_LABELS = ['Select Sequences', 'Choose Enzymes', 'Digest Analysis', 'Cloning Protocol'];
const ENZYME_NAMES = Object.keys(ENZYMES);

// Golden Gate type IIS enzymes (cut outside recognition site)
const GOLDEN_GATE_ENZYMES = ['BsaI', 'BsmBI', 'BbsI', 'SapI', 'BtgZI'];

// ─── Method selector ─────────────────────────────────────────────────────────

const METHODS: { id: CloningMethod; label: string; icon: string; desc: string }[] = [
  { id: 'restriction', label: 'Restriction Cloning', icon: '✂️', desc: 'Classic restriction enzyme + ligation' },
  { id: 'golden-gate', label: 'Golden Gate',         icon: '🔩', desc: 'Type IIS enzyme one-pot assembly' },
  { id: 'infusion',    label: 'In-Fusion®',          icon: '🔀', desc: '15 bp overlap seamless cloning' },
  { id: 'gateway',     label: 'Gateway®',            icon: '🚪', desc: 'att-site recombination cloning' },
  { id: 'gibson',      label: 'Gibson Assembly',     icon: '🧩', desc: 'Exonuclease-based multi-fragment' },
  { id: 'ta',          label: 'TA / GC Cloning',     icon: '🔗', desc: 'PCR product direct cloning' },
];

// ─── Main Wizard ────────────────────────────────────────────────────────────

export default function CloningWizard({ sequences }: { sequences: SeqRecord[] }) {
  const [method, setMethod] = useState<CloningMethod>('restriction');
  const genes = sequences.filter(s => s.type === 'gene');
  const plasmids = sequences.filter(s => s.type === 'plasmid');

  const [currentStep, setCurrentStep] = useState(0);
  const [geneId, setGeneId] = useState(genes[0]?.id ?? '');
  const [vectorId, setVectorId] = useState(plasmids[0]?.id ?? '');
  const [enzyme1, setEnzyme1] = useState('EcoRI');
  const [enzyme2, setEnzyme2] = useState('BamHI');
  const [useTwoEnzymes, setUseTwoEnzymes] = useState(true);

  const gene = sequences.find(s => s.id === geneId);
  const vector = sequences.find(s => s.id === vectorId);

  // ── Analysis (memoized) ──────────────────────────────────────────────────
  const analysis = useMemo(() => {
    if (!gene || !vector) return null;
    const enzymes = useTwoEnzymes && enzyme2 ? [enzyme1, enzyme2] : [enzyme1];
    const e2 = useTwoEnzymes ? enzyme2 : undefined;

    const geneDigest = digestLinear(gene.sequence, enzymes);
    const vectorDigest = digestCircular(vector.sequence, enzymes);

    const insertFrag = findInsertFragment(geneDigest, enzyme1, e2);
    const backboneFrag = findVectorBackbone(vectorDigest);

    const geneHasE1 = geneDigest.cutSites.some(c => c.enzyme === enzyme1);
    const geneHasE2 = !e2 || geneDigest.cutSites.some(c => c.enzyme === e2);
    const vectorHasE1 = vectorDigest.cutSites.some(c => c.enzyme === enzyme1);
    const vectorHasE2 = !e2 || vectorDigest.cutSites.some(c => c.enzyme === e2);

    const compatible = geneHasE1 && geneHasE2 && vectorHasE1 && vectorHasE2;
    const isDirectional = !!(e2 && enzyme1 !== enzyme2 && !areEndsCompatible(enzyme1, enzyme2));

    const issues: string[] = [];
    if (!geneHasE1) issues.push(`${enzyme1} site not found in ${gene.name}`);
    if (e2 && !geneHasE2) issues.push(`${e2} site not found in ${gene.name}`);
    if (!vectorHasE1) issues.push(`${enzyme1} site not found in ${vector.name}`);
    if (e2 && !vectorHasE2) issues.push(`${e2} site not found in ${vector.name}`);

    const finalSize = insertFrag && backboneFrag ? insertFrag.size + backboneFrag.size : 0;
    const needsPrimers = !geneHasE1 || (!!e2 && !geneHasE2);
    const primers = needsPrimers ? designPrimers(gene.sequence, enzyme1, e2) : null;

    return { geneDigest, vectorDigest, insertFrag, backboneFrag, compatible, isDirectional, issues, finalSize, enzymes, needsPrimers, primers };
  }, [gene, vector, enzyme1, enzyme2, useTwoEnzymes]);

  // ── Protocol generation (memoized) ────────────────────────────────────────
  const protocol = useMemo(() => {
    if (!analysis?.compatible || !gene || !vector || !analysis.insertFrag || !analysis.backboneFrag) return null;
    const { insertFrag, backboneFrag, enzymes, isDirectional } = analysis;
    const enzymeStr = enzymes.join(' + ');
    const insertMass = Math.round(3 * (insertFrag.size / backboneFrag.size) * 50);

    return [
      {
        icon: '✂️',
        title: `Step 1 — Digest the Insert (${gene.name})`,
        details: [
          `Gene template: 500 ng  ·  ${gene.name}, ${gene.size} bp`,
          ...enzymes.map(e => `${e} (NEB): 1 µL`),
          `10× CutSmart Buffer: 5 µL`,
          `Nuclease-free H₂O: top up to 50 µL`,
          `→ Incubate 37°C · 1 hour`,
          `→ Heat inactivate 65°C · 20 min`,
          `✓ Expected insert band: ~${insertFrag.size} bp`,
        ],
      },
      {
        icon: '✂️',
        title: `Step 2 — Digest the Vector (${vector.name})`,
        details: [
          `Vector: 500 ng  ·  ${vector.name}, ${vector.size} bp circular`,
          ...enzymes.map(e => `${e} (NEB): 1 µL`),
          `10× CutSmart Buffer: 5 µL`,
          `Nuclease-free H₂O: top up to 50 µL`,
          `→ Incubate 37°C · 1 hour`,
          `→ Heat inactivate 65°C · 20 min`,
          `✓ Expected backbone band: ~${backboneFrag.size} bp`,
        ],
      },
      {
        icon: '🧫',
        title: 'Step 3 — Gel Purification',
        details: [
          `Run both digests on 1% agarose gel  ·  100 V · 30–45 min`,
          `Excise the ${insertFrag.size} bp insert band from lane 1`,
          `Excise the ${backboneFrag.size} bp backbone band from lane 2`,
          `Purify with QIAquick Gel Extraction Kit (Qiagen)`,
          `Elute in 30 µL EB buffer (10 mM Tris-HCl pH 8.5)`,
          `Measure concentration by NanoDrop or gel comparison`,
        ],
      },
      {
        icon: '🔗',
        title: 'Step 4 — Ligation',
        details: [
          `3 : 1 molar ratio  (insert : vector)`,
          `Vector: 50 ng`,
          `Insert: ~${insertMass} ng  (3:1 molar ratio for ${insertFrag.size} bp / ${backboneFrag.size} bp)`,
          `T4 DNA Ligase (NEB M0202): 1 µL`,
          `10× T4 DNA Ligase Buffer: 2 µL`,
          `Nuclease-free H₂O: top up to 20 µL`,
          isDirectional
            ? `✓ Directional cloning — insert enters in one orientation only`
            : `⚠️ Single enzyme / compatible ends — screen extra colonies for correct orientation`,
          `Incubate 16°C overnight  OR  25°C for 10 min (Quick Ligase)`,
        ],
      },
      {
        icon: '🦠',
        title: 'Step 5 — Transformation',
        details: [
          `Add 2–5 µL ligation mix to 50 µL competent E. coli (DH5α or XL1-Blue)`,
          `Heat shock: 42°C · 30 s → immediately on ice · 2 min`,
          `Add 950 µL SOC medium`,
          `Recover: 37°C · 1 hour · 200 rpm shaking`,
          `Plate on LB agar + appropriate antibiotic selection`,
          `Incubate 37°C overnight`,
        ],
      },
      {
        icon: '🔬',
        title: 'Step 6 — Colony Screening & Verification',
        details: [
          `Pick 8–16 colonies for screening`,
          `Colony PCR with insert-specific or vector-flanking primers (T7, M13, SP6)`,
          `Expected positive band: ~${insertFrag.size} bp`,
          `Miniprep positive clones`,
          `Diagnostic digest with ${enzymeStr} → expected: ${insertFrag.size} bp + ${backboneFrag.size} bp`,
          `Send for Sanger sequencing to confirm the insert`,
        ],
      },
    ];
  }, [analysis, gene, vector]);

  // ── Guard: no sequences ─────────────────────────────────────────────────
  if (genes.length === 0 || plasmids.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
        <h2 style={{ marginBottom: '0.5rem' }}>Not enough sequences</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          You need at least <strong>one gene</strong> and <strong>one plasmid</strong> in your library.
          {genes.length === 0 && ' No gene sequences found.'}{plasmids.length === 0 && ' No plasmid sequences found.'}
        </p>
        <Link href="/sequences/new" className="btn btn-primary">+ Add Sequence</Link>
      </div>
    );
  }

  // ── Enzyme cut-site preview (used in step 1) ────────────────────────────
  const livePreview = (seq: SeqRecord) => {
    const enzymes = useTwoEnzymes ? [enzyme1, enzyme2] : [enzyme1];
    const digest = seq.type === 'gene' ? digestLinear(seq.sequence, enzymes) : digestCircular(seq.sequence, enzymes);
    return digest.cutSites;
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Method selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem', marginBottom: '1.75rem' }}>
        {METHODS.map(m => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            style={{
              padding: '0.75rem 1rem', borderRadius: '10px', textAlign: 'left', cursor: 'pointer',
              border: `2px solid ${method === m.id ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
              background: method === m.id ? 'var(--accent-blue-15)' : 'white',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: '1.1rem', marginBottom: '0.2rem' }}>{m.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: method === m.id ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{m.label}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{m.desc}</div>
          </button>
        ))}
      </div>

      {/* Non-restriction methods: show their own UI */}
      {method === 'golden-gate' && <GoldenGatePanel sequences={sequences} />}
      {method === 'infusion'    && <InFusionPanel   sequences={sequences} />}
      {method === 'gateway'     && <GatewayPanel    sequences={sequences} />}
      {method === 'gibson'      && <GibsonPanel     sequences={sequences} />}
      {method === 'ta'          && <TAPanel         sequences={sequences} />}

      {/* Restriction cloning: existing wizard */}
      {method === 'restriction' && <>
      {/* Step indicator */}
      <StepIndicator steps={STEP_LABELS} currentStep={currentStep} />

      {/* ── Step 0: Select Sequences ── */}
      {currentStep === 0 && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>Select Your Sequences</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Choose the gene to insert and the destination vector.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
            {/* Gene */}
            <SeqPicker
              label="Gene Insert"
              accent="var(--accent-green)"
              badge="G"
              options={genes}
              value={geneId}
              onChange={setGeneId}
              selected={gene ?? null}
            />
            {/* Vector */}
            <SeqPicker
              label="Destination Vector"
              accent="var(--accent-blue)"
              badge="V"
              options={plasmids}
              value={vectorId}
              onChange={setVectorId}
              selected={vector ?? null}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => setCurrentStep(1)} disabled={!gene || !vector}>
              Choose Enzymes →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 1: Choose Enzymes ── */}
      {currentStep === 1 && gene && vector && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>Choose Restriction Enzymes</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Using two different enzymes enables directional cloning.
          </p>

          {/* Enzyme selectors */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1.25rem', alignItems: 'end', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>5′ Enzyme</label>
              <select value={enzyme1} onChange={e => setEnzyme1(e.target.value)} className="input-control" style={{ background: 'white', padding: '0.75rem', fontSize: '0.95rem' }}>
                {ENZYME_NAMES.map(e => <option key={e} value={e}>{e} — {ENZYMES[e].pattern}</option>)}
              </select>
            </div>

            <button
              onClick={() => setUseTwoEnzymes(!useTwoEnzymes)}
              style={{ padding: '0.5rem 0.9rem', borderRadius: '8px', border: `1px solid ${useTwoEnzymes ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: useTwoEnzymes ? 'var(--accent-blue-15)' : 'white', color: useTwoEnzymes ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', marginBottom: '0.05rem' }}
            >
              {useTwoEnzymes ? '2 enzymes ✓' : '+ add 2nd'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: useTwoEnzymes ? 1 : 0.4 }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>3′ Enzyme</label>
              <select value={enzyme2} onChange={e => setEnzyme2(e.target.value)} disabled={!useTwoEnzymes} className="input-control" style={{ background: 'white', padding: '0.75rem', fontSize: '0.95rem' }}>
                {ENZYME_NAMES.map(e => <option key={e} value={e}>{e} — {ENZYMES[e].pattern}</option>)}
              </select>
            </div>
          </div>

          {/* Live cut-site preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            {[gene, vector].map(seq => {
              const sites = livePreview(seq);
              const accent = seq.type === 'gene' ? 'var(--accent-green)' : 'var(--accent-blue)';
              return (
                <div key={seq.id} style={{ padding: '1rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: accent, marginBottom: '0.75rem' }}>
                    {seq.name} ({seq.type})
                  </div>
                  {sites.length === 0
                    ? <div style={{ fontSize: '0.8rem', color: 'var(--accent-red)' }}>⚠️ No cut sites found</div>
                    : sites.map((cs, i) => (
                        <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                          ✂️ <strong>{cs.enzyme}</strong> at position <strong>{cs.position}</strong>
                        </div>
                      ))}
                </div>
              );
            })}
          </div>

          {/* Directional info banner */}
          {useTwoEnzymes && enzyme1 !== enzyme2 ? (
            <InfoBanner color="green" text="Directional cloning: insert can only enter in one orientation — no need to screen for reverse inserts." />
          ) : (
            <InfoBanner color="orange" text="Single enzyme or same enzyme: insert may enter in both orientations. Screen more colonies and verify by sequencing." />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(0)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setCurrentStep(2)}>Analyze →</button>
          </div>
        </div>
      )}

      {/* ── Step 2: Digest Analysis ── */}
      {currentStep === 2 && analysis && gene && vector && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Compatibility header */}
          <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${analysis.compatible ? 'var(--accent-green)' : 'var(--accent-red)'}` }}>
            {analysis.compatible ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>✅</span>
                  <h2 style={{ fontSize: '1.15rem', color: 'var(--accent-green)' }}>Compatible — Cloning is possible!</h2>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  All enzyme sites found in both sequences.{' '}
                  {analysis.isDirectional ? 'Directional cloning guaranteed.' : 'Note: bidirectional insertion possible — screen colonies.'}
                  {analysis.finalSize > 0 && ` Final construct: ~${analysis.finalSize.toLocaleString()} bp.`}
                </p>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>❌</span>
                  <h2 style={{ fontSize: '1.15rem', color: 'var(--accent-red)' }}>Incompatible — Sites Missing</h2>
                </div>
                {analysis.issues.map((issue, i) => (
                  <p key={i} style={{ color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '0.2rem' }}>• {issue}</p>
                ))}
                {analysis.needsPrimers && analysis.primers && (
                  <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(37,99,235,0.05)', borderRadius: '8px', border: '1px solid rgba(37,99,235,0.2)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent-blue)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                      💡 Fix: Add sites via PCR primers
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      Design these primers to amplify your gene with the restriction sites added:
                    </p>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ padding: '0.5rem 0.75rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)', wordBreak: 'break-all' }}>
                        <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>Fwd: </span>{analysis.primers.forward}
                      </div>
                      <div style={{ padding: '0.5rem 0.75rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)', wordBreak: 'break-all' }}>
                        <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>Rev: </span>{analysis.primers.reverse}
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{analysis.primers.note}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Gene digest */}
          <DigestPanel
            title={`Gene Digest — ${gene.name}`}
            accent="var(--accent-green)"
            enzymes={analysis.enzymes}
            digest={analysis.geneDigest}
            highlightFrag={analysis.insertFrag}
            highlightLabel="INSERT"
            laneColor="#22c55e"
            laneName={gene.name}
          />

          {/* Vector digest */}
          <DigestPanel
            title={`Vector Digest — ${vector.name}`}
            accent="var(--accent-blue)"
            enzymes={analysis.enzymes}
            digest={analysis.vectorDigest}
            highlightFrag={analysis.backboneFrag}
            highlightLabel="BACKBONE"
            laneColor="#3b82f6"
            laneName={vector.name}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setCurrentStep(3)} disabled={!analysis.compatible}>
              View Protocol →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Protocol + Final Construct ── */}
      {currentStep === 3 && protocol && analysis && gene && vector && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Protocol */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>Cloning Protocol</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Insert <strong>{gene.name}</strong> ({analysis.insertFrag?.size} bp) → <strong>{vector.name}</strong> using {analysis.enzymes.join(' + ')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {protocol.map((step, i) => <ProtocolStep key={i} step={step} />)}
            </div>
          </div>

          {/* Final construct */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Final Construct</h2>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Plasmid map */}
              <PlasmidMap
                name={`${gene.name} in ${vector.name}`}
                totalBp={analysis.finalSize}
                title="Expected Final Construct"
                cuts={analysis.vectorDigest.cutSites.map(cs => ({
                  enzyme: cs.enzyme,
                  position: Math.round(cs.position * analysis.finalSize / vector.size),
                }))}
                features={analysis.insertFrag ? [{
                  label: gene.name,
                  startBp: analysis.backboneFrag ? analysis.finalSize - analysis.insertFrag.size : 0,
                  endBp: analysis.finalSize,
                  color: '#22c55e',
                }] : []}
              />

              {/* Stats + verification gel */}
              <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <StatCard label="Final Construct Size" value={`${analysis.finalSize.toLocaleString()} bp`} color="var(--accent-blue)" />
                <StatCard label="Insert" value={`${analysis.insertFrag?.size} bp`} sub={gene.name} color="var(--accent-green)" />
                <StatCard label="Vector Backbone" value={`${analysis.backboneFrag?.size} bp`} sub={vector.name} color="var(--accent-blue)" />

                <div style={{ padding: '1rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    Verification Digest (after miniprep)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    Digest with <strong>{analysis.enzymes.join(' + ')}</strong> — expected bands:
                  </div>
                  <MultiLaneGel
                    compact
                    lanes={[{
                      label: 'Diagnostic',
                      color: '#a855f7',
                      bands: [
                        { size: analysis.insertFrag?.size ?? 0, highlight: true, label: 'insert' },
                        { size: analysis.backboneFrag?.size ?? 0, highlight: false, label: 'backbone' },
                      ],
                    }]}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setCurrentStep(2)}>← Back to Analysis</button>
            <button className="btn btn-secondary" onClick={() => { setCurrentStep(0); }}>Start New Cloning</button>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

// ─── Golden Gate Panel ────────────────────────────────────────────────────────

function GoldenGatePanel({ sequences }: { sequences: SeqRecord[] }) {
  const [enzyme, setEnzyme] = useState('BsaI');
  const [picked, setPicked] = useState<string[]>([]);
  const [newFrag, setNewFrag] = useState('');
  const accent = '#0e7c66';

  const chosen = picked.map(id => sequences.find(s => s.id === id)).filter(Boolean) as SeqRecord[];

  const result = useMemo(() => {
    if (chosen.length < 2) return null;
    try {
      return goldenGate(
        chosen.map(s => ({ name: s.name, sequence: s.sequence, circular: s.type === 'plasmid' })),
        enzyme,
      );
    } catch {
      return null;
    }
  }, [chosen, enzyme]);

  const junctions: JunctionRow[] = result?.assemblies[0]?.junctions.map(j => ({
    from: j.from, to: j.to, shared: j.shared, detail: `${j.shared.length} nt overhang`,
  })) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${accent}` }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>🔩 Golden Gate</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0 }}>
          A Type IIS enzyme cuts outside its own site, so the overhang is whatever you put there.
          Parts join in one defined order and the sites end up on the pieces you throw away.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select value={enzyme} onChange={e => setEnzyme(e.target.value)} className="input-control" style={{ fontSize: '0.85rem', padding: '0.5rem' }}>
            {GOLDEN_GATE_ENZYMES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={newFrag} onChange={e => setNewFrag(e.target.value)} className="input-control" style={{ flex: 1, minWidth: 180, padding: '0.5rem', fontSize: '0.85rem' }}>
            <option value="">— select part —</option>
            {sequences.filter(s => !picked.includes(s.id)).map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.size} bp)</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => { if (newFrag) { setPicked(p => [...p, newFrag]); setNewFrag(''); } }} disabled={!newFrag} style={{ fontSize: '0.82rem' }}>+ Add</button>
        </div>

        {picked.map((id, i) => {
          const s = sequences.find(x => x.id === id);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.45rem 0.75rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: accent, background: `${accent}18`, padding: '0.1rem 0.35rem', borderRadius: '3px', fontWeight: 700 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem' }}>{s?.name ?? id}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s?.size} bp</span>
              <button onClick={() => setPicked(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>
          );
        })}

        {picked.length < 2 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            Add at least two parts. Each needs {enzyme} sites arranged so that cutting releases it
            without them — the pieces that keep a site are the ones discarded.
          </p>
        )}

        {result && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
            <span><span style={{ color: 'var(--text-muted)' }}>Released </span>{result.parts.length}</span>
            <span><span style={{ color: 'var(--text-muted)' }}>Discarded </span>{result.discarded.length}</span>
            {result.overhangs.length > 0 && (
              <span style={{ fontFamily: 'monospace' }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Overhangs </span>
                {result.overhangs.join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>

      {result && result.overhangIssues.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.05)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#a3560a', marginBottom: '0.5rem' }}>
            Overhang set
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {result.overhangIssues.map((i, k) => (
              <li key={k} style={{ fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {result && <ProblemList problems={result.problems} />}

      {result?.assemblies[0] && (
        <ConstructPanel
          assembly={result.assemblies[0]}
          junctions={junctions}
          method={`Golden Gate (${enzyme})`}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─── In-Fusion Panel ──────────────────────────────────────────────────────────

function InFusionPanel({ sequences }: { sequences: SeqRecord[] }) {
  return <HomologyPanel sequences={sequences} method="infusion" accent="#a855f7" icon="🔀"
    blurb="Seamless ligation-independent cloning. The In-Fusion enzyme fuses fragments through 15 bp of shared sequence at the ends that meet — no restriction sites needed." />;
}

// ─── Gateway Panel ────────────────────────────────────────────────────────────

function GatewayPanel({ sequences }: { sequences: SeqRecord[] }) {
  const [insertId, setInsertId] = useState('');
  const [reaction, setReaction] = useState<'BP' | 'LR'>('BP');
  const insert = sequences.find(s => s.id === insertId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #a855f7' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>🚪 Gateway® Cloning</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Invitrogen Gateway technology uses site-specific recombination between att sites. A BP reaction moves your insert from a PCR product (with attB sites) into a donor vector (attP) to create an entry clone. An LR reaction transfers from an entry clone (attL) to a destination vector (attR).
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {(['BP', 'LR'] as const).map(r => (
            <button key={r} onClick={() => setReaction(r)} style={{ padding: '0.45rem 1.1rem', borderRadius: '8px', border: `2px solid ${reaction === r ? '#a855f7' : 'var(--glass-border)'}`, background: reaction === r ? '#a855f715' : 'white', color: reaction === r ? '#a855f7' : 'var(--text-muted)', cursor: 'pointer', fontWeight: reaction === r ? 700 : 400, fontFamily: 'inherit', fontSize: '0.88rem' }}>
              {r} Reaction
            </button>
          ))}
        </div>

        <SeqSelect label="Insert sequence" sequences={sequences} value={insertId} onChange={setInsertId} accent="#a855f7" />

        {insert && (
          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {(reaction === 'BP' ? [
              { icon: '🧬', title: 'Generate attB PCR product', details: [`Add attB1: GGGGACAAGTTTGTACAAAAAAGCAGGCT to 5′ of forward primer`, `Add attB2: GGGGACCACTTTGTACAAGAAAGCTGGGT to 5′ of reverse primer`, `PCR amplify ${insert.name} with attB-tailed primers`, 'Confirm band by gel electrophoresis'] },
              { icon: '🔄', title: 'BP Clonase™ reaction', details: ['attB PCR product: 10–150 ng', 'Donor vector (pDONR™): 150 ng', 'BP Clonase™ II enzyme mix: 2 µL', 'TE buffer (pH 8.0) to 10 µL', '→ 25°C overnight (16 h) or 1 h for most constructs', '→ Add 1 µL Proteinase K, 37°C 10 min'] },
              { icon: '🦠', title: 'Transform & select entry clone', details: ['Transform 1 µL into ccdB-sensitive cells (DH5α)', 'Plate on LB + kanamycin (pDONR221 uses KanR)', 'Screen by colony PCR or miniprep + digest', `Entry clone: attL1–${insert.name}–attL2`] },
            ] : [
              { icon: '🔀', title: 'LR Clonase™ reaction', details: ['Entry clone (attL): 50–150 ng', 'Destination vector (attR): 150 ng', 'LR Clonase™ II enzyme mix: 2 µL', 'TE buffer (pH 8.0) to 10 µL', '→ 25°C overnight (16 h)', '→ Add 1 µL Proteinase K, 37°C 10 min'] },
              { icon: '🦠', title: 'Transform expression host', details: ['Transform 1 µL into appropriate E. coli strain', 'Plate on LB + dest-vector antibiotic (usually AmpR)', 'Negative selection by ccdB gene in destination backbone', `Expression clone: attB1–${insert.name}–attB2 in dest vector`] },
            ]).map((s, i) => <ProtocolStep key={i} step={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Gibson Assembly Panel ───────────────────────────────────────────────────

function GibsonPanel({ sequences }: { sequences: SeqRecord[] }) {
  return <HomologyPanel sequences={sequences} method="gibson" accent="#06b6d4" icon="🧩"
    blurb="Isothermal multi-fragment assembly. Each fragment shares homology with its neighbour; the enzyme mix chews back, anneals and repairs in one 50 °C reaction." />;
}

/**
 * Gibson, In-Fusion and NEBuilder share a panel because they share a mechanism.
 * What differs is how much homology each wants, which the module knows.
 */
function HomologyPanel({ sequences, method, accent, icon, blurb }: {
  sequences: SeqRecord[]; method: OverlapMethod; accent: string; icon: string; blurb: string;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [newFrag, setNewFrag] = useState('');
  const [topology, setTopology] = useState<'circular' | 'linear'>('circular');

  const chosen = picked.map(id => sequences.find(s => s.id === id)).filter(Boolean) as SeqRecord[];

  const result = useMemo(() => {
    if (chosen.length < 2) return null;
    try {
      return assembleByHomology(
        chosen.map(s => fragmentOf(s.id, s.name, s.sequence)),
        method,
        { topology },
      );
    } catch {
      return null;
    }
  }, [chosen, method, topology]);

  const junctions: JunctionRow[] = result?.checks.map(c => ({
    from: c.from, to: c.to, shared: c.overlap,
    detail: `${c.length} bp · Tm ${c.tm.toFixed(0)} °C · GC ${Math.round(c.gc * 100)}%`,
    warnings: c.warnings,
  })) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: `4px solid ${accent}` }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{icon} {result?.spec.name ?? method}</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0 }}>{blurb}</p>
        {result && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{result.spec.note}</p>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select value={newFrag} onChange={e => setNewFrag(e.target.value)} className="input-control" style={{ flex: 1, minWidth: 180, padding: '0.5rem', fontSize: '0.85rem' }}>
            <option value="">— select fragment —</option>
            {sequences.filter(s => !picked.includes(s.id)).map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.size} bp)</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => { if (newFrag) { setPicked(p => [...p, newFrag]); setNewFrag(''); } }} disabled={!newFrag} style={{ fontSize: '0.82rem' }}>+ Add</button>
          <select value={topology} onChange={e => setTopology(e.target.value as 'circular' | 'linear')} className="input-control" style={{ fontSize: '0.82rem', padding: '0.5rem' }}>
            <option value="circular">Circular product</option>
            <option value="linear">Linear product</option>
          </select>
        </div>

        {picked.map((id, i) => {
          const s = sequences.find(x => x.id === id);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.45rem 0.75rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: accent, background: `${accent}18`, padding: '0.1rem 0.35rem', borderRadius: '3px', fontWeight: 700 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem' }}>{s?.name ?? id}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s?.size} bp</span>
              <button onClick={() => setPicked(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>
          );
        })}

        {picked.length < 2 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            Add at least two fragments. They need shared sequence at the ends that should meet —
            the homology is found, not assumed.
          </p>
        )}
      </div>

      {result && <ProblemList problems={result.problems} />}

      {result?.assemblies[0] && (
        <ConstructPanel
          assembly={result.assemblies[0]}
          junctions={junctions}
          method={result.spec.name}
          accent={accent}
        />
      )}
    </div>
  );
}

// ─── TA / GC Cloning Panel ────────────────────────────────────────────────────

function TAPanel({ sequences }: { sequences: SeqRecord[] }) {
  const [insertId, setInsertId] = useState('');
  const [type, setType] = useState<'TA' | 'GC'>('TA');
  const insert = sequences.find(s => s.id === insertId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #f97316' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>🔗 TA / GC Cloning</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Direct cloning of PCR products. Taq polymerase adds a 3′ A-overhang (TA cloning) or GC extensions (GC cloning) that pair with the linearised vector. No restriction enzymes needed.
        </p>
      </div>
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {(['TA', 'GC'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} style={{ padding: '0.45rem 1.1rem', borderRadius: '8px', border: `2px solid ${type === t ? '#f97316' : 'var(--glass-border)'}`, background: type === t ? '#f9731615' : 'white', color: type === t ? '#f97316' : 'var(--text-muted)', cursor: 'pointer', fontWeight: type === t ? 700 : 400, fontFamily: 'inherit', fontSize: '0.88rem' }}>
              {t} Cloning
            </button>
          ))}
        </div>
        <SeqSelect label="PCR Insert" sequences={sequences} value={insertId} onChange={setInsertId} accent="#f97316" />
        {insert && (
          <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {(type === 'TA' ? [
              { icon: '🔬', title: 'Generate A-tailed PCR product', details: [`Amplify ${insert.name} with Taq polymerase (adds 3′ A)`, 'Do NOT use proofreading polymerase (removes A-tail)', 'Run on gel — confirm single band'] },
              { icon: '🔗', title: 'TA Ligation', details: ['Fresh PCR product: 1–4 µL', 'pCR™2.1-TOPO® vector: 1 µL (or equivalent TA vector)', 'Salt solution: 1 µL', 'H₂O to 6 µL', '→ Mix gently. Incubate 5 min room temperature'] },
              { icon: '🦠', title: 'Transform One Shot® cells', details: ['Add 2 µL to competent cells. Ice 30 min. Heat shock 42°C 30 s.', 'Plate on LB + Amp + X-gal (blue-white screening)', 'White colonies = insert-containing plasmid', 'Screen by colony PCR or miniprep + digest'] },
            ] : [
              { icon: '🔬', title: 'Prepare blunt PCR product', details: [`Amplify ${insert.name} with proofreading polymerase`, 'GC cloning adds GC extensions to vector — blunt product required'] },
              { icon: '🔗', title: 'GC cloning reaction', details: ['PCR product: 1 µL', 'GC Cloning vector: 1 µL', 'Solution I (Mighty Mix or equivalent): 4 µL', '→ 16°C × 30 min'] },
              { icon: '🦠', title: 'Transform', details: ['Standard transformation into DH5α or equivalent', 'Colony PCR to verify insert size'] },
            ]).map((s, i) => <ProtocolStep key={i} step={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared SeqSelect ─────────────────────────────────────────────────────────

function SeqSelect({ label, sequences, value, onChange, accent }: { label: string; sequences: SeqRecord[]; value: string; onChange: (v: string) => void; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.88rem', borderLeft: `3px solid ${accent}` }}>
        <option value="">— select —</option>
        {sequences.map(s => <option key={s.id} value={s.id}>{s.name} ({s.size} bp)</option>)}
      </select>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div style={{ display: 'flex', marginBottom: '2rem', padding: '1.25rem 1.5rem', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      {steps.map((label, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
          {i > 0 && (
            <div style={{ position: 'absolute', top: 13, right: '50%', width: '100%', height: 2, background: i <= currentStep ? 'var(--accent-blue)' : 'var(--glass-border)', zIndex: 0 }} />
          )}
          <div style={{
            width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700, zIndex: 1,
            background: i < currentStep ? 'var(--accent-green)' : i === currentStep ? 'var(--accent-blue)' : 'var(--bg-primary)',
            color: i <= currentStep ? 'white' : 'var(--text-muted)',
            border: `2px solid ${i < currentStep ? 'var(--accent-green)' : i === currentStep ? 'var(--accent-blue)' : 'var(--glass-border)'}`,
          }}>
            {i < currentStep ? '✓' : i + 1}
          </div>
          <span style={{ fontSize: '0.72rem', color: i === currentStep ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: i === currentStep ? 600 : 400, textAlign: 'center' }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SeqPicker({ label, accent, badge, options, value, onChange, selected }: {
  label: string; accent: string; badge: string;
  options: SeqRecord[]; value: string; onChange: (id: string) => void; selected: SeqRecord | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ background: accent, color: 'white', width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700 }}>{badge}</span>
        {label}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input-control" style={{ background: 'white', padding: '0.75rem' }}>
        {options.map(s => <option key={s.id} value={s.id}>{s.name} ({s.size.toLocaleString()} bp)</option>)}
      </select>
      {selected && (
        <div style={{ padding: '0.75rem 1rem', background: `${accent}0d`, borderRadius: '8px', border: `1px solid ${accent}26` }}>
          <div style={{ fontSize: '0.8rem', color: accent, fontWeight: 600 }}>{selected.size.toLocaleString()} bp</div>
          {selected.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{selected.description}</div>}
          <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.4rem', wordBreak: 'break-all', maxHeight: 36, overflow: 'hidden' }}>
            {selected.sequence.substring(0, 100)}…
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBanner({ color, text }: { color: 'green' | 'orange'; text: string }) {
  const c = color === 'green' ? { bg: 'rgba(5,150,105,0.07)', border: 'rgba(5,150,105,0.2)', text: 'var(--accent-green)', icon: '✓' } : { bg: 'rgba(217,119,6,0.07)', border: 'rgba(217,119,6,0.2)', text: 'var(--accent-orange)', icon: '⚠️' };
  return (
    <div style={{ padding: '0.75rem 1rem', background: c.bg, borderRadius: '8px', border: `1px solid ${c.border}`, fontSize: '0.85rem', color: c.text }}>
      {c.icon} {text}
    </div>
  );
}

function DigestPanel({ title, accent, enzymes, digest, highlightFrag, highlightLabel, laneColor, laneName }: {
  title: string; accent: string; enzymes: string[];
  digest: ReturnType<typeof digestLinear>;
  highlightFrag: ReturnType<typeof findInsertFragment>;
  highlightLabel: string; laneColor: string; laneName: string;
}) {
  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: accent }}>{title}</h3>
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <MultiLaneGel lanes={[{
          label: laneName,
          color: laneColor,
          bands: digest.fragments.map(f => ({
            size: f.size,
            highlight: !!(highlightFrag && f.size === highlightFrag.size),
            label: highlightFrag && f.size === highlightFrag.size ? highlightLabel : undefined,
          })),
        }]} />

        <div style={{ flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Cutting with <strong>{enzymes.join(' + ')}</strong>
          </div>
          {digest.fragments.length === 0
            ? <div style={{ fontSize: '0.85rem', color: 'var(--accent-red)' }}>No cut sites found</div>
            : digest.fragments.map((f, i) => {
                const isHighlight = !!(highlightFrag && f.size === highlightFrag.size);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', marginBottom: '0.4rem', borderRadius: '6px', background: isHighlight ? `${laneColor}14` : 'var(--bg-primary)', border: `1px solid ${isHighlight ? laneColor + '44' : 'var(--glass-border)'}` }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{f.size.toLocaleString()} bp</span>
                    {isHighlight && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: laneColor, background: `${laneColor}22`, padding: '0.15rem 0.5rem', borderRadius: '4px' }}>{highlightLabel} ✓</span>
                    )}
                  </div>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="glass-card" style={{ padding: '0.9rem 1rem' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function ProtocolStep({ step }: { step: { icon: string; title: string; details: string[] } }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ border: '1px solid var(--glass-border)', borderRadius: '10px', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: '0.9rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: open ? 'var(--accent-blue-15)' : 'var(--bg-primary)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          {step.icon} {step.title}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '1rem 1.25rem', background: 'white', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {step.details.map((line, i) => (
            <div key={i} style={{ fontSize: '0.85rem', color: line.startsWith('→') ? 'var(--accent-blue)' : line.startsWith('✓') ? 'var(--accent-green)' : line.startsWith('⚠️') ? 'var(--accent-orange)' : 'var(--text-secondary)', paddingLeft: line.startsWith('→') || line.startsWith('✓') || line.startsWith('⚠️') ? '0.25rem' : '0' }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
