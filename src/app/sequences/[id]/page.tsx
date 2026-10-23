import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Database, Dna } from 'lucide-react';
import SequenceViewer, { type SequenceFeature } from '@/components/SequenceViewer';
import { normaliseFeatures } from '@/lib/features';
import { ancestryOf, descendantsOf } from '@/lib/lineage';
import { historyFor } from '@/lib/history';
import SequenceLineage from '@/components/SequenceLineage';
import RecordHistory from '@/components/RecordHistory';
import CommentThread from '@/components/CommentThread';
import { threadFor } from '@/lib/comments';
import { requireUser } from '@/lib/auth-guard';
import FeatureCandidates from '@/components/FeatureCandidates';
import { candidatesForSequence, fullLibrary } from '@/lib/feature-library';
import { signaturesFor } from '@/lib/signature';
import { codingLength, normaliseFeatures as parseFeatures } from '@/lib/features';
import { isCoding } from '@/lib/point-mutation';
import ProteinsPanel from '@/components/sequences/ProteinsPanel';

export const dynamic = 'force-dynamic';

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const seq = await prisma.geneSequence.findUnique({
    where: { id },
    include: {
      primers: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!seq) notFound();

  // Where it came from, what came from it, and what has been done to it since.
  const [ancestry, descendants, history, candidates, library, collection, thread, viewer] = await Promise.all([
    ancestryOf(seq.id),
    descendantsOf(seq.id),
    historyFor('GeneSequence', seq.id),
    candidatesForSequence(seq.id),
    fullLibrary(),
    prisma.oligo.findMany({ where: { archived: false }, select: { id: true, code: true, name: true, sequence: true } }),
    threadFor('sequence', seq.id),
    requireUser(),
  ]);
  // Sign-offs that the bases match sequencing, newest first, each marked
  // current or superseded by a later edit.
  const verifications = (await signaturesFor('GeneSequence', seq.id)).filter(s => s.meaning === 'verified');
  const verified = verifications.find(v => v.current);

  // What this sequence encodes, and what it could: both directions, because
  // "is this construct's product already in the library" is asked from here.
  const proteins = await prisma.protein.findMany({
    where: { geneSequenceId: seq.id },
    select: { id: true, name: true, sequence: true, mw: true },
    orderBy: { createdAt: 'asc' },
  });
  const codingFeatures = parseFeatures(seq.features)
    .filter(f => isCoding(f.type))
    .map(f => {
      const bases = codingLength(f);
      return { id: f.id, name: f.name, start: f.start, end: f.end, strand: f.strand, codingLength: bases, inFrame: bases % 3 === 0 };
    });

  // Metadata only; the trace files themselves are fetched by the panel.
  const reads = await prisma.sequencingRead.findMany({
    where: { geneSequenceId: seq.id },
    select: { id: true, fileName: true, sampleName: true, runDate: true, uploadedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        <Link href="/sequences" style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Database size={13} /> Sequence Library
        </Link>
        <ChevronRight size={13} />
        <span>{seq.name}</span>
      </div>

      {/* Header */}
      <div className="glass-panel" style={{ padding: '1.5rem 2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px',
                background: seq.type === 'plasmid' ? 'rgba(37,99,235,0.1)' : 'rgba(5,150,105,0.1)',
                color: seq.type === 'plasmid' ? 'var(--accent-blue)' : 'var(--accent-green)',
                border: `1px solid ${seq.type === 'plasmid' ? 'rgba(37,99,235,0.2)' : 'rgba(5,150,105,0.2)'}`,
              }}>
                {seq.type === 'plasmid' ? 'PLASMID' : 'GENE'}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{seq.size.toLocaleString()} bp</span>
            </div>
            <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <Dna size={22} color="var(--accent-blue)" />
              {seq.name}
              {/*
                Beside the name rather than instead of it. The name is what
                people say; the code is what survives somebody renaming it,
                and what a label points at.
              */}
              {seq.code && (
                <span style={{
                  fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 600,
                  color: 'var(--text-muted)', border: '1px solid var(--glass-border)',
                  borderRadius: 6, padding: '0.05rem 0.4rem',
                }}>
                  {seq.code}
                </span>
              )}
            </h1>
            {verified ? (
              <div title={verified.note ?? undefined} style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: '0.3rem', fontWeight: 600 }}>
                ✓ Sequence-verified by {verified.signerName}, {verified.at.toLocaleDateString()}
              </div>
            ) : verifications.length > 0 ? (
              <div style={{ fontSize: '0.8rem', color: '#a3560a', marginTop: '0.3rem' }}>
                Verified by {verifications[0].signerName} before the sequence was last edited; it needs confirming again.
              </div>
            ) : null}
            {seq.description && (
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{seq.description}</p>
            )}
            {seq.tags && (
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {seq.tags.split(',').map(t => (
                  <span key={t} style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                    {t.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
            <Link href="/sequences/new" className="btn btn-secondary" style={{ fontSize: '0.82rem' }}>
              + New Sequence
            </Link>
          </div>
        </div>
      </div>

      {/* Sequence Viewer */}
      <SequenceViewer
        id={seq.id}
        name={seq.name}
        sequence={seq.sequence}
        size={seq.size}
        seqType={seq.type}
        host={seq.host}
        strain={seq.strain}
        initialFeatures={normaliseFeatures(seq.features)}
        initialMapStyle={seq.mapStyle}
        library={library}
        collection={collection}
        verifications={verifications.map(v => ({ id: v.id, at: v.at.toISOString(), signerName: v.signerName, note: v.note, current: v.current }))}
        savedReads={reads.map(r => ({ id: r.id, fileName: r.fileName, sampleName: r.sampleName, runDate: r.runDate, uploadedBy: r.uploadedBy.name }))}
        initialPrimers={seq.primers.map(p => ({
          id: p.id,
          name: p.name,
          sequence: p.sequence,
          direction: p.direction,
          tm: p.tm ?? 0,
          gcContent: p.gcContent ?? 0,
          notes: p.notes ?? undefined,
        }))}
      />

      {/* Where it came from, and what has been done to it. Below the viewer:
          the sequence is what people open the page for, and provenance is
          what they come back for. */}
      <div style={{ marginTop: '1.5rem' }}>
        <ProteinsPanel
          sequenceId={seq.id}
          proteins={proteins.map(p => ({ id: p.id, name: p.name, length: p.sequence.length, mw: p.mw }))}
          features={codingFeatures}
        />
        <FeatureCandidates sequenceId={seq.id} candidates={candidates} />
        <SequenceLineage ancestry={ancestry} descendants={descendants} />
        <CommentThread
          kind="sequence" targetId={seq.id} label={seq.name}
          comments={thread.comments} people={thread.people} me={viewer.id}
        />
        <RecordHistory entries={history} />
      </div>
    </div>
  );
}
