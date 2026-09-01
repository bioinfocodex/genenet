'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CheckSquare, Dna, Settings, Users, Database, Scissors,
  BookOpen, FolderKanban, FileText, FlaskConical, Layers, Activity, TestTube,
  ChevronDown, ChevronRight, Thermometer, ImageIcon, Box, ShieldAlert, Download, GitBranch, ScanSearch, Layers3, Wand2, Grid3x3, NotebookPen, Boxes,
} from 'lucide-react';
import { useState } from 'react';

type NavItem = { name: string; path: string; icon: React.ElementType };
type NavGroup = { group: string; items: NavItem[] };
type NavEntry = NavItem | NavGroup;

function isGroup(e: NavEntry): e is NavGroup { return 'group' in e; }

type Props = { userRole?: string; userName?: string };

export default function Sidebar({ userRole = 'MEMBER', userName = '' }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (g: string) => setCollapsed(p => ({ ...p, [g]: !p[g] }));

  const nav: NavEntry[] = [
    { name: 'Dashboard',        path: '/',                icon: LayoutDashboard },
    { group: 'Lab Management', items: [
      { name: 'Projects',       path: '/projects',        icon: FolderKanban },
      { name: 'Tasks',          path: '/tasks',           icon: CheckSquare },
      { name: 'Procedures',     path: '/procedures',      icon: BookOpen },
      { name: 'Reports',        path: '/reports',         icon: FileText },
      { name: 'Experiments',    path: '/experiments',     icon: TestTube },
    ]},
    { group: 'Molecular Biology', items: [
      { name: 'Sequences',      path: '/sequences',       icon: Database },
      { name: 'Proteins',       path: '/proteins',        icon: FlaskConical },
      { name: 'Cloning Wizard', path: '/sequences/clone', icon: Scissors },
      { name: 'Search by Seq',  path: '/sequences/find',  icon: ScanSearch },
      { name: 'Assemble Reads', path: '/sequences/assemble', icon: Layers3 },
      { name: 'Gene Design',    path: '/sequences/optimise', icon: Wand2 },
      { name: 'Gel Sims',       path: '/gels',            icon: Layers },
      { name: 'Gel Images',     path: '/gels/images',     icon: ImageIcon },
      { name: 'Phylogeny',      path: '/phylogeny',       icon: GitBranch },
      { name: 'Collections',    path: '/collections',     icon: Layers },
      { name: 'Plates',         path: '/plates',          icon: Grid3x3 },
    ]},
    { group: 'Records', items: [
      { name: 'Notebook',       path: '/notebook',        icon: NotebookPen },
      { name: 'Record Types',   path: '/entities',        icon: Boxes },
    ]},
    { group: 'Storage', items: [
      { name: 'Samples',        path: '/samples',         icon: Box },
      { name: 'Freezers',       path: '/freezers',        icon: Thermometer },
    ]},
    { group: 'Instruments', items: [
      { name: 'Bioreactors',    path: '/bioreactors',     icon: Activity },
    ]},
    { group: 'Team & Settings', items: [
      { name: 'Lab Members',    path: '/members',         icon: Users },
      { name: 'Settings',       path: '/settings',        icon: Settings },
      ...(userRole === 'ADMIN' ? [
        { name: 'Admin Panel',  path: '/admin',       icon: ShieldAlert },
        { name: 'Team & Seats', path: '/admin/team',  icon: Users },
      ] : []),
    ]},
    { name: 'Download App',   path: '/download',        icon: Download },
  ];

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
    const isAdmin = item.path === '/admin';
    return (
      <li key={item.path}>
        <Link
          href={item.path}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.65rem',
            padding: '0.55rem 0.85rem', borderRadius: '7px',
            color: isActive ? (isAdmin ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'var(--text-secondary)',
            background: isActive ? (isAdmin ? 'rgba(124,58,237,0.1)' : 'var(--accent-blue-15)') : 'transparent',
            border: isActive ? `1px solid ${isAdmin ? 'rgba(124,58,237,0.2)' : 'var(--accent-blue-glow)'}` : '1px solid transparent',
            fontWeight: isActive ? 600 : 500, fontSize: '0.875rem',
            transition: 'all 0.15s ease', textDecoration: 'none',
          }}
          onMouseOver={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseOut={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <Icon size={17} color={isActive ? (isAdmin ? 'var(--accent-purple)' : 'var(--accent-blue)') : 'currentColor'} />
          {item.name}
        </Link>
      </li>
    );
  };

  return (
    <aside className="glass-panel" style={{
      width: 260, minWidth: 260, flexShrink: 0,
      height: '100vh', position: 'sticky', top: 0,
      borderRadius: 0, borderTop: 'none', borderBottom: 'none', borderLeft: 'none',
      borderRight: '1px solid var(--glass-border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '1.5rem 1.25rem 1rem' }}>
        <h2 className="title-gradient" style={{ fontSize: '1.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Dna size={24} color="var(--accent-blue)" /> GeneNet
        </h2>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0 0.75rem', overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {nav.map((entry, i) => {
            if (!isGroup(entry)) return renderItem(entry);

            const open = !collapsed[entry.group];
            const groupActive = entry.items.some(it =>
              it.path === '/' ? pathname === '/' : pathname.startsWith(it.path)
            );
            return (
              <li key={entry.group} style={{ marginTop: i > 0 ? '0.5rem' : 0 }}>
                <button
                  onClick={() => toggleGroup(entry.group)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '0.35rem 0.85rem', border: 'none', background: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
                    color: groupActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                  }}
                >
                  {entry.group}
                  {open
                    ? <ChevronDown size={11} />
                    : <ChevronRight size={11} />}
                </button>
                {open && (
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.1rem', paddingLeft: '0.25rem' }}>
                    {entry.items.map(renderItem)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div style={{ padding: '1rem', borderTop: '1px solid var(--glass-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>
            🧬
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName || 'Lab Member'}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{userRole === 'ADMIN' ? 'Administrator' : 'Lab Member'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
