'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  FlaskConical, CheckCircle, XCircle, MessageSquare, Wrench,
  ArrowRight, RotateCcw, Save, ImageIcon, BookOpen, Trash2, Circle
} from 'lucide-react';
import { saveTaskExecution, repeatTask } from '@/app/actions/tasks';
import { completeTaskStep } from '@/app/actions/projects';
import { addTaskComment, deleteTaskComment } from '@/app/actions/tasks';
import GelImportPanel from './GelImportPanel';
import SampleRegistrationModal from './SampleRegistrationModal';

interface User { id: string; name: string; }
interface GelImage {
  id: string; fileName: string; filePath: string; fileType: string;
  experimentType: string | null; notes: string | null; capturedAt: Date | string;
  task: { id: string; title: string } | null;
}
interface TaskStep { id: string; stepNumber: number; title: string; description: string; status: string; notes: string | null; completedAt: Date | string | null; }
interface Comment { id: string; content: string; createdAt: Date | string; author: { name: string }; }
interface ParentTask { id: string; title: string; attemptNumber: number; success: boolean | null; }
interface ChildTask { id: string; title: string; attemptNumber: number; status: string; }

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  attemptNumber: number;
  result: string | null;
  success: boolean | null;
  discussion: string | null;
  troubleshooting: string | null;
  nextStep: string | null;
  assignedTo: User | null;
  procedure: { id: string; name: string; procedureId: string } | null;
  geneSequence: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  steps: TaskStep[];
  comments: Comment[];
  gelImages: GelImage[];
  parentTask: ParentTask | null;
  childTasks: ChildTask[];
  samples: { id: string; sampleId: string; name: string }[];
}

const SECTION_TABS = [
  { id: 'overview',        label: 'Overview',       icon: <FlaskConical size={14} /> },
  { id: 'protocol',        label: 'Protocol',        icon: <BookOpen size={14} /> },
  { id: 'results',         label: 'Results',         icon: <CheckCircle size={14} /> },
  { id: 'discussion',      label: 'Discussion',      icon: <MessageSquare size={14} /> },
  { id: 'troubleshooting', label: 'Troubleshoot',    icon: <Wrench size={14} /> },
  { id: 'gels',            label: 'Gel Images',      icon: <ImageIcon size={14} /> },
  { id: 'comments',        label: 'Comments',        icon: <MessageSquare size={14} /> },
] as const;
type SectionTab = typeof SECTION_TABS[number]['id'];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  TODO:        { bg: 'rgba(100,116,139,0.12)', color: 'var(--text-muted)' },
  IN_PROGRESS: { bg: 'rgba(249,115,22,0.12)',  color: 'var(--accent-orange)' },
  DONE:        { bg: 'rgba(16,185,129,0.12)',   color: 'var(--accent-green)' },
};

