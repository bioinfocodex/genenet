'use client';
import { useState, useTransition } from 'react';
import { setupWorkspace } from '@/app/actions/auth';
import { Dna, Server, HardDrive, Cloud, Network, ChevronRight, ChevronLeft, Check } from 'lucide-react';

type StorageType = 'local' | 'network' | 'cloud' | 'onedrive' | 'shared';

const PLANS = [
  { key: 'starter',    label: 'Starter',    seats: 5,  desc: 'Up to 5 users — ideal for small labs' },
  { key: 'pro',        label: 'Pro',         seats: 15, desc: 'Up to 15 users — growing research teams' },
  { key: 'enterprise', label: 'Enterprise',  seats: 50, desc: 'Up to 50 users — large institutions' },
];

const STORAGE_OPTIONS: { id: StorageType; icon: React.ReactNode; label: string; sub: string; showPath: boolean }[] = [
  { id: 'local',   icon: <HardDrive size={22} />, label: 'This Computer',             sub: 'Store everything locally. Best for single-machine setups.',                                                        showPath: false },
  { id: 'onedrive', icon: <Cloud size={22} />,    label: 'OneDrive / Google Drive',   sub: 'Keep uploaded files in your sync folder. The database stays on this computer.',                                   showPath: true  },
  { id: 'network', icon: <Network size={22} />,   label: 'Network Drive / NAS',       sub: 'Keep uploaded files on a shared LAN drive. The database stays on this computer.',                                 showPath: true  },
  { id: 'cloud',   icon: <Server size={22} />,    label: 'Cloud / Remote Database',   sub: 'Use a hosted PostgreSQL or remote database URL. Best for internet-accessible deployments.',                       showPath: false },
];

const STEPS = ['Storage', 'Configure', 'License', 'Admin'];

