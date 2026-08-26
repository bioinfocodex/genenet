import React from 'react';

const LADDER_BANDS = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 800, 600, 500, 400, 300, 200, 100];

// A logarithmic interpolation so larger fragments bunch up at the top like in a real agarose gel.
const getLogPos = (bp: number) => {
  const minLog = Math.log10(100);
  const maxLog = Math.log10(10000);
  const logBp = Math.log10(Math.max(100, Math.min(bp, 10000)));
  const percentage = 90 - ((logBp - minLog) / (maxLog - minLog)) * 80;
  return percentage;
};

export default function ExpectedGel({ bands }: { bands: number[] }) {
  return (
    <div style={{ background: '#111827', padding: '1.5rem', borderRadius: '12px', display: 'flex', gap: '2rem', color: '#e5e7eb', width: '280px', margin: '1rem 0', border: '1px solid var(--glass-border)', boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.5)' }}>
      {/* Ladder Lane */}
      <div style={{ position: 'relative', width: '50px', height: '300px', borderRight: '1px solid #374151' }}>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.5rem', marginLeft: '10px' }}>1kb Ladder</div>
        <div style={{ position: 'absolute', top: '25px', left: '15px', right: '15px', bottom: '0', background: 'rgba(0,0,0,0.4)', borderRadius: '4px' }}></div>
        {LADDER_BANDS.map(bp => (
          <div key={bp} style={{ position: 'absolute', top: `${getLogPos(bp)}%`, left: '20px', width: '20px', height: '3px', background: bp === 1000 || bp === 3000 ? 'rgba(56, 189, 248, 0.8)' : 'rgba(156, 163, 175, 0.4)', borderRadius: '2px', boxShadow: bp === 1000 || bp === 3000 ? '0 0 6px rgba(56, 189, 248, 0.5)' : 'none' }}>
             {bp === 10000 || bp === 3000 || bp === 1000 || bp === 100 ? (
               <span style={{ position: 'absolute', left: '-35px', top: '-6px', fontSize: '0.65rem', color: '#6b7280', fontFamily: 'monospace' }}>
                 {bp > 999 ? `${bp/1000}kb` : bp}
               </span>
             ) : null}
          </div>
        ))}
      </div>

      {/* Target Lane */}
      <div style={{ position: 'relative', width: '100px', height: '300px' }}>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: '#60a5fa', marginBottom: '0.5rem', fontWeight: 600 }}>Expected Size</div>
        <div style={{ position: 'absolute', top: '25px', left: '10px', right: '10px', bottom: '0px', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}></div>
        {bands.map((bp, i) => (
          <div key={i} style={{ position: 'absolute', top: `${getLogPos(bp)}%`, left: '20px', width: '60px', height: '4px', background: '#38bdf8', borderRadius: '2px', boxShadow: '0 0 12px #38bdf8, 0 0 4px white' }}>
            <span style={{ position: 'absolute', right: '-45px', top: '-6px', fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8', fontFamily: 'monospace' }}>
               {bp}bp
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
