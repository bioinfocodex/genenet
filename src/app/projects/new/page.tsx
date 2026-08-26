'use client';
import { useActionState } from 'react';
import { createProject } from '@/app/actions/projects';
import Link from 'next/link';

export default function NewProjectPage() {
  const [state, action, pending] = useActionState(createProject, undefined);

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 className="title-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>New Project</h1>

      <form action={action}>
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {state?.error && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, fontSize: '0.88rem', color: 'var(--accent-red)' }}>
              {state.error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>Project Name <span style={{ color: 'var(--accent-red)' }}>*</span></label>
            <input name="name" required className="input-control" placeholder="e.g. CRISPR Screen Q2 2025" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>Description</label>
            <textarea name="description" className="input-control" rows={4} placeholder="Project goals and scope…" style={{ resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
          <Link href="/projects" className="btn btn-secondary">Cancel</Link>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