export default function SetupPage() {
  const [step, setStep]               = useState(0);
  const [storageType, setStorageType] = useState<StorageType>('local');
  const [storagePath, setStoragePath] = useState('');
  const [storageNote, setStorageNote] = useState('');
  const [serverUrl, setServerUrl]     = useState('');
  const [plan, setPlan]               = useState('starter');
  const [error, setError]             = useState('');
  const [, startTransition]           = useTransition();

  const option = STORAGE_OPTIONS.find(o => o.id === storageType)!;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    fd.append('storageType', storageType);
    fd.append('storagePath', storagePath);
    fd.append('storageNote', storageNote);
    fd.append('serverUrl', serverUrl);
    fd.append('plan', plan);
    const selectedPlan = PLANS.find(p => p.key === plan);
    fd.append('seatLimit', String(selectedPlan?.seats ?? 5));
    startTransition(async () => {
      const result = await setupWorkspace(undefined, fd);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', backgroundImage: 'radial-gradient(ellipse at top right, rgba(37,99,235,0.1), transparent 50%), radial-gradient(ellipse at bottom left, rgba(124,58,237,0.1), transparent 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 580, width: '100%' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 56, height: 56, borderRadius: '14px', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <Dna size={28} color="white" />
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'Outfit, sans-serif', marginBottom: '0.3rem' }}>GeneNet Setup</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Configure your central lab server — takes less than 2 minutes.</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: '2rem' }}>
          {STEPS.map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: i < step ? 'var(--accent-green)' : i === step ? 'var(--accent-blue)' : 'var(--bg-primary)', border: `2px solid ${i < step ? 'var(--accent-green)' : i === step ? 'var(--accent-blue)' : 'var(--glass-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: i <= step ? 'white' : 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 700, transition: 'all 0.2s' }}>
                  {i < step ? <Check size={14} /> : i + 1}
                </div>
                <span style={{ fontSize: '0.68rem', color: i === step ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: i === step ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ width: 60, height: 2, background: i < step ? 'var(--accent-green)' : 'var(--glass-border)', margin: '0 0.5rem', marginBottom: '1.2rem', transition: 'background 0.2s' }} />}
            </div>
          ))}
        </div>

        <div className="glass-panel" style={{ padding: '2rem' }}>

          {/* ── Step 0: Storage Type ── */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Where should data be stored?</h2>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                All lab data lives on <strong>this server</strong>. Team members connect via browser — no installation needed on their side.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {STORAGE_OPTIONS.map(opt => (
                  <button key={opt.id} onClick={() => setStorageType(opt.id)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', borderRadius: 10, border: `2px solid ${storageType === opt.id ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: storageType === opt.id ? 'var(--accent-blue-15)' : 'var(--bg-primary)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%' }}>
                    <div style={{ color: storageType === opt.id ? 'var(--accent-blue)' : 'var(--text-muted)', flexShrink: 0 }}>{opt.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{opt.label}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{opt.sub}</div>
                    </div>
                    {storageType === opt.id && <Check size={18} color="var(--accent-blue)" />}
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(1)} className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                Continue <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* ── Step 1: Path & URL ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Configure Storage</h2>

              {storageType === 'local' && (
                <div style={{ padding: '0.9rem 1rem', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <HardDrive size={14} style={{ display: 'inline', marginRight: '0.35rem' }} />
                  All data will be stored in the <code style={{ background: 'var(--bg-primary)', padding: '0.1rem 0.3rem', borderRadius: 3, border: '1px solid var(--glass-border)' }}>prisma/dev.db</code> file on this machine.
                </div>
              )}

              {storageType === 'onedrive' && (
                <F label="Sync Folder Path *">
                  <input value={storagePath} onChange={e => setStoragePath(e.target.value)} required className="input-control"
                    placeholder="e.g. /Users/you/OneDrive - Company/GeneNet  or  C:\Users\you\OneDrive\GeneNet" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Enter the full path to a folder inside your OneDrive/Google Drive/Dropbox sync folder. Uploads, releases and backups are kept there.
                    {' '}The database itself stays on this computer. A live SQLite file in a sync folder gets corrupted, and if two machines open it at once the sync client keeps one copy and quietly renames the other, losing whichever set of experiments synced first.
                    {' '}To put the whole team in one workspace, run GeneNet on one machine and have everyone else connect to it from the Connect screen.
                  </span>
                </F>
              )}

              {storageType === 'network' && (
                <F label="Network Drive Path *">
                  <input value={storagePath} onChange={e => setStoragePath(e.target.value)} required className="input-control" placeholder="e.g. /mnt/lab-nas/GeneNet  or  \\\\192.168.1.5\\LabShare\\GeneNet" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mount the network drive first. Database and uploads will be stored here.</span>
                </F>
              )}

              {storageType === 'cloud' && (
                <div style={{ padding: '0.9rem 1rem', background: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <Server size={14} style={{ display: 'inline', marginRight: '0.35rem' }} />
                  Set <code style={{ background: 'var(--bg-primary)', padding: '0.1rem 0.3rem', borderRadius: 3, border: '1px solid var(--glass-border)' }}>DATABASE_URL</code> in your <code>.env</code> to your remote database URL before starting. PostgreSQL recommended (Supabase, Railway, Neon).
                </div>
              )}

              <F label="Server URL (how your team accesses the app)">
                <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} className="input-control" placeholder="e.g. http://192.168.1.10:3000  or  https://lab.company.com" />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Optional — auto-detected from your network if left blank. Used in connection instructions.</span>
              </F>

              <F label="Storage Note (shown to all users)">
                <input value={storageNote} onChange={e => setStorageNote(e.target.value)} className="input-control" placeholder='e.g. "Backed up nightly to NAS at 192.168.1.5"' />
              </F>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => setStep(0)} className="btn btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <ChevronLeft size={15} /> Back
                </button>
                <button onClick={() => setStep(2)} className="btn btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  Continue <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: License Plan ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Choose a License Plan</h2>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                Select how many users (seats) your lab needs. You can upgrade later from the Admin Panel.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {PLANS.map(p => (
                  <button key={p.key} onClick={() => setPlan(p.key)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', borderRadius: 10, border: `2px solid ${plan === p.key ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: plan === p.key ? 'var(--accent-blue-15)' : 'var(--bg-primary)', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.15rem' }}>{p.label}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{p.desc}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: plan === p.key ? 'var(--accent-blue)' : 'var(--text-muted)', flexShrink: 0 }}>{p.seats} seats</div>
                    {plan === p.key && <Check size={18} color="var(--accent-blue)" />}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => setStep(1)} className="btn btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <ChevronLeft size={15} /> Back
                </button>
                <button onClick={() => setStep(3)} className="btn btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  Continue <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Admin Account ── */}
          {step === 3 && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Create Admin Account</h2>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                This becomes the administrator of the workspace. A unique System ID and Connection Code are auto-generated.
              </p>

              {error && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.88rem' }}>{error}</div>
              )}

              <F label="Workspace / Lab Name" required>
                <input name="workspaceName" required defaultValue="GeneNet Lab" className="input-control" placeholder="e.g. Smith Lab · GeneNet" />
              </F>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <F label="Your Name" required>
                  <input name="adminName" required className="input-control" placeholder="Dr. Jane Smith" />
                </F>
                <F label="Email" required>
                  <input name="email" type="email" required className="input-control" placeholder="admin@yourlab.com" />
                </F>
              </div>

              <F label="Password (min. 8 characters)" required>
                <input name="password" type="password" required className="input-control" placeholder="••••••••" />
              </F>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={() => setStep(2)} className="btn btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  <ChevronLeft size={15} /> Back
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.95rem' }}>
                  🚀 Create Workspace
                </button>
              </div>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1.25rem' }}>
          Already set up? <a href="/login" style={{ color: 'var(--accent-blue)' }}>Log in</a>
        </p>
      </div>
    </div>
  );
}

function F({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
        {label}{required && <span style={{ color: 'var(--accent-red)' }}> *</span>}
      </label>
      {children}
    </div>
  );
}
