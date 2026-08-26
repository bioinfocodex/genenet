import Link from 'next/link';
import { Dna, Monitor, Apple, Terminal, Download, ArrowRight } from 'lucide-react';
import { readFileSync } from 'fs';
import path from 'path';

const VERSION = '1.0.0';

function getManifest(): Record<string, { size: number; built: string }> {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'public/releases/manifest.json'), 'utf8');
    const arr: { file: string; size: number; built: string }[] = JSON.parse(raw);
    return Object.fromEntries(arr.map(e => [e.file, e]));
  } catch { return {}; }
}

function fmtSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

type Platform = {
  name: string; icon: React.ElementType; file: string; label: string;
  note: string; color: string; bg: string; border: string;
  href: string; available: boolean;
};

const PLATFORMS: Platform[] = [
  {
    name: 'Windows',
    icon: Monitor,
    file: `GeneNet-Setup-${VERSION}.exe`,
    label: 'Download for Windows',
    note: '.exe installer · Windows 10/11',
    color: 'var(--accent-blue)',
    bg: 'var(--accent-blue-15)',
    border: 'var(--accent-blue-glow)',
    href: `/releases/GeneNet-Setup-${VERSION}.exe`,
    available: true,
  },
  {
    name: 'macOS',
    icon: Apple,
    file: `GeneNet-${VERSION}.dmg`,
    label: 'Download for macOS',
    note: '.dmg installer · macOS 12+',
    color: 'var(--accent-purple)',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.2)',
    href: `/releases/GeneNet-${VERSION}.dmg`,
    available: true,
  },
  {
    name: 'Linux',
    icon: Terminal,
    file: `GeneNet-${VERSION}.AppImage`,
    label: 'Download for Linux',
    note: '.AppImage · Ubuntu, Fedora, Debian',
    color: 'var(--accent-green)',
    bg: 'rgba(5,150,105,0.08)',
    border: 'rgba(5,150,105,0.2)',
    href: `/releases/GeneNet-${VERSION}.AppImage`,
    available: true,
  },
];

const STEPS = [
  { n: 1, title: 'Download the installer', desc: 'Choose your operating system above and download the installer.' },
  { n: 2, title: 'Run the installer', desc: 'Open the downloaded file. On macOS, drag GeneNet to Applications. On Windows, run the .exe setup wizard.' },
  { n: 3, title: 'Launch GeneNet', desc: 'Open the app. On first launch, you\'ll see the Connect to Lab screen.' },
  { n: 4, title: 'Enter your connection code', desc: 'Get a connection code (e.g. LAB-84921) from your lab administrator and enter it in the app.' },
  { n: 5, title: 'Create or sign in to your account', desc: 'Register with an invite code or sign in to your existing account.' },
  { n: 6, title: 'You\'re in!', desc: 'Your app connects to the central lab system. You\'ll stay connected until your admin removes access or you log out.' },
];

export default function DownloadPage() {
  const manifest = getManifest();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1rem' }}>
            <Dna size={32} color="var(--accent-blue)" />
            <span className="title-gradient" style={{ fontSize: '2rem', fontWeight: 800 }}>GeneNet</span>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Download & Connect
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Version {VERSION} · Cross-platform lab management software
          </p>
        </div>

        {/* Download cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', marginBottom: '3rem' }}>
          {PLATFORMS.map(p => {
            const Icon = p.icon;
            const meta = manifest[p.file];
            return (
              <div key={p.name} className="glass-panel" style={{ padding: '1.75rem', textAlign: 'center', border: `1px solid ${p.border}`, opacity: p.available ? 1 : 0.6 }}>
                <div style={{ width: 52, height: 52, borderRadius: '14px', background: p.bg, border: `1px solid ${p.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <Icon size={24} color={p.color} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.2rem' }}>{p.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: meta ? '0.3rem' : '1.25rem' }}>{p.note}</div>
                {meta && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>{fmtSize(meta.size)} · v{VERSION}</div>}
                {p.available ? (
                  <a href={p.href} download
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
                      textDecoration: 'none', transition: 'all 0.15s',
                    }}>
                    <Download size={14} /> {p.label}
                  </a>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
                    Coming Soon
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Connect to Lab */}
        <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowRight size={18} color="var(--accent-blue)" /> Already have a connection code?
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1rem' }}>
            Enter your connection code directly in the web app without downloading.
          </p>
          <Link href="/connect" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem' }}>
            <ArrowRight size={15} /> Connect via Browser
          </Link>
        </div>

        {/* Installation steps */}
        <div className="glass-panel" style={{ padding: '1.75rem', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Installation Guide</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {STEPS.map(s => (
              <div key={s.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 800, flexShrink: 0, marginTop: '0.1rem' }}>
                  {s.n}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{s.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.83rem' }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System requirements */}
        <div className="glass-panel" style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>System Requirements</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {[
              { os: 'Windows', req: 'Windows 10 or later (64-bit)' },
              { os: 'macOS', req: 'macOS 12 Monterey or later' },
              { os: 'Linux', req: 'Ubuntu 20.04+, Fedora 35+, or Debian 11+' },
              { os: 'Network', req: 'Internet or local network access to lab server' },
            ].map(r => (
              <div key={r.os} style={{ padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{r.os}</div>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>{r.req}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
