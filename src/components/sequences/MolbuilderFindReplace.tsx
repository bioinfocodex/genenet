'use client';
import React, { useState } from 'react';
import { 
  Search, 
  Replace, 
  ArrowRight, 
  ArrowLeft, 
  X,
  Type,
  Dna
} from 'lucide-react';

interface MolbuilderFindReplaceProps {
  onFind: (query: string, options: any) => void;
  onReplace: (query: string, replace: string, options: any) => void;
  onClose: () => void;
  currentMatch?: number;
  totalMatches?: number;
}

export default function MolbuilderFindReplace({
  onFind,
  onReplace,
  onClose,
  currentMatch = 0,
  totalMatches = 0
}: MolbuilderFindReplaceProps) {
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [matchType, setMatchType] = useState<'dna' | 'aa'>('dna');

  const handleSearch = (q: string) => {
    setQuery(q);
    onFind(q, { matchCase, matchType });
  };

  return (
    <div className="animate-fade-in" style={{ 
      padding: '0.75rem 1.25rem', 
      background: '#fcfdfe', 
      borderBottom: '1px solid var(--seq-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={`Find ${matchType === 'dna' ? 'DNA motif...' : 'Amino acids...'}`}
            style={{
              width: '100%',
              padding: '0.5rem 2.5rem 0.5rem 2.2rem',
              borderRadius: '8px',
              border: '1px solid var(--seq-border)',
              fontSize: '0.85rem',
              fontFamily: matchType === 'dna' ? 'var(--seq-font)' : 'inherit',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-blue)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--seq-border)'}
          />
          {query && (
            <div style={{ position: 'absolute', right: '0.8rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8' }}>
              {totalMatches > 0 ? `${currentMatch + 1} of ${totalMatches}` : 'No matches'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'white', padding: '0.2rem', borderRadius: '8px', border: '1px solid var(--seq-border)' }}>
          <button 
            onClick={() => setMatchType('dna')}
            style={{ 
              padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none', fontSize: '0.72rem', fontWeight: 700, 
              cursor: 'pointer', background: matchType === 'dna' ? 'var(--accent-blue-15)' : 'transparent',
              color: matchType === 'dna' ? 'var(--accent-blue)' : '#64748b'
            }}
          > DNA </button>
          <button 
            onClick={() => setMatchType('aa')}
            style={{ 
              padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none', fontSize: '0.72rem', fontWeight: 700, 
              cursor: 'pointer', background: matchType === 'aa' ? 'var(--accent-purple-10)' : 'transparent',
              color: matchType === 'aa' ? 'var(--accent-purple)' : '#64748b'
            }}
          > AA </button>
        </div>

        <div style={{ height: '24px', width: '1px', background: 'var(--seq-border)', margin: '0 0.25rem' }} />

        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <NavBtn icon={<ArrowLeft size={16} />} onClick={() => {}} disabled={totalMatches === 0} />
          <NavBtn icon={<ArrowRight size={16} />} onClick={() => {}} disabled={totalMatches === 0} />
        </div>

        <button 
          onClick={() => setShowReplace(!showReplace)}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', borderRadius: '8px', 
            border: 'none', background: showReplace ? 'var(--accent-blue-15)' : 'transparent', 
            color: showReplace ? 'var(--accent-blue)' : '#1e293b', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600
          }}
        >
          <Replace size={14} />
          <span>Replace</span>
        </button>

        <button onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>
          <X size={18} />
        </button>
      </div>

      {showReplace && (
        <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.25rem 0' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
            <Replace size={14} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replace with..."
              style={{
                width: '100%',
                padding: '0.5rem 1rem 0.5rem 2.2rem',
                borderRadius: '8px',
                border: '1px solid var(--seq-border)',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>
          <button 
            onClick={() => onReplace(query, replace, { matchCase, matchType })}
            style={{ 
              padding: '0.5rem 1.25rem', borderRadius: '8px', border: 'none', 
              background: 'var(--accent-blue)', color: 'white', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700
            }}
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}

function NavBtn({ icon, onClick, disabled }: { icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      style={{ 
        padding: '0.35rem', borderRadius: '6px', border: '1px solid var(--seq-border)', 
        background: 'white', color: disabled ? '#cbd5e1' : '#1e293b', 
        cursor: disabled ? 'default' : 'pointer', transition: 'all 0.1s'
      }}
    >
      {icon}
    </button>
  );
}
