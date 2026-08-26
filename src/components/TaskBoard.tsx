'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Clock, CheckSquare, AlertCircle, X } from 'lucide-react';
import { createTask, updateTaskStatus } from '@/app/actions/tasks';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH';
type Status = 'TODO' | 'IN_PROGRESS' | 'DONE';

interface User { id: string; name: string; }
interface Project { id: string; name: string; }
interface Sequence { id: string; name: string; }
interface Procedure { id: string; name: string; procedureId: string; }
interface TaskStep { id: string; status: string; }
interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  assignedTo: User | null;
  project: Project | null;
  geneSequence: { name: string } | null;
  steps: TaskStep[];
}

interface Props {
  tasks: Task[];
  users: User[];
  projects: Project[];
  sequences: Sequence[];
  procedures: Procedure[];
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: 'var(--accent-red)',
  MEDIUM: 'var(--accent-orange)',
  LOW: 'var(--accent-green)',
};

const COL_META: { key: Status; label: string; icon: React.ReactNode; accent: string }[] = [
  { key: 'TODO',        label: 'To Do',      icon: <AlertCircle size={14} />, accent: 'var(--text-muted)' },
  { key: 'IN_PROGRESS', label: 'In Progress', icon: <Clock size={14} />,       accent: 'var(--accent-orange)' },
  { key: 'DONE',        label: 'Completed',   icon: <CheckSquare size={14} />, accent: 'var(--accent-green)' },
];

