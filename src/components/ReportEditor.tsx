'use client';
import { useState, useTransition } from 'react';
import {
  updateReportSection, updateReportMeta,
  addFigure, updateFigure, deleteFigure,
  addTable, updateTable, deleteTable,
  importTask, removeTaskLink,
} from '@/app/actions/reports';
import { Save, Plus, Trash2, ChevronDown, ChevronUp, Download, Image, Table as TableIcon, CheckSquare } from 'lucide-react';

interface Section { id: string; sectionKey: string; title: string; content: string; }
interface Figure  { id: string; imageUrl: string | null; title: string; legend: string; order: number; }
interface TableRow{ id: string; tableData: string; title: string; legend: string; order: number; }
interface Task    { id: string; title: string; status: string; steps: { notes: string | null }[]; }
interface TaskLink{ task: Task; }

interface Props {
  report: {
    id: string; title: string; status: string; abstract: string | null;
    sections: Section[]; figures: Figure[]; tables: TableRow[];
    taskLinks: TaskLink[];
    project: { id: string; name: string; tasks: Task[] };
  };
}

const TABS = [
  { id: 'meta',      label: 'Info' },
  { id: 'content',   label: 'Content' },
  { id: 'figures',   label: 'Figures' },
  { id: 'tables',    label: 'Tables' },
  { id: 'tasks',     label: 'Import Tasks' },
];

const SECTION_ORDER = [
  'project_info','gene_info','gene_map','plasmid_map',
  'expected_results','obtained_results','procedures',
  'findings','discussion','conclusion',
];

