'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Barcode as BarcodeIcon, Copy, Check } from 'lucide-react';
import { encodeCode128, barcodeSvg, zplLabel } from '@/lib/barcode';

/**
 * The code, in a form a scanner can read.
 *
 * The search bar already opens a record from an exact code, so scanning has
 * worked here for as long as there has been something to scan. There never was
 * -- the code existed only as text on a screen, which made the feature useful
 * to anybody willing to type the thing they were holding in their hand.
 */
export default function SampleBarcode({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);

  const encoded = useMemo(() => encodeCode128(code), [code]);
  const svg = useMemo(
    () => ('error' in encoded ? null : barcodeSvg(encoded, { moduleWidth: 2, height: 54, fontSize: 12 })),
    [encoded],
  );

  if ('error' in encoded) {
    return (
      <p style={{ fontSize: '0.8rem', color: '#a3560a', margin: 0 }}>
        This code cannot be made into a barcode: {encoded.error}
      </p>
    );
  }

  const zpl = zplLabel(code, { caption });

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.6rem' }}>
        <BarcodeIcon size={16} />
        <h2 style={{ fontSize: '0.95rem', margin: 0, flex: 1 }}>Label</h2>
        <Link href={`/samples/labels?ids=${encodeURIComponent(code)}`} className="btn btn-secondary"
              style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}>
          Label sheet
        </Link>
        {typeof zpl === 'string' && (
          <button
            className="btn btn-secondary" style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}
            title="ZPL for a Zebra printer — paste it into the printer's queue or send it to port 9100"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(zpl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch { /* a browser that refuses the clipboard is not an error worth showing */ }
            }}
          >
            {copied ? <><Check size={12} /> copied</> : <><Copy size={12} /> ZPL</>}
          </button>
        )}
      </div>
      {/*
        Rendered as markup rather than an <img> so it prints as vector: a
        barcode that has been through a raster at the wrong size is a barcode
        that does not scan.
      */}
      <div style={{ background: '#fff', display: 'inline-block', padding: '0.25rem', borderRadius: 4 }}
           dangerouslySetInnerHTML={{ __html: svg! }} />
    </div>
  );
}
