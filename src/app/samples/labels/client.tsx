'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { encodeCode128, barcodeSvg, fitsLabel } from '@/lib/barcode';

/**
 * Labels, laid out for the stock they will be printed on.
 *
 * Sized in millimetres against real label sheets rather than in pixels,
 * because the only thing that matters here is whether the printed rectangles
 * land on the gummed ones. The CSS `@page` size and margins are what carry
 * that across: a layout that looks right on screen and is 4% out on paper
 * wastes a whole sheet every time.
 */

interface Row { code: string; name: string; where: string }

interface Stock {
  id: string;
  label: string;
  across: number;
  down: number;
  /** Millimetres. */
  width: number; height: number;
  marginTop: number; marginLeft: number;
  gapX: number; gapY: number;
}

/*
 * Two common sheets and one roll. The numbers are the manufacturers' own:
 * 21-up and 24-up A4 address labels are what most labs have in the cupboard,
 * and 25 x 25 mm is the usual cryo-tube roll.
 */
const STOCKS: Stock[] = [
  { id: 'l7160', label: 'A4, 21 per sheet (63.5 × 38.1 mm)', across: 3, down: 7, width: 63.5, height: 38.1, marginTop: 15.1, marginLeft: 7.2, gapX: 2.5, gapY: 0 },
  { id: 'l7159', label: 'A4, 24 per sheet (63.5 × 33.9 mm)', across: 3, down: 8, width: 63.5, height: 33.9, marginTop: 13.1, marginLeft: 7.2, gapX: 2.5, gapY: 0 },
  { id: 'cryo', label: 'Cryo roll, 25 × 25 mm, one across', across: 1, down: 11, width: 25, height: 25, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
];

export default function LabelSheetClient({ samples, asked }: { samples: Row[]; asked: string[] }) {
  const [stockId, setStockId] = useState('l7160');
  const [skip, setSkip] = useState(0);
  const [showWhere, setShowWhere] = useState(true);

  const stock = STOCKS.find(s => s.id === stockId)!;
  const perSheet = stock.across * stock.down;

  /*
   * Blanks before the first label, for a sheet somebody has already used part
   * of. Without this a part-used sheet is a wasted sheet, which is why every
   * label program has had the setting for thirty years.
   */
  const cells = useMemo(
    () => [...Array.from({ length: skip }, () => null), ...samples] as (Row | null)[],
    [samples, skip],
  );

  const missing = asked.filter(a => !samples.some(s => s.code === a));

  /*
   * Said before the sheet is printed, not discovered at the scanner. The
   * longest code decides it: a roll where most labels read and three do not is
   * worse than one nobody trusts.
   */
  const tooSmall = useMemo(() => {
    let worst: { code: string; why: string } | null = null;
    for (const s of samples) {
      const e = encodeCode128(s.code);
      if ('error' in e) continue;
      const fit = fitsLabel(e, stock.width - 3);
      if (!fit.scannable && (!worst || true)) worst = { code: s.code, why: fit.why! };
    }
    return worst ? `${worst.code} will not scan on this stock. ${worst.why}` : null;
  }, [samples, stock]);

  return (
    <>
      <div className="no-print" style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem', padding: '0.9rem 1.1rem', border: '1px solid var(--glass-border)', borderRadius: 10, background: 'white' }}>
        <Field label="Label stock">
          <select value={stockId} onChange={e => { setStockId(e.target.value); setSkip(0); }} className="input-control" style={input}>
            {STOCKS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Skip">
          <input type="number" min={0} max={perSheet - 1} value={skip}
                 onChange={e => setSkip(Math.max(0, Math.min(perSheet - 1, Number(e.target.value) || 0)))}
                 className="input-control" style={{ ...input, width: 70 }} />
        </Field>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.82rem' }}>
          <input type="checkbox" checked={showWhere} onChange={e => setShowWhere(e.target.checked)} />
          where it lives
        </label>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {samples.length} label{samples.length === 1 ? '' : 's'}
          {skip > 0 && `, starting at position ${skip + 1}`}
          {samples.length > 0 && ` · ${Math.ceil((samples.length + skip) / perSheet)} sheet${Math.ceil((samples.length + skip) / perSheet) === 1 ? '' : 's'}`}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/samples" className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>← Samples</Link>
        <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: '0.82rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <Printer size={14} /> Print
        </button>
      </div>

      {tooSmall && (
        <p className="no-print" style={{ fontSize: '0.82rem', color: '#a3560a', marginTop: 0 }}>
          {tooSmall}
        </p>
      )}

      {missing.length > 0 && (
        <p className="no-print" style={{ fontSize: '0.82rem', color: '#a3560a' }}>
          No sample here is called {missing.join(', ')}.
        </p>
      )}

      {samples.length === 0 ? (
        <p className="no-print" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Nothing to label. Open this from a sample, or add ?ids=PLA-001,PLA-002 to the address.
        </p>
      ) : (
        <div className="sheet" style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${stock.across}, ${stock.width}mm)`,
          gridAutoRows: `${stock.height}mm`,
          columnGap: `${stock.gapX}mm`,
          rowGap: `${stock.gapY}mm`,
          paddingTop: `${stock.marginTop}mm`,
          paddingLeft: `${stock.marginLeft}mm`,
        }}>
          {cells.map((row, i) => (
            <div key={i} style={{
              width: `${stock.width}mm`, height: `${stock.height}mm`,
              boxSizing: 'border-box', padding: '1.5mm',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', overflow: 'hidden',
              breakInside: 'avoid',
            }}>
              {row && <Label row={row} stock={stock} showWhere={showWhere} />}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          @page { size: ${stock.id === 'cryo' ? `${stock.width}mm ${stock.height}mm` : 'A4'}; margin: 0; }
          .no-print, aside, header { display: none !important; }
          .app-container, .main-content, .page-content {
            display: block !important; overflow: visible !important;
            height: auto !important; padding: 0 !important; margin: 0 !important;
          }
          .sheet { page-break-after: auto; }
        }
      `}</style>
    </>
  );
}

function Label({ row, stock, showWhere }: { row: Row; stock: Stock; showWhere: boolean }) {
  /*
   * The module width is chosen from the label, not fixed. A 25 mm cryo label
   * cannot carry the same bars as a 63 mm address label, and a symbol scaled
   * down by the browser after the fact loses the exact module boundaries that
   * make it scannable.
   */
  const encoded = encodeCode128(row.code);
  if ('error' in encoded) return <span style={{ fontSize: '2mm' }}>{row.code}</span>;

  const usableMm = stock.width - 3;
  const moduleMm = usableMm / encoded.width;
  const barHeightMm = Math.max(6, stock.height * 0.4);

  const svg = barcodeSvg(encoded, {
    moduleWidth: moduleMm,
    height: barHeightMm,
    fontSize: Math.max(1.8, stock.height * 0.075),
  });

  return (
    <>
      <div style={{ width: `${usableMm}mm` }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div style={{
        fontSize: `${Math.max(1.8, stock.height * 0.075)}mm`, fontWeight: 600, textAlign: 'center',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%',
      }}>
        {row.name}
      </div>
      {showWhere && row.where && (
        <div style={{
          fontSize: `${Math.max(1.5, stock.height * 0.06)}mm`, color: '#475569', textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%',
        }}>
          {row.where}
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { fontSize: '0.8rem', padding: '0.26rem 0.4rem' };
