'use client';
import { useState, useTransition } from 'react';
import { inviteMember, resendInvite, upgradeSeatLimit, testSmtp } from '@/app/actions/team';
import { blockUser, removeUser, restoreUser } from '@/app/actions/auth';
import { UserPlus, Mail, RefreshCw, UserX, UserCheck, ChevronUp, X } from 'lucide-react';

type Seats = { seatLimit: number; used: number; remaining: number; plan: string; companyName: string };
type User  = { id: string; name: string; email: string; role: string; status: string; createdAt: Date };
type Invite = { id: string; code: string; email: string | null; name: string | null; expiresAt: Date | null; emailSent: boolean; createdBy: { name: string } };

const PLANS = [
  { key: 'starter',    label: 'Starter',    seats: 5  },
  { key: 'pro',        label: 'Pro',         seats: 15 },
  { key: 'enterprise', label: 'Enterprise',  seats: 50 },
];

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'var(--accent-green)', BLOCKED: 'var(--accent-orange)', REMOVED: 'var(--accent-red)' };

export default function TeamClient({ seats, users, invites, currentUserId }: {
  seats: Seats; users: User[]; invites: Invite[]; currentUserId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [showInvite, setShowInvite] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showSmtpTest, setShowSmtpTest] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smtpTestResult, setSmtpTestResult] = useState<{ success?: boolean; message?: string; error?: string } | null>(null);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteResult, setInviteResult] = useState<{ email?: string; code?: string; error?: string; success?: boolean; inviteLink?: string; emailError?: string } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState(seats.plan);
  const [customSeats, setCustomSeats] = useState(String(seats.seatLimit));

  const act = (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>) => {
    startTransition(async () => {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => fd.append(k, v));
      await fn(fd);
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const fd = new FormData();
      fd.append('email', inviteEmail);
      fd.append('name', inviteName);
      const res = await inviteMember(fd) as any;
      if (res?.success) { 
        setInviteResult({ ...res, email: inviteEmail });
        setInviteEmail(''); 
        setInviteName(''); 
      } else {
        setInviteResult(res);
      }
    });
  };

  const handleSmtpTest = (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpTesting(true);
    setSmtpTestResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append('to', smtpTestEmail);
      const res = await testSmtp(fd) as any;
      setSmtpTestResult(res);
      setSmtpTesting(false);
    });
  };

  const handleUpgrade = (e: React.FormEvent) => {
    e.preventDefault();
    const plan = PLANS.find(p => p.key === selectedPlan);
    const limit = plan ? plan.seats : parseInt(customSeats);
    act(upgradeSeatLimit, { seatLimit: String(limit), plan: selectedPlan });
    setShowUpgrade(false);
  };

  const pct = Math.round((seats.used / seats.seatLimit) * 100);
  const barColor = pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-orange)' : 'var(--accent-green)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* Seat Usage Card */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>License &amp; Seats</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{seats.companyName} · {seats.plan.charAt(0).toUpperCase() + seats.plan.slice(1)} Plan</p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem' }}>
            <button onClick={() => { setShowSmtpTest(true); setSmtpTestResult(null); setSmtpTestEmail(''); }} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Mail size={14} /> Test Email
            </button>
            <button onClick={() => setShowUpgrade(true)} className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <ChevronUp size={14} /> Upgrade Plan
            </button>
            <button onClick={() => { setShowInvite(true); setInviteResult(null); }} disabled={seats.remaining <= 0} className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <UserPlus size={14} /> Invite Member
            </button>
          </div>
        </div>

        {seats.remaining === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--accent-orange)', marginTop: '0.6rem' }}>
            Seat limit reached. Upgrade your plan to invite more members.
          </p>
        ) : (
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Quick Invite</div>
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.75rem' }}>
              <input 
                type="email" 
                value={inviteEmail} 
                onChange={e => setInviteEmail(e.target.value)} 
                required 
                className="input-control" 
                placeholder="member@lab.com" 
                style={{ flex: 1, padding: '0.45rem 0.75rem', fontSize: '0.85rem' }} 
              />
              <button type="submit" disabled={!inviteEmail || isPending} className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Mail size={14} /> {isPending ? 'Sending…' : 'Send Invite'}
              </button>
            </form>
            {inviteResult?.success && (
              <p style={{ fontSize: '0.78rem', color: 'var(--accent-green)', marginTop: '0.5rem', fontWeight: 600 }}>✓ Invite sent to {inviteResult.email || 'member'}</p>
            )}
            {inviteResult?.error && (
              <p style={{ fontSize: '0.78rem', color: 'var(--accent-red)', marginTop: '0.5rem' }}>⚠ {inviteResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Active Members */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1.1rem' }}>
          Active Members <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>({users.filter(u => u.status !== 'REMOVED').length})</span>
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {users.map(u => {
            const isMe = u.id === currentUserId;
            return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem 1rem', background: isMe ? 'var(--accent-blue-15)' : 'var(--bg-primary)', border: `1px solid ${isMe ? 'var(--accent-blue-glow)' : 'var(--glass-border)'}`, borderRadius: '10px', opacity: u.status === 'REMOVED' ? 0.5 : 1 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.95rem', flexShrink: 0 }}>🧬</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {u.name} {isMe && <span style={{ fontSize: '0.62rem', color: 'var(--accent-blue)' }}>(you)</span>}
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: u.role === 'ADMIN' ? 'var(--accent-purple)' : 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.1rem 0.4rem', borderRadius: 4, border: '1px solid var(--glass-border)' }}>{u.role}</span>
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{u.email}</div>
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: STATUS_COLOR[u.status] ?? 'var(--text-muted)', padding: '0.15rem 0.5rem', borderRadius: 4, background: `${STATUS_COLOR[u.status] ?? '#888'}15`, flexShrink: 0 }}>
                  {u.status}
                </span>
                {!isMe && (
                  <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                    {u.status === 'ACTIVE' && <Btn icon={<UserX size={12} />} label="Block" color="var(--accent-orange)" onClick={() => act(blockUser, { userId: u.id })} disabled={isPending} />}
                    {u.status === 'ACTIVE' && <Btn icon={<UserX size={12} />} label="Remove" color="var(--accent-red)" onClick={() => act(removeUser, { userId: u.id })} disabled={isPending} />}
                    {(u.status === 'BLOCKED' || u.status === 'REMOVED') && <Btn icon={<UserCheck size={12} />} label="Restore" color="var(--accent-green)" onClick={() => act(restoreUser, { userId: u.id })} disabled={isPending} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1.1rem' }}>
            Pending Invites <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>({invites.length})</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {invites.map(inv => {
              const expired = inv.expiresAt && inv.expiresAt < new Date();
              return (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: '10px', opacity: expired ? 0.5 : 1 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(88,166,255,0.1)', border: '1px solid var(--accent-blue-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>✉️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{inv.name || inv.email || 'Unknown'}</div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{inv.email} · Code: <code style={{ fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{inv.code}</code></div>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: expired ? 'var(--accent-red)' : 'var(--accent-orange)', fontWeight: 600, flexShrink: 0 }}>
                    {expired ? 'Expired' : 'Pending'}
                  </span>
                  {!expired && (
                    <Btn icon={<RefreshCw size={12} />} label="Resend" color="var(--accent-blue)" onClick={() => act(resendInvite, { id: inv.id })} disabled={isPending} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <Modal title="Invite Member" onClose={() => setShowInvite(false)}>
          <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {inviteResult?.error && <ErrorBox>{inviteResult.error}</ErrorBox>}
            {inviteResult?.success && (
              <div style={{ padding: '0.75rem', background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 8, fontSize: '0.85rem' }}>
                <div style={{ color: 'var(--accent-green)', fontWeight: 600, marginBottom: '0.35rem' }}>
                  ✓ Invite created! Code: <code style={{ fontFamily: 'monospace' }}>{inviteResult.code}</code>
                </div>
                {inviteResult.emailError ? (
                  <div style={{ marginTop: '0.4rem' }}>
                    <div style={{ color: '#f59e0b', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                      ⚠ Email delivery failed — share this link manually:
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <code style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#0369a1', background: '#f0f9ff', padding: '0.2rem 0.4rem', borderRadius: 4, wordBreak: 'break-all', flex: 1 }}>
                        {inviteResult.inviteLink}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(inviteResult.inviteLink ?? '')}
                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 4, border: '1px solid #bae6fd', background: '#f0f9ff', cursor: 'pointer', flexShrink: 0, color: '#0369a1' }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      SMTP error: {inviteResult.emailError}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Invite email sent successfully.
                  </div>
                )}
              </div>
            )}
            <Field label="Name (optional)">
              <input value={inviteName} onChange={e => setInviteName(e.target.value)} className="input-control" placeholder="Dr. John Doe" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.88rem' }} />
            </Field>
            <Field label="Email *">
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required className="input-control" placeholder="member@lab.com" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.88rem' }} />
            </Field>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.6rem 0.75rem', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
              An email with the invite code and registration link will be sent. If SMTP is not configured, check the server console for the invite link.
            </div>
            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowInvite(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={!inviteEmail || isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Mail size={14} /> {isPending ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Test SMTP Modal */}
      {showSmtpTest && (
        <Modal title="Test Email Delivery" onClose={() => setShowSmtpTest(false)}>
          <form onSubmit={handleSmtpTest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.65rem 0.85rem', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--glass-border)', lineHeight: 1.5 }}>
              Sends a test email to verify your SMTP configuration (Office 365). Requires <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-blue)' }}>SMTP_HOST</code>, <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-blue)' }}>SMTP_USER</code>, and <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-blue)' }}>SMTP_PASS</code> to be set in <code style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-blue)' }}>.env</code>.
            </div>
            {smtpTestResult?.error && <ErrorBox>{smtpTestResult.error}</ErrorBox>}
            {smtpTestResult?.success && (
              <div style={{ padding: '0.75rem', background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--accent-green)' }}>
                ✓ {smtpTestResult.message}
              </div>
            )}
            <Field label="Send test email to">
              <input type="email" value={smtpTestEmail} onChange={e => setSmtpTestEmail(e.target.value)} className="input-control" placeholder="your@lab.com (leave blank to use SMTP_USER)" style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.88rem' }} />
            </Field>
            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowSmtpTest(false)} className="btn btn-secondary">Close</button>
              <button type="submit" disabled={smtpTesting || isPending} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Mail size={14} /> {smtpTesting ? 'Sending…' : 'Send Test Email'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Upgrade Modal */}
      {showUpgrade && (
        <Modal title="Upgrade Plan" onClose={() => setShowUpgrade(false)}>
          <form onSubmit={handleUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {PLANS.map(p => (
                <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', border: `2px solid ${selectedPlan === p.key ? 'var(--accent-blue)' : 'var(--glass-border)'}`, borderRadius: 10, cursor: 'pointer', background: selectedPlan === p.key ? 'var(--accent-blue-15)' : 'var(--bg-primary)' }}>
                  <input type="radio" name="plan" value={p.key} checked={selectedPlan === p.key} onChange={() => { setSelectedPlan(p.key); setCustomSeats(String(p.seats)); }} style={{ display: 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Up to {p.seats} users</div>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: selectedPlan === p.key ? 'var(--accent-blue)' : 'var(--text-muted)' }}>{p.seats} seats</div>
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', border: `2px solid ${selectedPlan === 'custom' ? 'var(--accent-purple)' : 'var(--glass-border)'}`, borderRadius: 10, cursor: 'pointer', background: selectedPlan === 'custom' ? 'rgba(124,58,237,0.08)' : 'var(--bg-primary)' }}>
                <input type="radio" name="plan" value="custom" checked={selectedPlan === 'custom'} onChange={() => setSelectedPlan('custom')} style={{ display: 'none' }} />
                <div style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>Custom</div>
                <input type="number" min={1} max={999} value={customSeats} onChange={e => setCustomSeats(e.target.value)} onClick={() => setSelectedPlan('custom')} className="input-control" style={{ width: 70, padding: '0.35rem 0.5rem', fontSize: '0.85rem', textAlign: 'center' }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>seats</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowUpgrade(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={isPending} className="btn btn-primary">Apply</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 460, padding: '2rem', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, color: 'var(--accent-red)', fontSize: '0.83rem' }}>{children}</div>;
}

function Btn({ icon, label, color, onClick, disabled }: { icon: React.ReactNode; label: string; color: string; onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', fontWeight: 600, padding: '0.28rem 0.55rem', borderRadius: 6, cursor: 'pointer', border: `1px solid ${color}20`, background: `${color}10`, color, opacity: disabled ? 0.6 : 1 }}>
      {icon} {label}
    </button>
  );
}
