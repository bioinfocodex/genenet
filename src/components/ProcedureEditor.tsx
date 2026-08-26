'use client';
import { useState, useTransition } from 'react';
import { createProcedure, updateProcedure } from '@/app/actions/procedures';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import Link from 'next/link';

const CATEGORIES = ['General', 'Microbiology', 'Molecular Biology', 'Cell Biology', 'Biochemistry', 'QA/QC', 'Genomics', 'Proteomics', 'Safety'];
const STATUSES   = ['Draft', 'Review', 'Approved'];

interface Step     { title: string; description: string; }
interface Material { name: string; quantity: string; unit: string; }

interface ProcedureData {
  id?: string;
  name?: string; description?: string; category?: string; status?: string;
  safetyNotes?: string; reviewer?: string; contributors?: string;
  steps?: Step[]; materials?: Material[]; equipment?: string[];
  changeLog?: string;
}

export default function ProcedureEditor({ initial = {}, cancelHref = '/procedures' }: { initial?: ProcedureData; cancelHref?: string }) {
  const isEdit = !!initial.id;
  const [, startTransition] = useTransition();

  const [name,         setName]         = useState(initial.name ?? '');
  const [description,  setDescription]  = useState(initial.description ?? '');
  const [category,     setCategory]     = useState(initial.category ?? 'Molecular Biology');
  const [status,       setStatus]       = useState(initial.status ?? 'Draft');
  const [safetyNotes,  setSafetyNotes]  = useState(initial.safetyNotes ?? '');
  const [reviewer,     setReviewer]     = useState(initial.reviewer ?? '');
  const [contributors, setContributors] = useState(initial.contributors ?? '');
  const [changeLog,    setChangeLog]    = useState('');
  const [activeTab,    setActiveTab]    = useState<'basic'|'steps'|'materials'|'safety'>('basic');

  const [steps, setSteps] = useState<Step[]>(
    initial.steps?.length ? initial.steps : [{ title: '', description: '' }]
  );
  const [materials, setMaterials] = useState<Material[]>(
    initial.materials?.length ? initial.materials : []
  );
  const [equipment, setEquipment] = useState<string[]>(
    initial.equipment?.length ? initial.equipment : []
  );
  const [newEquipment, setNewEquipment] = useState('');

  // ── Steps ────────────────────────────────────────────────────────────────
  const addStep = () => setSteps(s => [...s, { title: '', description: '' }]);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps(s => { const a = [...s]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; return a; });
  };
  const updateStep = (i: number, field: keyof Step, val: string) =>
    setSteps(s => s.map((step, idx) => idx === i ? { ...step, [field]: val } : step));

  // ── Materials ─────────────────────────────────────────────────────────────
  const addMaterial = () => setMaterials(m => [...m, { name: '', quantity: '', unit: '' }]);
  const removeMaterial = (i: number) => setMaterials(m => m.filter((_, idx) => idx !== i));
  const updateMaterial = (i: number, field: keyof Material, val: string) =>
    setMaterials(m => m.map((mat, idx) => idx === i ? { ...mat, [field]: val } : mat));

  // ── Equipment ─────────────────────────────────────────────────────────────
  const addEquipment = () => {
    if (!newEquipment.trim()) return;
    setEquipment(e => [...e, newEquipment.trim()]);
    setNewEquipment('');
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!name.trim()) { setActiveTab('basic'); return; }
    const payload = { name, description, category, status, safetyNotes, reviewer, contributors, changeLog, steps, materials, equipment: equipment.map(e => ({ name: e })) };
    const fd = new FormData();
    if (isEdit) fd.append('id', initial.id!);
    fd.append('data', JSON.stringify(payload));
    startTransition(() => { isEdit ? updateProcedure(fd) : createProcedure(fd); });
  };

  const tabs: [typeof activeTab, string][] = [['basic','Basic Info'],['steps','Steps'],['materials','Materials'],['safety','Safety & Review']];

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '0.6rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: `2px solid ${activeTab === t ? 'var(--accent-blue)' : 'transparent'}`, transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Basic Info ── */}
      {activeTab === 'basic' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <F label="Procedure Name *" required>
            <input value={name} onChange={e => setName(e.target.value)} className="input-control" placeholder="e.g. Plasmid DNA Extraction Protocol" />
          </F>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <F label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className="input-control" style={{ padding: '0.75rem' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
            <F label="Status">
              <select value={status} onChange={e => setStatus(e.target.value)} className="input-control" style={{ padding: '0.75rem' }}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
          </div>
          <F label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-control" rows={4} placeholder="Brief overview of what this procedure accomplishes..." style={{ resize: 'vertical' }} />
          </F>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <F label="Reviewer / Approver">
              <input value={reviewer} onChange={e => setReviewer(e.target.value)} className="input-control" placeholder="e.g. Dr. Smith" />
            </F>
            <F label="Contributors">
              <input value={contributors} onChange={e => setContributors(e.target.value)} className="input-control" placeholder="Comma-separated names" />
            </F>
          </div>
          {isEdit && (
            <F label="Change Log (required for updates)">
              <input value={changeLog} onChange={e => setChangeLog(e.target.value)} className="input-control" placeholder="e.g. Updated incubation temperature in Step 3" />
            </F>
          )}
        </div>
      )}

      {/* ── Steps ── */}
      {activeTab === 'steps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {steps.map((step, i) => (
            <div key={i} className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-blue)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                <input value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} className="input-control" placeholder="Step title" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.9rem', fontWeight: 600 }} />
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  {i > 0           && <IconBtn onClick={() => moveStep(i, -1)} title="Move up"><ChevronUp size={14} /></IconBtn>}
                  {i < steps.length - 1 && <IconBtn onClick={() => moveStep(i, 1)} title="Move down"><ChevronDown size={14} /></IconBtn>}
                  {steps.length > 1 && <IconBtn onClick={() => removeStep(i)} title="Remove" danger><Trash2 size={14} /></IconBtn>}
                </div>
              </div>
              <textarea value={step.description} onChange={e => updateStep(i, 'description', e.target.value)} className="input-control" rows={3} placeholder="Detailed instructions for this step..." style={{ width: '100%', resize: 'vertical', fontSize: '0.88rem' }} />
            </div>
          ))}
          <button onClick={addStep} className="btn btn-secondary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Add Step
          </button>
        </div>
      )}

      {/* ── Materials & Equipment ── */}
      {activeTab === 'materials' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Materials */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Required Materials</h3>
            {materials.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {['Material Name', 'Quantity', 'Unit', ''].map(h => (
                  <span key={h} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>
            )}
            {materials.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <input value={m.name} onChange={e => updateMaterial(i, 'name', e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} placeholder="e.g. Lysis Buffer" />
                <input value={m.quantity} onChange={e => updateMaterial(i, 'quantity', e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} placeholder="10" />
                <input value={m.unit} onChange={e => updateMaterial(i, 'unit', e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} placeholder="mL" />
                <IconBtn onClick={() => removeMaterial(i)} danger><Trash2 size={14} /></IconBtn>
              </div>
            ))}
            <button onClick={addMaterial} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <Plus size={14} /> Add Material
            </button>
          </div>

          {/* Equipment */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Equipment Required</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {equipment.map((eq, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', borderRadius: '20px', fontSize: '0.82rem', color: 'var(--accent-blue)' }}>
                  {eq}
                  <button onClick={() => setEquipment(e => e.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 0, color: 'var(--accent-blue)' }}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input value={newEquipment} onChange={e => setNewEquipment(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEquipment())} className="input-control" style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem' }} placeholder="e.g. Centrifuge, PCR Machine, Gel Electrophoresis" />
              <button onClick={addEquipment} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Safety & Review ── */}
      {activeTab === 'safety' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <F label="Safety Notes">
            <textarea value={safetyNotes} onChange={e => setSafetyNotes(e.target.value)} className="input-control" rows={5} placeholder="PPE required, hazardous materials, disposal instructions, emergency procedures..." style={{ resize: 'vertical' }} />
          </F>
          <div style={{ padding: '1rem', background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--accent-orange)' }}>
            ⚠️ Always include PPE requirements, chemical hazards, and emergency procedures for all wet-lab protocols.
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
        <Link href={cancelHref} className="btn btn-secondary">Cancel</Link>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {activeTab !== 'basic'     && <button onClick={() => setActiveTab(tabs[tabs.findIndex(t => t[0] === activeTab) - 1][0])} className="btn btn-secondary">← Previous</button>}
          {activeTab !== 'safety'    && <button onClick={() => setActiveTab(tabs[tabs.findIndex(t => t[0] === activeTab) + 1][0])} className="btn btn-secondary">Next →</button>}
          {activeTab === 'safety'    && <button onClick={handleSubmit} className="btn btn-primary" disabled={!name.trim()}>{isEdit ? 'Save New Version' : 'Create Procedure'}</button>}
        </div>
      </div>
    </div>
  );
}

function F({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
        {label}{required && <span style={{ color: 'var(--accent-red)' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function IconBtn({ onClick, title, danger, children }: { onClick: () => void; title?: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{ background: danger ? 'rgba(220,38,38,0.07)' : 'var(--bg-primary)', border: `1px solid ${danger ? 'rgba(220,38,38,0.2)' : 'var(--glass-border)'}`, color: danger ? 'var(--accent-red)' : 'var(--text-muted)', borderRadius: '6px', padding: '0.3rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}