export default function ReportEditor({ report }: Props) {
  const [activeTab, setActiveTab] = useState<string>('meta');
  const [, startTransition] = useTransition();

  // Local state for immediate UI updates
  const [meta, setMeta] = useState({ title: report.title, status: report.status, abstract: report.abstract ?? '' });
  const [sections, setSections] = useState<Section[]>(
    SECTION_ORDER.map(k => report.sections.find(s => s.sectionKey === k)).filter(Boolean) as Section[]
  );
  const [figures, setFigures]   = useState<Figure[]>(report.figures);
  const [tables, setTables]     = useState<TableRow[]>(report.tables);
  const [linkedTasks, setLinkedTasks] = useState<TaskLink[]>(report.taskLinks);
  const linkedTaskIds = new Set(linkedTasks.map(l => l.task.id));

  const saveMeta = () => {
    const fd = new FormData();
    fd.append('id', report.id);
    fd.append('title', meta.title);
    fd.append('status', meta.status);
    fd.append('abstract', meta.abstract);
    startTransition(() => { updateReportMeta(fd); });
  };

  const saveSection = (section: Section) => {
    const fd = new FormData();
    fd.append('id', section.id);
    fd.append('content', section.content);
    startTransition(() => { updateReportSection(fd); });
  };

  const saveFigure = (fig: Figure) => {
    const fd = new FormData();
    fd.append('id', fig.id);
    fd.append('imageUrl', fig.imageUrl ?? '');
    fd.append('title', fig.title);
    fd.append('legend', fig.legend);
    startTransition(() => { updateFigure(fd); });
  };

  const saveTable = (tbl: TableRow) => {
    const fd = new FormData();
    fd.append('id', tbl.id);
    fd.append('tableData', tbl.tableData);
    fd.append('title', tbl.title);
    fd.append('legend', tbl.legend);
    startTransition(() => { updateTable(fd); });
  };

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: '0.6rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: activeTab === t.id ? 600 : 400, color: activeTab === t.id ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: `2px solid ${activeTab === t.id ? 'var(--accent-blue)' : 'transparent'}`, transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingBottom: 2 }}>
          <a href={`/api/reports/${report.id}/export`} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.4rem 0.9rem', textDecoration: 'none' }}>
            <Download size={14} /> Export DOCX
          </a>
        </div>
      </div>

      {/* ── Meta ── */}
      {activeTab === 'meta' && (
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <F label="Report Title">
            <input value={meta.title} onChange={e => setMeta(m => ({ ...m, title: e.target.value }))} className="input-control" />
          </F>
          <F label="Status">
            <select value={meta.status} onChange={e => setMeta(m => ({ ...m, status: e.target.value }))} className="input-control" style={{ padding: '0.75rem' }}>
              {['Draft','In Progress','Completed'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </F>
          <F label="Abstract (optional)">
            <textarea value={meta.abstract} onChange={e => setMeta(m => ({ ...m, abstract: e.target.value }))} className="input-control" rows={5} placeholder="Brief summary of the project and key findings…" style={{ resize: 'vertical' }} />
          </F>
          <button onClick={saveMeta} className="btn btn-primary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Save size={15} /> Save
          </button>
        </div>
      )}

      {/* ── Content Sections ── */}
      {activeTab === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {sections.map((section, idx) => (
            <SectionCard
              key={section.id}
              section={section}
              index={idx + 1}
              onChange={updated => setSections(ss => ss.map(s => s.id === updated.id ? updated : s))}
              onSave={saveSection}
            />
          ))}
        </div>
      )}

      {/* ── Figures ── */}
      {activeTab === 'figures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {figures.map((fig, i) => (
            <div key={fig.id} className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Image size={16} color="var(--accent-blue)" /> Figure {i + 1}
                </span>
                <button onClick={() => {
                  const fd = new FormData(); fd.append('id', fig.id);
                  startTransition(() => { deleteFigure(fd); });
                  setFigures(fs => fs.filter(f => f.id !== fig.id));
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', display: 'flex', padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <F label="Image URL">
                  <input value={fig.imageUrl ?? ''} onChange={e => setFigures(fs => fs.map(f => f.id === fig.id ? { ...f, imageUrl: e.target.value } : f))} className="input-control" placeholder="https://… or relative path" />
                </F>
                {fig.imageUrl && (
                  <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'var(--bg-primary)', maxHeight: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src={fig.imageUrl} alt={fig.title} style={{ maxWidth: '100%', maxHeight: 250, objectFit: 'contain' }} />
                  </div>
                )}
                <F label="Figure Title">
                  <input value={fig.title} onChange={e => setFigures(fs => fs.map(f => f.id === fig.id ? { ...f, title: e.target.value } : f))} className="input-control" placeholder="e.g. Gel electrophoresis of PCR product" />
                </F>
                <F label="Legend / Caption">
                  <textarea value={fig.legend} onChange={e => setFigures(fs => fs.map(f => f.id === fig.id ? { ...f, legend: e.target.value } : f))} className="input-control" rows={2} placeholder="Describe the figure…" style={{ resize: 'vertical' }} />
                </F>
                <button onClick={() => saveFigure(figures.find(f => f.id === fig.id)!)} className="btn btn-secondary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                  <Save size={13} /> Save Figure
                </button>
              </div>
            </div>
          ))}
          <button onClick={() => {
            const fd = new FormData(); fd.append('reportId', report.id);
            startTransition(() => { addFigure(fd); });
            const tmp: Figure = { id: 'tmp_' + Date.now(), imageUrl: null, title: '', legend: '', order: figures.length };
            setFigures(fs => [...fs, tmp]);
          }} className="btn btn-secondary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Add Figure
          </button>
        </div>
      )}

      {/* ── Tables ── */}
      {activeTab === 'tables' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {tables.map((tbl, i) => {
            const rows: string[][] = JSON.parse(tbl.tableData || '[]');
            return (
              <div key={tbl.id} className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TableIcon size={16} color="var(--accent-blue)" /> Table {i + 1}
                  </span>
                  <button onClick={() => {
                    const fd = new FormData(); fd.append('id', tbl.id);
                    startTransition(() => { deleteTable(fd); });
                    setTables(ts => ts.filter(t => t.id !== tbl.id));
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', display: 'flex', padding: 4 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                  <F label="Table Title">
                    <input value={tbl.title} onChange={e => setTables(ts => ts.map(t => t.id === tbl.id ? { ...t, title: e.target.value } : t))} className="input-control" placeholder="e.g. PCR Reaction Components" />
                  </F>
                  {/* Editable Grid */}
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Table Data (first row = header)</span>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => {
                          const nr = [...rows, Array(rows[0]?.length || 3).fill('')];
                          setTables(ts => ts.map(t => t.id === tbl.id ? { ...t, tableData: JSON.stringify(nr) } : t));
                        }} className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>+ Row</button>
                        <button onClick={() => {
                          const nc = rows.map(r => [...r, '']);
                          setTables(ts => ts.map(t => t.id === tbl.id ? { ...t, tableData: JSON.stringify(nc) } : t));
                        }} className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>+ Col</button>
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                        <tbody>
                          {rows.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{ padding: 0, border: '1px solid var(--glass-border)' }}>
                                  <input
                                    value={cell}
                                    onChange={e => {
                                      const nr = rows.map((r, rr) => r.map((c, cc) => (rr === ri && cc === ci) ? e.target.value : c));
                                      setTables(ts => ts.map(t => t.id === tbl.id ? { ...t, tableData: JSON.stringify(nr) } : t));
                                    }}
                                    style={{ padding: '0.4rem 0.5rem', border: 'none', background: ri === 0 ? 'var(--accent-blue-15)' : 'transparent', color: 'var(--text-primary)', fontWeight: ri === 0 ? 700 : 400, width: 120, fontFamily: 'inherit', fontSize: '0.83rem', outline: 'none' }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <F label="Legend / Caption">
                    <textarea value={tbl.legend} onChange={e => setTables(ts => ts.map(t => t.id === tbl.id ? { ...t, legend: e.target.value } : t))} className="input-control" rows={2} placeholder="Describe the table…" style={{ resize: 'vertical' }} />
                  </F>
                  <button onClick={() => saveTable(tables.find(t => t.id === tbl.id)!)} className="btn btn-secondary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                    <Save size={13} /> Save Table
                  </button>
                </div>
              </div>
            );
          })}
          <button onClick={() => {
            const fd = new FormData(); fd.append('reportId', report.id);
            startTransition(() => { addTable(fd); });
            const empty = JSON.stringify([['','',''],['','',''],['','',''],['','','']]);
            setTables(ts => [...ts, { id: 'tmp_' + Date.now(), tableData: empty, title: '', legend: '', order: ts.length }]);
          }} className="btn btn-secondary" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Add Table
          </button>
        </div>
      )}

      {/* ── Import Tasks ── */}
      {activeTab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>Linked Tasks</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Linked task notes are auto-imported into the Obtained Results section.
            </p>
            {linkedTasks.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No tasks linked yet.</p>}
            {linkedTasks.map(link => (
              <div key={link.task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <CheckSquare size={14} color="var(--accent-green)" />
                  <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>{link.task.title}</span>
                  <span className={`badge ${link.task.status === 'DONE' ? 'badge-green' : 'badge-orange'}`} style={{ fontSize: '0.68rem' }}>{link.task.status}</span>
                </div>
                <button onClick={() => {
                  const fd = new FormData();
                  fd.append('reportId', report.id);
                  fd.append('taskId', link.task.id);
                  startTransition(() => { removeTaskLink(fd); });
                  setLinkedTasks(ls => ls.filter(l => l.task.id !== link.task.id));
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', display: 'flex', padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Add Tasks from Project</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {report.project.tasks.filter(t => !linkedTaskIds.has(t.id)).map(task => {
                const hasNotes = task.steps.some(s => s.notes);
                return (
                  <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 0.9rem', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--bg-primary)' }}>
                    <div>
                      <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500 }}>{task.title}</span>
                      {hasNotes && <span style={{ fontSize: '0.72rem', color: 'var(--accent-green)', marginLeft: '0.5rem' }}>has notes</span>}
                    </div>
                    <button onClick={() => {
                      const fd = new FormData();
                      fd.append('reportId', report.id);
                      fd.append('taskId', task.id);
                      startTransition(() => { importTask(fd); });
                      setLinkedTasks(ls => [...ls, { task }]);
                    }} className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Plus size={12} /> Import
                    </button>
                  </div>
                );
              })}
              {report.project.tasks.filter(t => !linkedTaskIds.has(t.id)).length === 0 && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>All tasks from this project are already linked.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({ section, index, onChange, onSave }: {
  section: Section; index: number;
  onChange: (s: Section) => void;
  onSave: (s: Section) => void;
}) {
  const [open, setOpen] = useState(index <= 2);
  return (
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', padding: '1rem 1.5rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-blue)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{index}</span>
        <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)', flex: 1 }}>{section.title}</span>
        {section.content.trim() && <span style={{ fontSize: '0.72rem', color: 'var(--accent-green)', marginRight: '0.25rem' }}>✓ filled</span>}
        {open ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
      </button>
      {open && (
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <textarea
            value={section.content}
            onChange={e => onChange({ ...section, content: e.target.value })}
            className="input-control"
            rows={6}
            placeholder={`Write ${section.title.toLowerCase()} here…`}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.88rem', lineHeight: 1.7 }}
          />
          <button onClick={() => onSave(section)} className="btn btn-secondary" style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
            <Save size={13} /> Save Section
          </button>
        </div>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  );
}
