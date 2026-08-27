import { prisma } from '@/lib/prisma';
import { getMockUser, getWorkspaceInfo, getWorkspaceSettings, createInvite, revokeInvite } from '@/app/actions/auth';
import { Settings, Users, Link2, Trash2, Server, Network, Scale } from 'lucide-react';
import ConnectionInfo from '@/components/ConnectionInfo';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [user, workspace, wsSettings, allUsers, invites] = await Promise.all([
    getMockUser(),
    getWorkspaceInfo(),
    getWorkspaceSettings(),
    prisma.user.findMany({ where: { status: { not: 'REMOVED' } }, orderBy: { createdAt: 'asc' } }),
    prisma.invite.findMany({ orderBy: { createdAt: 'desc' }, include: { createdBy: true } }),
  ]);

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <h1 className="title-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Settings size={28} /> Workspace Settings
      </h1>

      {/* Workspace info */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Server size={18} /> Workspace
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <InfoRow label="Workspace name" value={workspace?.workspaceName ?? '—'} />
          <InfoRow label="Storage type"   value={wsSettings?.storageType === 'onedrive' ? '☁ OneDrive (Microsoft 365)' : wsSettings?.storageType === 'network' ? 'Network Drive / NAS' : wsSettings?.storageType === 'cloud' ? 'Cloud / Remote DB' : 'Local Machine'} />
          <InfoRow label="Members"        value={`${allUsers.length} account${allUsers.length !== 1 ? 's' : ''}`} />
          <InfoRow label="Your role"      value={user?.role ?? '—'} />
        </div>
      </div>

      {/* OneDrive Storage Status */}
      {wsSettings?.storageType === 'onedrive' && (
        <div className="glass-panel" style={{ padding: '1.75rem', border: '1px solid rgba(88,166,255,0.25)', background: 'rgba(88,166,255,0.04)' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            ☁ OneDrive Storage
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <InfoRow label="Account" value={wsSettings.storageNote ?? 'OneDrive'} />
            <InfoRow label="Storage Path" value={wsSettings.storagePath ?? '—'} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginTop: '0.25rem' }}>
              {[
                { label: 'Database', path: 'database/genenet.db' },
                { label: 'Gel Images', path: 'uploads/gels/' },
                { label: 'Installers', path: 'releases/' },
              ].map(f => (
                <div key={f.label} style={{ padding: '0.65rem 0.9rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{f.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontFamily: 'monospace' }}>✓ Synced</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem', wordBreak: 'break-all' }}>GeneNet/{f.path}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Connection & Network */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Network size={18} /> Connection &amp; Network
        </h2>
        <ConnectionInfo
          systemId={wsSettings?.systemId ?? null}
          connectionCode={wsSettings?.connectionCode ?? null}
          storageType={wsSettings?.storageType ?? 'local'}
          storagePath={wsSettings?.storagePath ?? null}
          storageNote={wsSettings?.storageNote ?? null}
          serverUrl={wsSettings?.serverUrl ?? null}
          isAdmin={isAdmin}
        />
      </div>

      {/* Team members */}
      <div className="glass-panel" style={{ padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={18} /> Team Members
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {allUsers.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 1rem', background: u.id === user?.id ? 'var(--accent-blue-15)' : 'white', border: `1px solid ${u.id === user?.id ? 'var(--accent-blue-glow)' : 'var(--glass-border)'}`, borderRadius: '8px' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0 }}>
                {u.avatar ?? '🧬'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{u.name} {u.id === user?.id && <span style={{ fontSize: '0.68rem', color: 'var(--accent-blue)' }}>(you)</span>}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: u.role === 'ADMIN' ? 'var(--accent-purple)' : 'var(--accent-green)', background: u.role === 'ADMIN' ? 'var(--accent-purple-10)' : 'rgba(5,150,105,0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: `1px solid ${u.role === 'ADMIN' ? 'rgba(124,58,237,0.2)' : 'rgba(5,150,105,0.2)'}` }}>
                {u.role}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Invite codes — admin only */}
      {isAdmin && (
        <div className="glass-panel" style={{ padding: '1.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link2 size={18} /> Invite Codes
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Generate a code and share it with a new team member. They go to <strong>/register</strong> on the app and enter the code to create their account.
          </p>

          {/* Generate form */}
          <form action={createInvite} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem', padding: '1.25rem', background: 'var(--bg-primary)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1, minWidth: '160px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Email (optional)</label>
              <input type="email" name="email" className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }} placeholder="pre-assign to email" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Expires</label>
              <select name="expiresIn" className="input-control" style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="never">Never</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.55rem 1.1rem' }}>
                + Generate Code
              </button>
            </div>
          </form>

          {/* Code list */}
          {invites.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No invite codes yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {invites.map(inv => {
                const expired = inv.expiresAt && inv.expiresAt < new Date();
                const used = !!inv.usedAt;
                return (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 1rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px', opacity: used || expired ? 0.6 : 1 }}>
                    <code style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.12em', color: used || expired ? 'var(--text-muted)' : 'var(--accent-blue)', background: used || expired ? 'var(--bg-primary)' : 'var(--accent-blue-15)', padding: '0.2rem 0.6rem', borderRadius: '6px', flexShrink: 0 }}>
                      {inv.code}
                    </code>
                    <div style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {inv.email && <span>for {inv.email} · </span>}
                      {used ? <span style={{ color: 'var(--accent-green)' }}>✓ Used by {inv.usedByName}</span>
                            : expired ? <span style={{ color: 'var(--accent-red)' }}>Expired</span>
                            : inv.expiresAt ? <span>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                            : <span>No expiry</span>}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>by {inv.createdBy.name}</span>
                    {!used && (
                      <form action={revokeInvite}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button type="submit" title="Revoke" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '0.2rem' }}>
                          <Trash2 size={14} />
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* About. The AGPL asks that people using this over a network be told
          where the source is; this is that notice. */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Scale size={18} /> About GeneNet
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', lineHeight: 1.55 }}>
          Free software under the{' '}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>
            GNU Affero General Public License v3
          </a>. You may run, study, change and share it. If you offer a changed
          version to other people over a network, you must offer them your
          changes too.
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
          Source:{' '}
          <a href="https://github.com/bioinfocodex/genenet" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>
            github.com/bioinfocodex/genenet
          </a>
        </p>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '0.6rem 0.9rem', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
