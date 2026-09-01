'use client';
import { useState } from 'react';
import { Layers3, AlertTriangle, Check, Copy, FileUp } from 'lucide-react';
import { assembleReads, END_ZONE, type Contig } from '@/lib/contig';
import { parseFastq, isFastq } from '@/lib/formats/fastq';
import { parseAb1, isAb1 } from '@/lib/formats/ab1';

/**
 * Reads in, contig out.
 *
 * The panel leads with coverage and disagreements rather than with the
 * consensus. A consensus string is the thing people copy, and copying one
 * without knowing that four of its positions rest on a single read -- or that
 * two reads flatly contradict each other at position 812 -- is how a wrong
 * sequence gets into a paper.
 */

/** FASTA if it looks like FASTA, otherwise one read per blank-line-separated block. */
function parseReads(text: string): { name: string; sequence: string; quality?: number[] }[] {
  if (isFastq(text)) {
    // FASTQ is the one pasteable format that carries quality, which is what
    // the trimmer actually wants.
    return parseFastq(text).reads.map(r => ({
      name: r.name, sequence: r.sequence, quality: r.quality,
    }));
  }
  return parseTextReads(text);
}

function parseTextReads(text: string): { name: string; sequence: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('>')) {
    return trimmed.split(/^>/m).filter(Boolean).map((block, i) => {
      const [header, ...rest] = block.split('\n');
      return {
        name: header.trim() || `read ${i + 1}`,
        sequence: rest.join('').replace(/[^A-Za-z]/g, ''),
      };
    }).filter(r => r.sequence);
  }

  return trimmed.split(/\n\s*\n/).map((block, i) => ({
    name: `read ${i + 1}`,
    sequence: block.replace(/[^A-Za-z]/g, ''),
  })).filter(r => r.sequence);
}