export default function TaskBoard({ tasks: initial, users, projects, sequences, procedures }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [showModal, setShowModal] = useState(false);
  const [isPending, startTransition] = useTransition();

  const grouped = {
    TODO:        tasks.filter(t => t.status === 'TODO'),
    IN_PROGRESS: tasks.filter(t => t.status === 'IN_PROGRESS'),
    DONE:        tasks.filter(t => t.status === 'DONE'),
  } as Record<Status, Task[]>;

  const handleStatusChange = (taskId: string, newStatus: Status) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    startTransition(() => { updateTaskStatus(taskId, newStatus); });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem' }}>
        <div>
          <h1 className="title-gradient" style={{ fontSize: '2rem' }}>Task Board</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {tasks.filter(t => t.status === 'DONE').length} completed
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Plus size={16} /> Add New Task
        </button>
      </div>

      {/* Kanban columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem' }}>
        {COL_META.map(col => (
          <div key={col.key} className="glass-panel" style={{ padding: '1.25rem', minHeight: 420, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)' }}>
              <span style={{ color: col.accent }}>{col.icon}</span>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{col.label}</span>
              <span style={{ marginLeft: 'auto', background: 'var(--accent-blue-15)', color: 'var(--text-secondary)', padding: '0.1rem 0.5rem', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600 }}>
                {grouped[col.key].length}
              </span>
            </div>

            {grouped[col.key].map(task => (
              <TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} />
            ))}

            {grouped[col.key].length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '2rem', opacity: 0.6 }}>No tasks</div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <AddTaskModal
          users={users}
          projects={projects}
          sequences={sequences}
          procedures={procedures}
          onClose={() => setShowModal(false)}
          onCreated={(t) => { setTasks(prev => [t, ...prev]); setShowModal(false); }}
          isPending={isPending}
          startTransition={startTransition}
        />
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, onStatusChange }: { task: Task; onStatusChange: (id: string, s: Status) => void }) {
  const doneSteps = task.steps.filter(s => s.status === 'COMPLETED').length;
  const totalSteps = task.steps.length;
  const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : -1;
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  const NEXT_STATUS: Record<string, Status> = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'TODO' };
  const NEXT_LABEL: Record<string, string> = { TODO: '→ Start', IN_PROGRESS: '→ Done', DONE: '↺ Reopen' };

  return (
    <div className="glass-card" style={{ padding: '1rem', position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: '8px 0 0 8px', background: PRIORITY_COLOR[task.priority] ?? 'var(--glass-border)' }} />
      <div style={{ paddingLeft: '0.5rem' }}>
        <Link href={`/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.3rem', lineHeight: 1.3 }}>{task.title}</div>
        </Link>
        {task.description && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {task.description}
          </div>
        )}
        {pct >= 0 && (
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ height: 3, background: 'var(--bg-primary)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--accent-green)' : 'var(--accent-blue)', borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{doneSteps}/{totalSteps} steps</div>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
          {task.project && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.15rem 0.45rem', borderRadius: 4 }}>
              📁 {task.project.name}
            </span>
          )}
          {task.geneSequence && (
            <span style={{ fontSize: '0.68rem', color: 'var(--accent-blue)', background: 'var(--accent-blue-15)', padding: '0.15rem 0.45rem', borderRadius: 4 }}>
              🧬 {task.geneSequence.name}
            </span>
          )}
          <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.45rem', borderRadius: 4, color: PRIORITY_COLOR[task.priority], background: `${PRIORITY_COLOR[task.priority]}22` }}>
            {task.priority}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
            {task.assignedTo && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>→ {task.assignedTo.name}</span>}
            {task.dueDate && (
              <span style={{ fontSize: '0.7rem', color: isOverdue ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                {isOverdue ? '⚠ ' : ''}Due {new Date(task.dueDate).toLocaleDateString()}
              </span>
            )}
          </div>
          <button
            onClick={() => onStatusChange(task.id, NEXT_STATUS[task.status])}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.6rem', border: '1px solid var(--glass-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            {NEXT_LABEL[task.status]}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Task Modal ───────────────────────────────────────────────────────────

function AddTaskModal({ users, projects, sequences, procedures, onClose, onCreated, isPending, startTransition }: {
  users: User[]; projects: Project[]; sequences: Sequence[]; procedures: Procedure[];
  onClose: () => void; onCreated: (t: Task) => void;
  isPending: boolean; startTransition: (fn: () => void) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [status, setStatus] = useState<Status>('TODO');
  const [assignedToId, setAssignedToId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [geneSequenceId, setGeneSequenceId] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description);
    fd.append('priority', priority);
    fd.append('status', status);
    fd.append('assignedToId', assignedToId);
    fd.append('projectId', projectId);
    fd.append('geneSequenceId', geneSequenceId);
    fd.append('procedureId', procedureId);
    fd.append('dueDate', dueDate);

    const optimistic: Task = {
      id: `opt-${Date.now()}`,
      title, description: description || null, status, priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedTo: users.find(u => u.id === assignedToId) ?? null,
      project: projects.find(p => p.id === projectId) ?? null,
      geneSequence: sequences.find(s => s.id === geneSequenceId) ? { name: sequences.find(s => s.id === geneSequenceId)!.name } : null,
      steps: [],
    };
    onCreated(optimistic);
    startTransition(() => { createTask(fd); });
  };

  const L: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' };
  const S: React.CSSProperties = { width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', padding: '2rem', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={20} />
        </button>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem' }}>Add New Task</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={L}>Task Name *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="input-control" required placeholder="e.g. Run PCR for GFP insert" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.9rem' }} />
          </div>
          <div>
            <label style={L}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-control" rows={3} placeholder="Describe what needs to be done…" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={L}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as Priority)} className="input-control" style={S}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label style={L}>Initial Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as Status)} className="input-control" style={S}>
                <option value="TODO">To Do</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="DONE">Completed</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={L}>Assigned To</label>
              <select value={assignedToId} onChange={e => setAssignedToId(e.target.value)} className="input-control" style={S}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={L}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-control" style={S} />
            </div>
          </div>
          <div>
            <label style={L}>Linked Project</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input-control" style={S}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={L}>Linked Sequence</label>
            <select value={geneSequenceId} onChange={e => setGeneSequenceId(e.target.value)} className="input-control" style={S}>
              <option value="">None</option>
              {sequences.map(s => <option key={s.id} value={s.id}>🧬 {s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={L}>Linked Procedure (SOP)</label>
            <select value={procedureId} onChange={e => setProcedureId(e.target.value)} className="input-control" style={S}>
              <option value="">None</option>
              {procedures.map(p => <option key={p.id} value={p.id}>{p.procedureId} – {p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!title.trim() || isPending} className="btn btn-primary">
              {isPending ? 'Creating…' : '+ Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
