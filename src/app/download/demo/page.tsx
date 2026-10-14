'use client';
import React, { useState } from 'react';
import SequenceViewer from '@/components/SequenceViewer';
import type { SequenceFeature } from '@/lib/features';
import { colourFor } from '@/lib/features';

const CODONS = ['GCT','CGT','AAC','GAT','TGC','CAA','GAA','GGT','CAT','ATT','CTG','AAA','TTT','CCG','TCT','ACT','TGG','TAT','GTT','ATC'];

function build() {
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const filler = (k: number) => Array.from({ length: k }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');
  const orf = (c: number) => 'ATG' + Array.from({ length: c }, () => CODONS[Math.floor(rnd() * CODONS.length)]).join('') + 'TAA';
  const parts: { seq: string; name?: string }[] = [
    { seq: filler(60) },
    { seq: 'TAATACGACTCACTATAGGG', name: 'T7' },
    { seq: filler(6) },
    { seq: 'GGAATTGTGAGCGGATAACAATT', name: 'lacO' },
    { seq: 'AAGGAGATATACAT', name: 'RBS' },
    // A polylinker, including two Dam-blocked sites (XbaI over GATC, BclI)
    { seq: 'GAATTC' }, { seq: 'GGATCC' }, { seq: 'AAGCTT' }, { seq: 'CTGCAG' },
    { seq: 'GATCTAGATC' }, { seq: 'TGATCA' }, { seq: 'CCCGGG' }, { seq: 'GTCGAC' },
    { seq: 'CATCACCATCACCATCAC', name: 'His' },
    { seq: orf(238), name: 'EGFP' },
    { seq: filler(10) },
    { seq: 'CCAGGCCTGG' },                       // StuI inside a Dcm site
    { seq: filler(40), name: 'T7term' },
    { seq: filler(120) },
    { seq: orf(286), name: 'AmpR' },
    { seq: filler(40) },
    { seq: filler(105), name: 'AmpRp' },
    { seq: filler(60) },
    { seq: filler(589), name: 'ori' },
    { seq: filler(180) },
  ];
  let pos = 0; const at: Record<string, { start: number; end: number }> = {}; let seq = '';
  for (const p of parts) { if (p.name) at[p.name] = { start: pos + 1, end: pos + p.seq.length }; seq += p.seq; pos += p.seq.length; }
  return { seq, at };
}

const { seq: SEQ, at } = build();
const F = (id: string, name: string, type: string, r: { start: number; end: number }, strand: 1 | -1): SequenceFeature =>
  ({ id, name, type, start: r.start, end: r.end, strand, color: colourFor(type, name) });

const FEATURES: SequenceFeature[] = [
  F('1', 'T7 promoter', 'promoter', at.T7, 1),
  F('2', 'lac operator', 'protein_bind', at.lacO, 1),
  F('3', 'RBS', 'RBS', at.RBS, 1),
  F('5', '6xHis', 'tag', at.His, 1),
  F('6', 'EGFP', 'CDS', at.EGFP, 1),
  F('7', 'T7 terminator', 'terminator', at.T7term, 1),
  F('8', 'AmpR', 'CDS', at.AmpR, -1),
  F('9', 'AmpR promoter', 'promoter', at.AmpRp, -1),
  F('10', 'ori', 'rep_origin', at.ori, -1),
];

export default function Demo() {
  const [strain, setStrain] = useState<string>('dh5a');
  return (
    <div style={{ padding: '0.5rem 1rem', height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <div style={{ fontFamily: 'system-ui', fontSize: '0.78rem', color: '#475569', padding: '0.3rem 0' }}>
        Compare strains:{' '}
        {[['dh5a', 'DH5α'], ['jm110', 'JM110'], ['top10', 'TOP10']].map(([v, label]) => (
          <button key={v} onClick={() => setStrain(v)}
            style={{ marginRight: 6, padding: '0.15rem 0.5rem', borderRadius: 5, cursor: 'pointer',
                     border: '1px solid #cbd5e1', fontWeight: strain === v ? 700 : 400,
                     background: strain === v ? '#dbeafe' : 'white' }}>{label}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SequenceViewer key={strain} id="demo" name="pET-EGFP-His" sequence={SEQ} size={SEQ.length}
          seqType="plasmid" host="e-coli" strain={strain} initialFeatures={FEATURES} />
      </div>
    </div>
  );
}
