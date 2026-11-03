import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import SequenceViewer from '@/components/SequenceViewer';
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
      {/*
        No breadcrumb and no title block.
        
        They cost 142px of a 900px window stacked above an editor whose whole
        purpose is the map below them, and everything they carried -- the way
        back, the name, the code, the badge, the verification state -- now
        sits in the editor's own bar, on one line.
      */}
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
        code={seq.code}
        description={seq.description}
        tags={seq.tags}
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
