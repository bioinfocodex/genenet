'use client';
import { useState, useTransition } from 'react';
import { createTask } from '@/app/actions/projects';
import { Plus, BookOpen } from 'lucide-react';

interface User { id: string; name: string; }
interface Proc  { id: string; name: string; procedureId: string; }

export default function TaskCreateForm({ projectId, users, procedures }: { projectId: string; users: User[]; procedures: Proc[] }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => { createTask(undefined, fd); });
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
          <Plus size={16} /> Add Task to Project
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input type="hidden" name="projectId" value={projectId} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>Task Title *</label>
              <input name="title" required className="input-control" placeholder="e.g. Run gel electrophoresis" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>Priority</label>
              <select name="priority" className="input-control" defaultValue="MEDIUM" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>Assign To</label>
              <select name="assignedToId" className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <BookOpen size={12} /> Procedure
              </label>
              <select name="procedureId" className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                <option value="">None</option>
                {procedures.map(p => <option key={p.id} value={p.id}>{p.procedureId} – {p.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>Due Date</label>
              <input type="date" name="dueDate" className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>Description</label>
            <textarea name="description" className="input-control" rows={2} placeholder="Optional details…" style={{ resize: 'vertical', fontSize: '0.85rem' }} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" style={{ fontSize: '0.85rem' }}>Add Task</button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