function CoverageBar({ contig }: { contig: Contig }) {
  // One bar, sampled to the pixel width available. Max is what matters: the
  // thin places are the point of the picture.
  const buckets = 240;
  const per = Math.max(1, Math.ceil(contig.coverage.length / buckets));
  const sampled: number[] = [];
  for (let i = 0; i < contig.coverage.length; i += per) {
    sampled.push(Math.min(...contig.coverage.slice(i, i + per)));
  }
  const peak = Math.max(1, ...sampled);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 44, marginBottom: '0.3rem' }}>
        {sampled.map((c, i) => (
          <div
            key={i}
            title={`${c}× at ~${Math.round((i * per) + 1).toLocaleString()}`}
            style={{
              flex: 1,
              height: `${Math.max(4, (c / peak) * 100)}%`,
              background: c === 0 ? '#dc2626' : c === 1 ? '#d97706' : 'var(--accent-green)',
              borderRadius: '1px 1px 0 0',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span><span style={{ color: 'var(--accent-green)' }}>&#9632;</span> 2 or more</span>
        <span><span style={{ color: '#d97706' }}>&#9632;</span> one read only</span>
        <span><span style={{ color: '#dc2626' }}>&#9632;</span> no coverage</span>
      </div>
    </div>
  );
}

function ContigPanel({ contig, n }: { contig: Contig; n: number }) {
  const [showSeq, setShowSeq] = useState(false);
  const [copied, setCopied] = useState(false);
  const interior = contig.interiorConflicts;
  const atEnds = contig.endZoneConflicts;
  const minor = contig.disagreements.length - interior.length - atEnds;

  const copy = () => {
    navigator.clipboard?.writeText(`>contig_${n}\n${contig.consensus}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Contig {n}</h3>
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {contig.consensus.length.toLocaleString()} bp &middot; {contig.reads.length} read{contig.reads.length === 1 ? '' : 's'}
        </span>
      </div>

      {interior.length > 0 && (
        <div style={{
          margin: '0.9rem 0', padding: '0.85rem 1.1rem', borderRadius: 8,
          border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.05)',
        }}>
          <div style={{
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: '#b91c1c', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <AlertTriangle size={13} /> {interior.length} conflict{interior.length === 1 ? '' : 's'} in the middle of the reads
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {interior.slice(0, 12).map(d => (
              <li key={d.position} style={{ fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.position.toLocaleString()}</strong>
                {' — '}
                {Object.entries(d.votes).sort((a, b) => b[1] - a[1])
                  .map(([b, v]) => `${v}× ${b}`).join(', ')}
                {'. Called '}<strong>{d.called}</strong>.
              </li>
            ))}
            {interior.length > 12 && (
              <li style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                and {interior.length - 12} more.
              </li>
            )}
          </ul>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0', lineHeight: 1.55 }}>
            These sit well inside every read that covers them, so they are not end-of-run noise. Open
            the traces before trusting the consensus here &mdash; a mixed colony reads exactly like this.
          </p>
        </div>
      )}

      {atEnds > 0 && (
        <div style={{
          margin: '0.9rem 0', padding: '0.8rem 1.05rem', borderRadius: 8,
          border: '1px solid var(--glass-border)',
        }}>
          {/*
            One template string rather than JSX text around expressions: the
            same sentence written as mixed children lost the space before
            "bases" to JSX's whitespace trimming, and read as "within 30bases".
          */}
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
            {[
              // "further" only makes sense when something was listed above it.
              interior.length > 0
                ? `${atEnds} further position${atEnds === 1 ? '' : 's'} disagree`
                : `${atEnds} position${atEnds === 1 ? ' disagrees' : 's disagree'}`,
              `within ${END_ZONE} bases of a read's end, where basecalls are unreliable by nature.`,
              interior.length === 0
                ? 'Nothing disagrees in the interior, so this looks like untrimmed ends rather than anything about the DNA.'
                : 'Those are almost certainly untrimmed sequence rather than real differences.',
              'Reads with quality scores — a .ab1 or FASTQ — get trimmed properly and lose most of this.',
            ].join(' ')}
          </p>
        </div>
      )}

      <div style={{ margin: '1rem 0' }}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
        }}>
          Coverage
        </div>
        <CoverageBar contig={contig} />
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.55rem 0 0', lineHeight: 1.55 }}>
          {contig.singleCoverage === 0
            ? 'Every position is read at least twice, so a single miscall cannot reach the consensus.'
            : `${contig.singleCoverage.toLocaleString()} of ${contig.consensus.length.toLocaleString()} positions rest on one read. An error there cannot be caught by the other reads — usually the two ends, where another primer would fix it.`}
          {minor > 0 && ` ${minor} further position${minor === 1 ? ' was' : 's were'} settled by majority.`}
        </p>
      </div>

      <div style={{ margin: '1rem 0' }}>
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
        }}>
          Layout
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {contig.reads.map(r => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.78rem' }}>
              <span style={{ width: 110, flexShrink: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}{r.flipped && <span title="reverse-complemented to fit" style={{ color: 'var(--text-muted)' }}> &#8634;</span>}
              </span>
              <span style={{ flex: 1, position: 'relative', height: 12, background: 'var(--bg-primary)', borderRadius: 3 }}>
                <span style={{
                  position: 'absolute', borderRadius: 3, height: '100%',
                  left: `${(r.offset / contig.consensus.length) * 100}%`,
                  width: `${(r.sequence.length / contig.consensus.length) * 100}%`,
                  background: r.flipped ? 'var(--accent-purple, #8b5cf6)' : 'var(--accent-blue)',
                }} />
              </span>
              <span style={{ width: 90, textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {(r.offset + 1).toLocaleString()}&ndash;{(r.offset + r.sequence.length).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => setShowSeq(s => !s)} className="btn btn-secondary" style={{ fontSize: '0.78rem' }}>
          {showSeq ? 'Hide consensus' : 'Show consensus'}
        </button>
        <button onClick={copy} className="btn btn-secondary" style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy FASTA'}
        </button>
      </div>
      {showSeq && (
        <textarea
          readOnly
          value={contig.consensus}
          onFocus={e => e.currentTarget.select()}
          style={{
            width: '100%', height: 130, marginTop: '0.6rem', fontFamily: 'monospace', fontSize: '0.7rem',
            padding: '0.6rem', border: '1px solid var(--glass-border)', borderRadius: 6,
            background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
      )}
    </div>
  );
}

interface Read { name: string; sequence: string; quality?: number[] }

export default function AssembleClient() {
  const [text, setText] = useState('');
  const [minOverlap, setMinOverlap] = useState(20);
  const [traces, setTraces] = useState<Read[]>([]);
  const [result, setResult] = useState<ReturnType<typeof assembleReads> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Trace files dropped straight from the sequencing facility.
   *
   * These are the reads that actually benefit: a .ab1 carries the basecaller's
   * per-base quality, so the trim is driven by what the instrument thought of
   * each peak rather than by counting Ns.
   */
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setLoading(true); setError(null);
    const added: Read[] = [];
    const failed: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isAb1(bytes)) {
          const t = parseAb1(bytes);
          if (!t) { failed.push(file.name); continue; }
          added.push({
            name: t.sampleName || file.name.replace(/\.ab1$/i, ''),
            sequence: t.sequence,
            ...(t.quality.length ? { quality: t.quality } : {}),
          });
          continue;
        }
        const asText = new TextDecoder().decode(bytes);
        if (isFastq(asText)) {
          for (const r of parseFastq(asText).reads) {
            added.push({ name: r.name, sequence: r.sequence, quality: r.quality });
          }
          continue;
        }
        const fromText = parseTextReads(asText);
        if (fromText.length) added.push(...fromText);
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }

    setTraces(t => [...t, ...added]);
    if (failed.length) setError(`Could not read ${failed.join(', ')}. Trace files (.ab1), FASTQ and FASTA are understood.`);
    setLoading(false);
  };

  const pasted = parseReads(text);
  const reads: Read[] = [...traces, ...pasted];
  const withQuality = reads.filter(r => r.quality?.length).length;

  const run = () => {
    setError(null); setResult(null);
    if (reads.length < 2) { setError('Add at least two reads.'); return; }
    try {
      setResult(assembleReads(reads, { minOverlap }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assemble those reads.');
    }
  };

  const readCount = reads.length;

  return (
    <>
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <label style={{
          display: 'block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.4rem',
        }}>
          Reads
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'>M13F\nACGTACGT…\n\n>M13R\nTTGCAGCT…'}
          style={{
            width: '100%', height: 180, fontFamily: 'monospace', fontSize: '0.75rem',
            padding: '0.7rem', border: '1px solid var(--glass-border)', borderRadius: 8,
            background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
        <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.45rem 0 0.9rem', lineHeight: 1.5 }}>
          FASTA, FASTQ, or one read per paragraph. {readCount > 0 && <strong>{readCount} read{readCount === 1 ? '' : 's'} ready.</strong>}
        </p>

        <div style={{
          display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap',
          padding: '0.75rem 0.9rem', marginBottom: '0.9rem', borderRadius: 8,
          border: '1px dashed var(--glass-border)',
        }}>
          <label className="btn btn-secondary" style={{ fontSize: '0.8rem', cursor: 'pointer', margin: 0 }}>
            <FileUp size={13} style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
            Add trace files
            <input
              type="file" multiple accept=".ab1,.fastq,.fq,.fasta,.fa,.seq,.txt"
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
              style={{ display: 'none' }}
            />
          </label>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {loading ? 'Reading…'
              : traces.length > 0
                ? `${traces.length} file read${traces.length === 1 ? '' : 's'} loaded`
                : '.ab1 straight from the facility, or FASTQ'}
          </span>
          {traces.length > 0 && (
            <button onClick={() => setTraces([])} className="btn btn-secondary" style={{ fontSize: '0.76rem' }}>
              Clear files
            </button>
          )}
        </div>

        {readCount > 0 && (
          <p style={{ fontSize: '0.78rem', margin: '0 0 0.9rem', lineHeight: 1.55, color: withQuality > 0 ? 'var(--accent-green)' : '#a3560a' }}>
            {withQuality === readCount
              ? `All ${readCount} reads carry quality scores, so the ends are trimmed on what the basecaller thought of each peak.`
              : withQuality > 0
                ? `${withQuality} of ${readCount} reads carry quality scores. The rest are trimmed on ambiguity alone, which is blunter.`
                : 'No quality scores in these reads — the ends are trimmed on ambiguity alone. A .ab1 or FASTQ file would trim better.'}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            Minimum overlap
            <input
              type="number" min={10} max={200} value={minOverlap}
              onChange={e => setMinOverlap(Math.max(10, Number(e.target.value) || 20))}
              className="input-control"
              style={{ width: 76, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>bp</span>
          </label>
          <button onClick={run} disabled={loading} className="btn btn-primary" style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Layers3 size={15} /> Assemble
          </button>
        </div>
        {error && <div style={{ fontSize: '0.82rem', color: '#b91c1c', marginTop: '0.6rem' }}>{error}</div>}
      </div>

      {result && result.contigs.length === 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.88rem', margin: 0, lineHeight: 1.6 }}>
            Nothing joined. The reads may not overlap by {minOverlap} bp, or they may be from
            different templates. Lowering the minimum overlap is worth one try; below about 20 bp,
            unrelated sequences start matching by chance.
          </p>
        </div>
      )}

      {result?.contigs.map((c, i) => <ContigPanel key={i} contig={c} n={i + 1} />)}

      {result && result.contigs.length > 1 && (
        <div className="glass-panel" style={{ padding: '1.1rem 1.35rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.84rem', margin: 0, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            {result.contigs.length} separate contigs. The reads fall into groups that do not overlap
            each other &mdash; either there is a gap in the coverage that needs another primer, or
            these reads are not all from the same template.
          </p>
        </div>
      )}

      {result && result.unplaced.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.1rem 1.35rem' }}>
          <p style={{ fontSize: '0.84rem', margin: 0, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Too short to place after trimming: {result.unplaced.join(', ')}.
          </p>
        </div>
      )}
    </>
  );
}