export default function TaskExecutionPanel({ task, allTasks, freezers }: { task: Task; allTasks: { id: string; title: string }[]; freezers: { id: string; name: string; temperature: number }[] }) {
  const [tab, setTab] = useState<SectionTab>('overview');
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Execution fields state
  const [result, setResult] = useState(task.result ?? '');
  const [success, setSuccess] = useState<'true' | 'false' | ''>(
    task.success === true ? 'true' : task.success === false ? 'false' : ''
  );
  const [discussion, setDiscussion] = useState(task.discussion ?? '');
  const [troubleshooting, setTroubleshooting] = useState(task.troubleshooting ?? '');
  const [nextStep, setNextStep] = useState(task.nextStep ?? '');
  const [showRepeatModal, setShowRepeatModal] = useState(false);
  const [showStoreSample, setShowStoreSample] = useState(false);

  const handleSave = () => {
    const fd = new FormData();
    fd.append('id', task.id);
    fd.append('result', result);
    fd.append('success', success);
    fd.append('discussion', discussion);
    fd.append('troubleshooting', troubleshooting);
    fd.append('nextStep', nextStep);
    startTransition(async () => {
      await saveTaskExecution(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const st = STATUS_STYLE[task.status] ?? STATUS_STYLE.TODO;
  const doneSteps = task.steps.filter(s => s.status === 'COMPLETED').length;
  const totalSteps = task.steps.length;
  const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '1.75rem 2rem', marginBottom: '1.25rem' }}>
        {/* Attempt chain */}
        {(task.parentTask || task.childTasks.length > 0 || task.attemptNumber > 1) && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Attempts:</span>
            {task.parentTask && (
              <Link href={`/tasks/${task.parentTask.id}`} style={{ padding: '0.15rem 0.5rem', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-muted)', textDecoration: 'none' }}>
                #{task.parentTask.attemptNumber} {task.parentTask.success === false ? '✗' : task.parentTask.success === true ? '✓' : ''}
              </Link>
            )}
            <span style={{ padding: '0.15rem 0.5rem', borderRadius: 4, background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', fontWeight: 700 }}>
              #{task.attemptNumber} (current)
            </span>
            {task.childTasks.map(c => (
              <Link key={c.id} href={`/tasks/${c.id}`} style={{ padding: '0.15rem 0.5rem', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-muted)', textDecoration: 'none' }}>
                #{c.attemptNumber}
              </Link>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
              <span style={{ padding: '0.25rem 0.65rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, ...st }}>
                {task.status.replace('_', ' ')}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.2rem 0.55rem', borderRadius: 5 }}>
                {task.priority} PRIORITY
              </span>
              {task.attemptNumber > 1 && (
                <span style={{ fontSize: '0.72rem', color: 'var(--accent-orange)', background: 'rgba(249,115,22,0.1)', padding: '0.2rem 0.55rem', borderRadius: 5, fontWeight: 600 }}>
                  Attempt #{task.attemptNumber}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{task.title}</h1>
            {task.description && <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.35rem' }}>{task.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            {task.success === true && (
              <button onClick={() => setShowStoreSample(true)} className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <FlaskConical size={14} /> Store Sample
              </button>
            )}
            <button onClick={() => setShowRepeatModal(true)} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RotateCcw size={14} /> Repeat Task
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
          {task.assignedTo && <InfoPill icon="👤" label="Assigned" value={task.assignedTo.name} />}
          {task.project && <InfoPill icon="📁" label="Project" value={task.project.name} />}
          {task.geneSequence && <InfoPill icon="🧬" label="Sequence" value={task.geneSequence.name} href={`/sequences/${task.geneSequence.id}`} />}
          {task.procedure && <InfoPill icon="📋" label="SOP" value={`${task.procedure.procedureId} – ${task.procedure.name}`} href={`/procedures/${task.procedure.id}`} />}
          {task.dueDate && <InfoPill icon="📅" label="Due" value={new Date(task.dueDate).toLocaleDateString()} />}
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {SECTION_TABS.map(s => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.55rem 1rem', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.82rem', whiteSpace: 'nowrap',
              fontWeight: tab === s.id ? 600 : 400,
              color: tab === s.id ? 'var(--accent-blue)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === s.id ? 'var(--accent-blue)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ color: 'inherit' }}>{s.icon}</span> {s.label}
            {s.id === 'gels' && task.gelImages.length > 0 && <span style={{ background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', borderRadius: 8, padding: '0 0.35rem', fontSize: '0.68rem', fontWeight: 700 }}>{task.gelImages.length}</span>}
            {s.id === 'comments' && task.comments.length > 0 && <span style={{ background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', borderRadius: 8, padding: '0 0.35rem', fontSize: '0.68rem', fontWeight: 700 }}>{task.comments.length}</span>}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Steps progress */}
          {totalSteps > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                <span style={{ fontWeight: 600 }}>Protocol Progress</span>
                <span style={{ color: pct === 100 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{doneSteps}/{totalSteps} steps ({pct}%)</span>
              </div>
              <div style={{ height: 7, background: 'var(--bg-primary)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))', borderRadius: 4, transition: 'width 0.4s' }} />
              </div>
            </div>
          )}

          {/* Execution summary */}
          {(task.result || task.success !== null || task.discussion) && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {task.success === true ? <CheckCircle size={18} color="var(--accent-green)" /> : task.success === false ? <XCircle size={18} color="var(--accent-red)" /> : null}
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: task.success === true ? 'var(--accent-green)' : task.success === false ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                    {task.success === true ? 'Experiment Successful' : task.success === false ? 'Experiment Failed' : 'Results Pending'}
                  </span>
                </div>
                {task.success === true && (
                  <button onClick={() => setShowStoreSample(true)} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--accent-green)', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <FlaskConical size={12} /> Store Sample
                  </button>
                )}
              </div>
              {task.result && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}><strong>Result:</strong> {task.result}</p>}
              {task.nextStep && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
                  <ArrowRight size={14} /> <strong>Next:</strong> {task.nextStep}
                </div>
              )}
            </div>
          )}

          {/* Stored samples */}
          {task.samples.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <FlaskConical size={15} color="var(--accent-blue)" /> Stored Samples ({task.samples.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {task.samples.map(s => (
                  <Link key={s.id} href={`/samples/${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: 7, textDecoration: 'none' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-blue)' }}>{s.sampleId}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{s.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--accent-blue)' }}>View →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Gel images preview */}
          {task.gelImages.length > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ImageIcon size={15} color="var(--accent-blue)" /> Gel Results ({task.gelImages.length})
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
                {task.gelImages.slice(0, 5).map(img => (
                  <div key={img.id} style={{ width: 100, height: 80, flexShrink: 0, background: '#1e293b', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }} onClick={() => setTab('gels')}>
                    {img.fileType !== 'tif' ? (
                      <img src={img.filePath} alt={img.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontSize: '0.7rem' }}>.TIF</div>
                    )}
                  </div>
                ))}
                {task.gelImages.length > 5 && <div style={{ width: 100, height: 80, flexShrink: 0, background: 'var(--bg-primary)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setTab('gels')}>+{task.gelImages.length - 5} more</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Protocol steps ───────────────────────────────────────────────────── */}
      {tab === 'protocol' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          {task.steps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              No protocol steps. {task.procedure && <Link href={`/procedures/${task.procedure.id}`} style={{ color: 'var(--accent-blue)' }}>View SOP</Link>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {task.steps.map(step => {
                const isDone = step.status === 'COMPLETED';
                return (
                  <div key={step.id} className="glass-card" style={{ padding: '1rem', borderLeft: `3px solid ${isDone ? 'var(--accent-green)' : 'var(--glass-border)'}`, opacity: isDone ? 0.8 : 1 }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                      {isDone ? <CheckCircle size={18} color="var(--accent-green)" style={{ flexShrink: 0, marginTop: 2 }} /> : <Circle size={18} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />}
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>STEP {step.stepNumber}</span>
                        {step.title && <div style={{ fontWeight: 600, fontSize: '0.9rem', textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--text-muted)' : 'var(--text-primary)' }}>{step.title}</div>}
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{step.description}</div>
                        {step.notes && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontStyle: 'italic' }}>Notes: {step.notes}</div>}
                        <form action={completeTaskStep} style={{ marginTop: '0.65rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input type="hidden" name="id" value={step.id} />
                          <input type="hidden" name="status" value={isDone ? 'PENDING' : 'COMPLETED'} />
                          <input name="notes" defaultValue={step.notes ?? ''} className="input-control" placeholder="Notes…" style={{ flex: 1, padding: '0.35rem 0.55rem', fontSize: '0.78rem' }} />
                          <button type="submit" className={`btn ${isDone ? 'btn-secondary' : 'btn-primary'}`} style={{ fontSize: '0.78rem', padding: '0.35rem 0.8rem' }}>
                            {isDone ? 'Undo' : 'Complete'}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {tab === 'results' && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Observed Results</label>
            <textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              className="input-control"
              rows={4}
              placeholder="Describe what you observed, e.g. 'Band at 1.2 kb as expected'"
              style={{ width: '100%', padding: '0.65rem 0.75rem', fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>Experiment Outcome</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {([
                { val: 'true',  label: '✓ Successful', accent: 'var(--accent-green)', bg: 'rgba(16,185,129,0.08)' },
                { val: 'false', label: '✗ Failed',      accent: 'var(--accent-red)',   bg: 'rgba(239,68,68,0.08)' },
                { val: '',      label: '— Pending',     accent: 'var(--text-muted)',   bg: 'var(--bg-primary)' },
              ] as const).map(opt => (
                <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.6rem 1rem', borderRadius: 8, border: `2px solid ${success === opt.val ? opt.accent : 'var(--glass-border)'}`, background: success === opt.val ? opt.bg : 'transparent', color: success === opt.val ? opt.accent : 'var(--text-secondary)', fontWeight: success === opt.val ? 600 : 400, fontSize: '0.85rem', transition: 'all 0.15s' }}>
                  <input type="radio" name="success" value={opt.val} checked={success === opt.val} onChange={() => setSuccess(opt.val)} style={{ display: 'none' }} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Next Step</label>
            <input value={nextStep} onChange={e => setNextStep(e.target.value)} className="input-control" placeholder="e.g. Proceed to ligation / Repeat with higher annealing temp" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.88rem' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSave} disabled={isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <Save size={14} /> {isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Results'}
            </button>
          </div>
        </div>
      )}

      {/* ── Discussion ───────────────────────────────────────────────────────── */}
      {tab === 'discussion' && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Compare your observed results against expected outcomes. Explain what the data means and whether the experiment achieved its goal.
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Discussion & Analysis</label>
            <textarea
              value={discussion}
              onChange={e => setDiscussion(e.target.value)}
              className="input-control"
              rows={8}
              placeholder="Was the experiment successful? Why or why not? How do results compare to expected?"
              style={{ width: '100%', padding: '0.65rem 0.75rem', fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSave} disabled={isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <Save size={14} /> {isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Discussion'}
            </button>
          </div>
        </div>
      )}

      {/* ── Troubleshooting ──────────────────────────────────────────────────── */}
      {tab === 'troubleshooting' && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            If the experiment failed, document potential causes and corrective actions here.
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Troubleshooting Notes</label>
            <textarea
              value={troubleshooting}
              onChange={e => setTroubleshooting(e.target.value)}
              className="input-control"
              rows={8}
              placeholder={`Possible issues:\n• Incorrect annealing temperature\n• Template degradation\n• Primer design issues\n\nCorrective actions:\n• Try Tm +/- 2°C\n• Prepare fresh template\n• Redesign primers`}
              style={{ width: '100%', padding: '0.65rem 0.75rem', fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button onClick={() => setShowRepeatModal(true)} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <RotateCcw size={14} /> Repeat Task
            </button>
            <button onClick={handleSave} disabled={isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <Save size={14} /> {isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
            </button>
          </div>
        </div>
      )}

      {/* ── Gel Images ───────────────────────────────────────────────────────── */}
      {tab === 'gels' && (
        <GelImportPanel images={task.gelImages} tasks={allTasks} taskId={task.id} />
      )}

      {/* ── Comments ─────────────────────────────────────────────────────────── */}
      {tab === 'comments' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          {task.comments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {task.comments.map(c => (
                <div key={c.id} className="glass-card" style={{ padding: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--accent-blue)' }}>{c.author.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleString()}</span>
                      <form action={deleteTaskComment}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><Trash2 size={12} /></button>
                      </form>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{c.content}</p>
                </div>
              ))}
            </div>
          )}
          {task.comments.length === 0 && <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>No comments yet.</div>}
          <form action={addTaskComment} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <input type="hidden" name="taskId" value={task.id} />
            <textarea name="content" required placeholder="Add a comment…" rows={2} className="input-control" style={{ flex: 1, padding: '0.55rem 0.75rem', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }} />
            <button type="submit" className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '0.55rem 1rem', whiteSpace: 'nowrap' }}>Post</button>
          </form>
        </div>
      )}

      {/* Store Sample Modal */}
      {showStoreSample && (
        <SampleRegistrationModal
          taskId={task.id}
          projectId={task.project?.id}
          geneSequenceId={task.geneSequence?.id}
          taskTitle={task.title}
          freezers={freezers}
          onClose={() => setShowStoreSample(false)}
        />
      )}

      {/* Repeat Task Modal */}
      {showRepeatModal && (
        <RepeatModal taskId={task.id} onClose={() => setShowRepeatModal(false)} />
      )}
    </div>
  );
}

// ─── Repeat Task Modal ────────────────────────────────────────────────────────

function RepeatModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [changes, setChanges] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 480, padding: '2rem' }}>
        <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Repeat Task</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Creates a new attempt linked to this task, copying all protocol steps. Describe what you are changing.
        </p>
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Changes / Modifications</label>
        <textarea
          value={changes}
          onChange={e => setChanges(e.target.value)}
          className="input-control"
          rows={4}
          placeholder="e.g. Increased annealing temp to 62°C, using fresh template"
          style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', marginBottom: '1.25rem' }}
        />
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" type="button">Cancel</button>
          <form action={repeatTask}>
            <input type="hidden" name="parentId" value={taskId} />
            <input type="hidden" name="changes" value={changes} />
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <RotateCcw size={14} /> Create Attempt
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Info pill ────────────────────────────────────────────────────────────────

function InfoPill({ icon, label, value, href }: { icon: string; label: string; value: string; href?: string }) {
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
      <span>{icon}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: href ? 'var(--accent-blue)' : 'var(--text-secondary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}
