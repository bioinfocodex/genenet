'use client';
import { useState, useEffect, useTransition } from 'react';
import { Copy, Check, RefreshCw, Wifi, Server, Key, Globe } from 'lucide-react';
import { regenerateConnectionCode } from '@/app/actions/auth';

interface Props {
  systemId:       string | null;
  connectionCode: string | null;
  storageType:    string;
  storagePath:    string | null;
  storageNote:    string | null;
  serverUrl:      string | null;
  isAdmin:        boolean;
}

export default function ConnectionInfo({ systemId, connectionCode, storageType, storagePath, storageNote, serverUrl, isAdmin }: Props) {
  const [copied, setCopied]   = useState<string | null>(null);
  const [ips, setIps]         = useState<{ name: string; address: string }[]>([]);
  const [hostname, setHostname] = useState('');
  const [, startTransition]   = useTransition();

  useEffect(() => {
    fetch('/api/network-info').then(r => r.json()).then(d => { setIps(d.ips); setHostname(d.hostname); }).catch(() => {});
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  };

  const regenerate = () => {
    const fd = new FormData();
    startTransition(() => { regenerateConnectionCode(); });
  };

  // Determine best connection URL
  const detectedUrl = ips[0] ? `http://${ips[0].address}:3000` : null;
  const displayUrl  = serverUrl || detectedUrl || 'Run: npm start, then share your IP';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Connection credentials */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <CredBox
          icon={<Key size={16} color="var(--accent-blue)" />}
          label="System ID"
          value={systemId ?? '—'}
          mono
          onCopy={() => systemId && copy(systemId, 'sid')}
          copied={copied === 'sid'}
        />
        <CredBox
          icon={<Server size={16} color="var(--accent-purple)" />}
          label="Connection Code"
          value={connectionCode ?? '—'}
          mono
          onCopy={() => connectionCode && copy(connectionCode, 'code')}
          copied={copied === 'code'}
          action={isAdmin ? (
            <button onClick={regenerate} title="Regenerate" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '0.2rem' }}>
              <RefreshCw size={13} />
            </button>
          ) : undefined}
        />
      </div>

      {/* Connection URL */}
      <div style={{ padding: '1rem', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <Globe size={15} color="var(--accent-blue)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Team Connection URL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <code style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-blue)', background: 'white', padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--glass-border)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {displayUrl}
          </code>
          <button onClick={() => copy(displayUrl, 'url')} style={{ flexShrink: 0, padding: '0.5rem', background: copied === 'url' ? 'rgba(5,150,105,0.1)' : 'white', border: `1px solid ${copied === 'url' ? 'var(--accent-green)' : 'var(--glass-border)'}`, borderRadius: 6, cursor: 'pointer', display: 'flex', color: copied === 'url' ? 'var(--accent-green)' : 'var(--text-muted)', transition: 'all 0.15s' }}>
            {copied === 'url' ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5, margin: '0.5rem 0 0' }}>
          Share this URL with team members. They open it in any browser — no installation needed.
        </p>
      </div>

      {/* Detected LAN IPs */}
      {ips.length > 0 && (
        <div style={{ padding: '1rem', background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Wifi size={15} color="var(--accent-green)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Detected Network IPs</span>
            {hostname && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Host: {hostname}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {ips.map((ip, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: 80 }}>{ip.name}</span>
                <code style={{ fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1 }}>http://{ip.address}:3000</code>
                <button onClick={() => copy(`http://${ip.address}:3000`, `ip${i}`)} style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: 5, padding: '0.2rem 0.4rem', cursor: 'pointer', color: copied === `ip${i}` ? 'var(--accent-green)' : 'var(--text-muted)', display: 'flex' }}>
                  {copied === `ip${i}` ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Storage info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <InfoBox label="Storage Type" value={storageType === 'local' ? 'Local Machine' : storageType === 'network' ? 'Network Drive / NAS' : 'Cloud / Remote DB'} />
        {storagePath && <InfoBox label="Storage Path" value={storagePath} mono />}
        {storageNote && <InfoBox label="Storage Note" value={storageNote} />}
      </div>

      {/* How to connect instructions */}
      <div style={{ padding: '1rem', background: 'rgba(5,150,105,0.05)', border: '1px solid rgba(5,150,105,0.15)', borderRadius: 10, fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>📋 How team members connect:</div>
        <ol style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <li>Open a browser on any computer on the same network</li>
          <li>Go to <strong>{displayUrl}</strong></li>
          <li>Click <em>Register</em> and enter an invite code (generate one in Invite Codes below)</li>
          <li>Log in and start collaborating — all data is stored centrally on this server</li>
        </ol>
      </div>
    </div>
  );
}

function CredBox({ icon, label, value, mono, onCopy, copied, action }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; onCopy?: () => void; copied?: boolean; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '0.9rem 1rem', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {icon}
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>{label}</span>
        {action}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: mono ? '0.08em' : undefined }}>{value}</span>
        {onCopy && (
          <button onClick={onCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--accent-green)' : 'var(--text-muted)', display: 'flex', padding: '0.15rem', transition: 'color 0.15s' }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </div>
    </div>
  );
}

function InfoBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ padding: '0.75rem 0.9rem', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
