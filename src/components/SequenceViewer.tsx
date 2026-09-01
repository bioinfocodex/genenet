'use client';
import React, { useState, useMemo, useTransition, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { ENZYMES, findCutSites } from '@/lib/restrictionEnzymes';
import { saveFeatures, saveSimulation, addPrimer, deletePrimer, updatePrimer } from '@/app/actions/sequences';
import {
  findORFs, reverseComplement,
  reverseTranslate,
  calcTm, calcGC,
  simulatePCR, ligateFragments,
  LADDER_1KB, gelPosition, calculateFragments,
  type ORF, type PCRResult, type LigationResult,
} from '@/lib/simulation';
import { verifyRead, type ReadVerification } from '@/lib/alignment';
import { annotate } from '@/lib/annotation';
import { blockedSites, type BlockedSite } from '@/lib/methylation';
import { isoschizomersOf, STARTER_SETS, resolveSet } from '@/lib/enzyme-sets';
import type { LibraryFeature } from '@/lib/features.data';
import type { SequenceFeature } from '@/lib/features';
import { placePrimers } from '@/lib/primer-binding';
import { downloadSvg, downloadPng } from '@/lib/svg-export';
import { chooseMapEnzymes, countCuts } from '@/lib/map-enzymes';
import { chooseMapOrfs, summariseOrfs } from '@/lib/map-orfs';
import CrisprPanel from './sequences/CrisprPanel';
import MolbuilderToolbar from './sequences/MolbuilderToolbar';
import MolbuilderRenderer from './sequences/MolbuilderRenderer';
import MolbuilderStats from './sequences/MolbuilderStats';
import MolbuilderFindReplace from './sequences/MolbuilderFindReplace';
import LinearMap from './sequences/LinearMap';
import CircularMap from './sequences/CircularMap';

// ─── Types ───────────────────────────────────────────────────────────────────

// Defined in lib/features so the server can normalise stored records against
// the same shape the viewer draws. Re-exported here: plenty of components
// already import it from this module.
export type { SequenceFeature } from '@/lib/features';

interface ReSite {
  enzyme: string;
  cutPos: number;
  recognitionStart: number;
  recognitionLen: number;
  overhang: string;
  overhangType: string;
  color: string;
}

export interface SavedPrimer {
  id: string;
  name: string;
  sequence: string;
  direction: string;
  tm: number;
  gcContent: number;
  notes?: string;
}

type LeftTab = 'map' | 'sequence' | 'feature' | 'sites' | 'orfs' | 'translate' | 'pcr' | 'ligation' | 'aigen' | 'sanger' | 'crispr' | 'dimer' | 'design' | 'mutagenesis' | 'gel' | 'fold';

/**
 * The ways of looking at this sequence, in the order they are offered.
 *
 * A complete list: anything reachable that is a view of the sequence is here,
 * so the bar can always say where you are. Tools are not views and are not
 * here — see TOOL_NAMES.
 */
const VIEW_TABS: [LeftTab, string][] = [
  ['map', 'Map'],
  ['sequence', 'Sequence'],
  ['feature', 'Features'],
  ['sites', 'Enzymes'],
  ['orfs', 'ORFs'],
  ['translate', 'Translation'],
];

/**
 * Panels that do something rather than show something.
 *
 * Named once, here, so the tab that appears while one is open reads the same
 * as the menu entry that opened it. Five of these used to have one name in the
 * View menu and another in the sidebar — "ORFs" and "Find ORFs", "RE Sites"
 * and "RE Analysis" — which made two entries look like two features.
 */
const TOOL_NAMES: Partial<Record<LeftTab, string>> = {
  design: 'Primer Design',
  pcr: 'PCR Simulation',
  ligation: 'Ligation',
  gel: 'Virtual Gel',
  mutagenesis: 'Mutagenesis',
  dimer: 'Primer Dimer',
  sanger: 'Sanger Alignment',
  crispr: 'CRISPR Guides',
  aigen: 'AI Annotation',
  fold: '3D Fold',
};

const PRESET_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
const FEATURE_TYPES = [
  'gene', 'CDS', 'exon', 'intron', 'promoter', 'terminator', 'primer_bind',
  'rep_origin', 'regulatory', 'misc_feature', 'RBS', 'enhancer', 'reporter',
  'selectable_marker', 'tag', "5'UTR", "3'UTR",
];
const RE_COLORS = ['#ef4444','#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#f97316','#ec4899','#84cc16','#78716c','#0ea5e9','#d946ef'];

interface Props {
  id: string;
  name: string;
  sequence: string;
  size: number;
  seqType: string;
  initialFeatures: SequenceFeature[];
  initialPrimers?: SavedPrimer[];
  /**
   * Everything this installation can recognise, shipped and learned together.
   * Passed in because annotation runs here, in the browser, and the learned
   * half lives in the database.
   */
  library?: LibraryFeature[];
}

// ─── Auto-suggest feature type from name ─────────────────────────────────────

function suggestType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('promoter') || n.includes('p_') || n.startsWith('p-')) return 'promoter';
  if (n.includes('terminator') || n.includes('term')) return 'terminator';
  if (n.includes('ori') || n.includes('origin')) return 'rep_origin';
  if (n.includes('gfp') || n.includes('mcherry') || n.includes('rfp') || n.includes('yfp') || n.includes('cfp')) return 'CDS';
  if (n.includes('ampr') || n.includes('kanr') || n.includes('camr') || n.includes('hygr') || n.includes('zeor') || n.includes('tetr')) return 'CDS';
  if (n.includes('rbs')) return 'RBS';
  if (n.includes('his') || n.includes('flag') || n.includes('ha') || n.includes('myc') || n.includes('tag')) return 'tag';
  if (n.includes('mcs') || n.includes('linker')) return 'misc_feature';
  return 'gene';
}

// ─── Feature Library ──────────────────────────────────────────────────────────

const LIBRARY_FEATURES: { name: string; type: string; color: string }[] = [
  { name: 'T7 promoter',   type: 'promoter',           color: '#f59e0b' },
  { name: 'lac promoter',  type: 'promoter',           color: '#f59e0b' },
  { name: 'AmpR',          type: 'CDS',                color: '#3b82f6' },
  { name: 'KanR',          type: 'CDS',                color: '#3b82f6' },
  { name: 'GFP',           type: 'CDS',                color: '#22c55e' },
  { name: 'mCherry',       type: 'CDS',                color: '#ef4444' },
  { name: 'ColE1 ori',     type: 'rep_origin',         color: '#8b5cf6' },
  { name: 'T7 terminator', type: 'terminator',         color: '#ef4444' },
  { name: '6xHis-tag',     type: 'misc_feature',       color: '#06b6d4' },
  { name: 'MCS',           type: 'misc_feature',       color: '#6b7280' },
];

// ─── GenBank formatter ────────────────────────────────────────────────────────

function buildGenBank(name: string, sequence: string, features: SequenceFeature[]): string {
  const len = sequence.length;
  const lines: string[] = [];
  lines.push(`LOCUS       ${name.padEnd(16)} ${len} bp    DNA`);
  lines.push(`DEFINITION  ${name}.`);
  lines.push('FEATURES             Location/Qualifiers');
  for (const f of features) {
    const loc = f.strand === 1 ? `${f.start}..${f.end}` : `complement(${f.start}..${f.end})`;
    lines.push(`     ${f.type.padEnd(16)} ${loc}`);
    lines.push(`                     /label="${f.name}"`);
    lines.push(`                     /note="color: ${f.color}"`);
    if (f.notes) lines.push(`                     /note="${f.notes}"`);
  }
  lines.push('ORIGIN');
  const seq = sequence.toLowerCase();
  for (let i = 0; i < seq.length; i += 60) {
    const pos = String(i + 1).padStart(9);
    const chunk = seq.substring(i, i + 60);
    const groups: string[] = [];
    for (let j = 0; j < chunk.length; j += 10) groups.push(chunk.substring(j, j + 10));
    lines.push(`${pos} ${groups.join(' ')}`);
  }
  lines.push('//');
  return lines.join('\n');
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SequenceViewer({ id, name: seqName, sequence, size, seqType, initialFeatures, initialPrimers = [], library }: Props) {
  const router = useRouter();
  /*
   * Where you are, and how to get back.
   *
   * Six of these sixteen panels are views of the sequence; ten are tools that
   * happen to render in the same column. The tab bar used to list three and
   * highlight "Map" whichever of the other thirteen was open — so opening
   * Primer Design showed the Primer Design Studio with Map lit up. A
   * navigation that reports the wrong place is worse than one that reports
   * nothing.
   *
   * Views are permanent tabs. A tool appears as one more tab while it is open,
   * selected and closable, and closing it returns to the view you were last
   * looking at rather than to a hardcoded default.
   */
  const [leftTab, setLeftTabRaw] = useState<LeftTab>('map');
  const [lastView, setLastView] = useState<LeftTab>('map');

  const setLeftTab = useCallback((t: LeftTab) => {
    if (VIEW_TABS.some(([v]) => v === t)) setLastView(t);
    setLeftTabRaw(t);
  }, []);
  const [features, setFeatures] = useState<SequenceFeature[]>(initialFeatures);
  const [primers, setPrimers] = useState<SavedPrimer[]>(initialPrimers);

  /*
   * Where the saved primers actually sit.
   *
   * A primer record carries a sequence and no coordinates, so the map cannot
   * draw one without searching for it. Located by the 3' end rather than by
   * exact match, because every primer this application designs for cloning
   * carries a 5' tail that is not in the template.
   */
  /*
   * How enzymes are shown, shared by the map and the sites panel.
   *
   * The set filter used to be local state inside the panel, so narrowing to
   * "Golden Gate" changed a list and left the map showing everything — the two
   * views of one thing disagreeing about what the user had asked for. The
   * choice belongs to the sequence, not to a panel.
   */
  const [showOrfs, setShowOrfs] = useState(false);
  const [orfIncludeAnnotated, setOrfIncludeAnnotated] = useState(false);
  const [enzymeSet, setEnzymeSet] = useState('all');
  const [mapMaxCuts, setMapMaxCuts] = useState(1);
  const [mapMinSite, setMapMinSite] = useState(6);

  const enzymeSetNames = useMemo(() => {
    if (enzymeSet === 'all') return null;
    const set = STARTER_SETS.find(x => x.name === enzymeSet);
    return set ? resolveSet(set) : null;
  }, [enzymeSet]);

  const enzymeDisplay = useMemo(() => ({
    minSiteLength: mapMinSite,
    maxCuts: mapMaxCuts,
    ...(enzymeSetNames ? { restrictTo: enzymeSetNames } : {}),
  }), [mapMinSite, mapMaxCuts, enzymeSetNames]);

  const mapRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<'svg' | 'png' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Save the map as a figure.
   *
   * The SVG on screen takes its colours from CSS variables on the document, so
   * a serialised copy is black-on-black unless the computed styles are written
   * in — which is what `inlineSvg` does inside these two.
   */
  const exportMap = async (kind: 'svg' | 'png') => {
    const svg = mapRef.current?.querySelector('svg');
    if (!svg) { setExportError('The map is not on screen to export.'); return; }
    setExportError(null);
    setExporting(kind);
    const safe = (seqName || 'map').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'map';
    const filename = `${safe}-${mapView}.${kind}`;
    try {
      if (kind === 'svg') downloadSvg(svg as SVGSVGElement, filename);
      else await downloadPng(svg as SVGSVGElement, filename);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not export the map.');
    } finally {
      setExporting(null);
    }
  };

  const placedPrimers = useMemo(
    () => placePrimers(primers, sequence, { circular: seqType === 'plasmid' }),
    [primers, sequence, seqType],
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mapView, setMapView] = useState<'linear' | 'circular'>('linear');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  // Sidebar collapse state
  const [addOpen, setAddOpen] = useState(true);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);

  // Digest simulation state
  const [digestEnzymes, setDigestEnzymes] = useState<string[]>([]);
  const [digestResult, setDigestResult] = useState<number[] | null>(null);

  // PCR simulation state
  const [pcrFwd, setPcrFwd] = useState('');
  const [pcrRev, setPcrRev] = useState('');
  const [pcrResult, setPcrResult] = useState<PCRResult | null>(null);
  const [pcrSaved, setPcrSaved] = useState(false);

  // Ligation state
  const [ligInsertName, setLigInsertName] = useState('insert');
  const [ligInsertSeq, setLigInsertSeq] = useState('');
  const [ligResult, setLigResult] = useState<LigationResult | null>(null);
  const [ligSaved, setLigSaved] = useState(false);

  // Feature visibility & selection
  const [hiddenFeatures, setHiddenFeatures] = useState<Set<string>>(new Set());
  const [selectedFeature, setSelectedFeature] = useState<SequenceFeature | null>(null);
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [primersOpen, setPrimersOpen] = useState(true);

  // Modals
  const [showAddFeatureModal, setShowAddFeatureModal] = useState(false);
  const [showAddPrimerModal, setShowAddPrimerModal] = useState(false);
  const [editingPrimerId, setEditingPrimerId] = useState<string | null>(null);
  const [showAddREModal, setShowAddREModal] = useState(false);
  const [strandPickerSel, setStrandPickerSel] = useState<{ start: number; end: number } | null>(null);

  // Add Feature Modal state
  const [modalFeat, setModalFeat] = useState({
    name: '', type: 'gene', start: '', end: '',
    strand: '1', color: PRESET_COLORS[0], notes: '',
  });

  // Add Primer Modal state
  const [modalPrimer, setModalPrimer] = useState<PrimerModalState>({
    name: '', sequence: '', strand: 'forward', start: '', end: '', notes: '', reExtension: '', phospho5: false,
  });

  // Add RE Modal state
  const [modalRE, setModalRE] = useState({ name: '', pattern: '', cutBefore: '1', overhang: '', overhangType: '5prime' });

  // Menu bar state
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Molbuilder state
  const [molLayers, setMolLayers] = useState({ feat: true, enz: true, primer: true, orf: true });
  const [showMolStats, setShowMolStats] = useState(false);
  const [showMolFind, setShowMolFind] = useState(false);
  const [molLineLen, setMolLineLen] = useState(60);
  const [molFrames, setMolFrames] = useState<Set<number>>(new Set());

  // File import
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const isGB = /\.(gb|gbk|genbank)$/i.test(file.name);
      const parsed = isGB ? parseGenBankFeatures(text) : parseFastaFeatures(text);
      if (!parsed) { setImportMsg({ type: 'err', text: 'Could not parse file.' }); return; }
      setFeatures(prev => {
        const existingIds = new Set(prev.map(f => f.name + f.start + f.end));
        const newFeats = parsed.filter(f => !existingIds.has(f.name + f.start + f.end));
        return [...prev, ...newFeats];
      });
      setDirty(true);
      setImportMsg({ type: 'ok', text: `Imported ${parsed.length} annotation(s) from ${file.name}` });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const gcContent = useMemo(() => {
    const gc = (sequence.match(/[GC]/gi) ?? []).length;
    return ((gc / sequence.length) * 100).toFixed(1);
  }, [sequence]);

  const atContent = useMemo(() => (100 - parseFloat(gcContent)).toFixed(1), [gcContent]);

  const mw = useMemo(() => ((size * 650) / 1000).toFixed(0), [size]);

  // Detect all RE cut sites
  const allReSites = useMemo((): ReSite[] => {
    const enzymeList = Object.values(ENZYMES);
    const sites: ReSite[] = [];
    enzymeList.forEach((enzyme, i) => {
      findCutSites(sequence, enzyme).forEach(cutPos => {
        sites.push({
          enzyme: enzyme.name,
          cutPos,
          recognitionStart: cutPos - enzyme.cutBefore,
          recognitionLen: enzyme.pattern.length,
          overhang: enzyme.overhang || 'blunt',
          overhangType: enzyme.overhangType,
          color: RE_COLORS[i % RE_COLORS.length],
        });
      });
    });
    return sites.sort((a, b) => a.cutPos - b.cutPos);
  }, [sequence]);

  const reSitesByEnzyme = useMemo(() => {
    const map = new Map<string, ReSite[]>();
    allReSites.forEach(s => {
      if (!map.has(s.enzyme)) map.set(s.enzyme, []);
      map.get(s.enzyme)!.push(s);
    });
    return map;
  }, [allReSites]);

  /**
   * What the map is actually drawing, so the filtering is never silent.
   *
   * Both numbers, because they answer different questions. `drawn` is what is
   * on screen; `eligible` is how many passed the filters. When the label cap
   * bites they differ, and saying only "60 drawn" would hide a second round of
   * thinning behind the first — which is the thing this counter exists to
   * prevent.
   */
  const siteCounts = useMemo(() => {
    const counts = countCuts(allReSites);
    return {
      drawn: chooseMapEnzymes(allReSites, counts, enzymeDisplay).length,
      eligible: chooseMapEnzymes(allReSites, counts, { ...enzymeDisplay, maxLabels: Infinity }).length,
    };
  }, [allReSites, enzymeDisplay]);


  // ORFs count (lazy, for sidebar stats)
  const orfsCount = useMemo(() => findORFs(sequence, 100).length, [sequence]);
  const orfs = useMemo(() => findORFs(sequence, 100), [sequence]);

  /*
   * Which reading frames the map draws.
   *
   * Off by default. Six-frame translation of a plasmid finds frames
   * everywhere, and turning them on unasked would undo the decluttering the
   * rest of this map is about. The default once on is the useful question:
   * frames with no CDS already over them.
   */
  const mapOrfs = useMemo(
    () => (showOrfs
      ? chooseMapOrfs(orfs, features, { includeAnnotated: orfIncludeAnnotated })
      : []),
    [showOrfs, orfIncludeAnnotated, orfs, features],
  );

  const orfSummary = useMemo(
    () => summariseOrfs(orfs, features, { includeAnnotated: orfIncludeAnnotated }),
    [orfs, features, orfIncludeAnnotated],
  );


  /*
   * One answer to "where does this primer sit", shared by the maps and the
   * sequence view.
   *
   * These used to be two: an exact-match locator here and a 3'-anchored one in
   * the maps. A Gibson primer would then appear on the map and be listed as
   * "does not match this sequence exactly" a few hundred pixels below it —
   * two truths from one application about the same oligo.
   */
  const drawablePrimers = useMemo(
    () => placedPrimers.map(p => ({
      ...(primers.find(x => x.id === p.id) as SavedPrimer),
      // The renderer draws in 1-indexed inclusive coordinates.
      start: p.start + 1,
      end: p.end + 1,
    })),
    [placedPrimers, primers],
  );

  const unlocatedPrimers = useMemo(
    () => primers.filter(p => !placedPrimers.some(pl => pl.id === p.id)),
    [primers, placedPrimers],
  );

  // Visible features (respects hiddenFeatures toggle)
  const visibleFeatures = useMemo(
    () => features.filter(f => !hiddenFeatures.has(f.id)),
    [features, hiddenFeatures]
  );

  const addFeatureFromModal = () => {
    const start = parseInt(modalFeat.start);
    const end = parseInt(modalFeat.end);
    if (!modalFeat.name || isNaN(start) || isNaN(end) || start < 1 || end > size || start > end) return;
    const feat: SequenceFeature = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: modalFeat.name, start, end,
      type: modalFeat.type, color: modalFeat.color,
      strand: parseInt(modalFeat.strand) as 1 | -1,
      notes: modalFeat.notes || undefined,
    };
    setFeatures(prev => [...prev, feat]);
    setDirty(true);
    setShowAddFeatureModal(false);
    setModalFeat({ name: '', type: 'gene', start: '', end: '', strand: '1', color: PRESET_COLORS[features.length % PRESET_COLORS.length], notes: '' });
  };

  const addPrimerFromModal = () => {
    const bindingSeq = modalPrimer.sequence.toUpperCase().replace(/[^ACGT]/g, '');
    if (!modalPrimer.name || !bindingSeq) return;

    // Build full sequence including RE extension
    const RE_EXT: Record<string, string> = {
      EcoRI: 'GAATTC', BamHI: 'GGATCC', HindIII: 'AAGCTT',
      NcoI: 'CCATGG', NdeI: 'CATATG', XhoI: 'CTCGAG', NotI: 'GCGGCCGC',
    };
    const reSeq = RE_EXT[modalPrimer.reExtension] ?? '';
    const fullSeq = reSeq + bindingSeq;

    // Optimistic local state update
    const p: SavedPrimer = {
      id: `primer-${Date.now()}`,
      name: modalPrimer.name,
      sequence: fullSeq,
      direction: modalPrimer.strand,
      tm: calcTm(bindingSeq),
      gcContent: calcGC(bindingSeq),
      notes: modalPrimer.notes || undefined,
    };
    setPrimers(prev => [...prev, p]);
    setMolLayers(prev => ({ ...prev, primer: true })); // Ensure primers are visible
    setShowAddPrimerModal(false);
    setModalPrimer({ name: '', sequence: '', strand: 'forward', start: '', end: '', notes: '', reExtension: '', phospho5: false });

    // Persist to DB
    startTransition(async () => {
      const fd = new FormData();
      fd.append('geneSequenceId', id);
      fd.append('name', modalPrimer.name);
      fd.append('sequence', fullSeq);
      fd.append('direction', modalPrimer.strand);
      fd.append('notes', modalPrimer.notes || '');
      await addPrimer(fd);
    });
  };

  const handleDeletePrimer = (primerId: string) => {
    setPrimers(prev => prev.filter(p => p.id !== primerId));
    startTransition(async () => {
      const fd = new FormData();
      fd.append('id', primerId);
      fd.append('geneSequenceId', id);
      await deletePrimer(fd);
    });
  };

  const openEditPrimer = (p: SavedPrimer) => {
    // Strip any RE tail to recover the binding sequence
    let bindingSeq = p.sequence;
    let reExtension = '';
    for (const [enzyme, tail] of Object.entries({ EcoRI:'GAATTC', BamHI:'GGATCC', HindIII:'AAGCTT', NcoI:'CCATGG', NdeI:'CATATG', XhoI:'CTCGAG', NotI:'GCGGCCGC', SalI:'GTCGAC', XbaI:'TCTAGA', SpeI:'ACTAGT', PstI:'CTGCAG', KpnI:'GGTACC', SacI:'GAGCTC', ClaI:'ATCGAT', SphI:'GCATGC' })) {
      if (p.sequence.startsWith(tail)) { bindingSeq = p.sequence.slice(tail.length); reExtension = enzyme; break; }
    }
    setEditingPrimerId(p.id);
    setModalPrimer({ name: p.name, sequence: bindingSeq, strand: p.direction, start: '', end: '', notes: p.notes ?? '', reExtension, phospho5: false });
    setShowAddPrimerModal(true);
  };

  const updatePrimerFromModal = () => {
    if (!editingPrimerId) return;
    const bindingSeq = modalPrimer.sequence.toUpperCase().replace(/[^ACGT]/g, '');
    if (!modalPrimer.name || !bindingSeq) return;
    const RE_EXT: Record<string, string> = {
      EcoRI:'GAATTC', BamHI:'GGATCC', HindIII:'AAGCTT', NcoI:'CCATGG', NdeI:'CATATG', XhoI:'CTCGAG', NotI:'GCGGCCGC',
      SalI:'GTCGAC', XbaI:'TCTAGA', SpeI:'ACTAGT', PstI:'CTGCAG', KpnI:'GGTACC', SacI:'GAGCTC', ClaI:'ATCGAT', SphI:'GCATGC',
    };
    const reSeq = RE_EXT[modalPrimer.reExtension] ?? '';
    const fullSeq = reSeq + bindingSeq;
    setPrimers(prev => prev.map(p => p.id === editingPrimerId
      ? { ...p, name: modalPrimer.name, sequence: fullSeq, direction: modalPrimer.strand, tm: calcTm(bindingSeq), gcContent: calcGC(bindingSeq), notes: modalPrimer.notes || undefined }
      : p
    ));
    setShowAddPrimerModal(false);
    setEditingPrimerId(null);
    setModalPrimer({ name: '', sequence: '', strand: 'forward', start: '', end: '', notes: '', reExtension: '', phospho5: false });
    startTransition(async () => {
      const fd = new FormData();
      fd.append('id', editingPrimerId);
      fd.append('geneSequenceId', id);
      fd.append('name', modalPrimer.name);
      fd.append('sequence', fullSeq);
      fd.append('direction', modalPrimer.strand);
      fd.append('notes', modalPrimer.notes || '');
      await updatePrimer(fd);
    });
  };


  const handleSave = () => {
    setSaving(true);
    const fd = new FormData();
    fd.append('id', id);
    fd.append('features', JSON.stringify(features));
    startTransition(() => {
      saveFeatures(fd);
      setSaving(false);
      setDirty(false);
    });
  };

  const handleAutoDetect = () => {
    // Circular when the record says so, because a part sitting across the
    // origin is otherwise invisible -- and an origin of replication is exactly
    // the sort of thing that ends up there.
    const detected = annotate(sequence, { circular: seqType === 'plasmid', extra: library });
    const newFeats: SequenceFeature[] = detected
      .filter(d => !features.some(f => f.name === d.name && Math.abs(f.start - d.start) < 50))
      .map(d => ({
        id: `auto-${crypto.randomUUID()}`,
        name: d.name, start: d.start, end: d.end,
        color: d.color, type: d.type, strand: d.strand,
      }));
    if (newFeats.length > 0) { setFeatures(prev => [...prev, ...newFeats]); setDirty(true); }
  };

  const addLibraryFeature = (item: typeof LIBRARY_FEATURES[0]) => {
    const feat: SequenceFeature = {
      id: `lib-${crypto.randomUUID()}`,
      name: item.name, start: 1, end: Math.min(500, size),
      type: item.type, color: item.color, strand: 1,
    };
    setFeatures(prev => [...prev, feat]);
    setDirty(true);
  };

  const handleDigest = () => {
    if (digestEnzymes.length === 0) return;
    const cuts: number[] = [0];
    digestEnzymes.forEach(enz => {
      (reSitesByEnzyme.get(enz) ?? []).forEach(s => cuts.push(s.cutPos));
    });
    cuts.push(size);
    cuts.sort((a, b) => a - b);
    const frags: number[] = [];
    for (let i = 1; i < cuts.length; i++) frags.push(cuts[i] - cuts[i - 1]);
    if (seqType === 'plasmid' && frags.length > 1) {
      const wrap = frags.shift()! + (frags.pop() ?? 0);
      frags.push(wrap);
    }
    setDigestResult(frags.sort((a, b) => b - a));
  };

  // Export helpers
  const exportFasta = () => {
    const content = `>${seqName}\n${sequence.match(/.{1,60}/g)?.join('\n') ?? sequence}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${seqName}.fasta`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportGenBank = () => {
    const content = buildGenBank(seqName, sequence, features);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${seqName}.gb`; a.click();
    URL.revokeObjectURL(url);
  };

  void isPending;

  // Open add-feature modal with optional selection pre-fill
  const openAddFeature = (presetType?: string) => {
    setModalFeat({
      name: '', type: presetType ?? 'gene',
      start: selection ? String(selection.start) : '',
      end: selection ? String(selection.end) : '',
      strand: '1', color: PRESET_COLORS[features.length % PRESET_COLORS.length], notes: '',
    });
    setShowAddFeatureModal(true);
  };

  const openAddPrimer = () => {
    if (selection) {
      setStrandPickerSel(selection);
    } else {
      setEditingPrimerId(null);
      setModalPrimer({ name: '', sequence: '', strand: 'forward', start: '', end: '', notes: '', reExtension: '', phospho5: false });
      setShowAddPrimerModal(true);
    }
  };

  // Menu bar items
  const menuItems: Record<string, { label: string; action: () => void; divider?: boolean }[]> = {
    File: [
      { label: 'New Sequence', action: () => router.push('/sequences/new') },
      { label: 'Open Library', action: () => router.push('/sequences') },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'Export FASTA', action: exportFasta },
      { label: 'Export GenBank', action: exportGenBank },
      { label: 'Copy Sequence', action: () => navigator.clipboard.writeText(sequence) },
      { label: '──────────', action: () => {}, divider: true },
      { label: '🤖 Open in AI Suite', action: () => { window.open(`http://localhost:8501/?id=${id}`, '_blank'); } },
    ],
    Edit: [
      { label: 'Copy Sequence', action: () => navigator.clipboard.writeText(sequence) },
      { label: 'Copy Reverse Complement', action: () => navigator.clipboard.writeText(reverseComplement(sequence)) },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'Auto-detect Features', action: handleAutoDetect },
      { label: 'Find / Replace', action: () => { setLeftTab('sequence'); setShowMolFind(true); } },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'Add Feature', action: () => openAddFeature() },
      { label: 'Add Primer', action: openAddPrimer },
    ],
    View: [
      { label: 'Map', action: () => setLeftTab('map') },
      { label: 'Sequence', action: () => setLeftTab('sequence') },
      { label: 'Features', action: () => setLeftTab('feature') },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'RE Sites', action: () => setLeftTab('sites') },
      { label: 'ORFs', action: () => setLeftTab('orfs') },
      { label: 'Translation', action: () => setLeftTab('translate') },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'Zoom In', action: () => {} },
      { label: 'Zoom Out', action: () => {} },
    ],
    Tools: [
      { label: 'Primer Design', action: () => { setLeftTab('design'); } },
      { label: 'PCR Simulation', action: () => setLeftTab('pcr') },
      { label: 'Ligation', action: () => setLeftTab('ligation') },
      { label: 'Virtual Gel', action: () => setLeftTab('gel') },
      { label: 'Mutagenesis', action: () => setLeftTab('mutagenesis') },
      { label: '──────────', action: () => {}, divider: true },
      { label: 'Primer Dimer', action: () => setLeftTab('dimer') },
      { label: 'Sanger Alignment', action: () => setLeftTab('sanger') },
      { label: 'AI Gene Annotation', action: () => setLeftTab('aigen') },
      { label: '3D Fold', action: () => setLeftTab('fold') },
    ],
  };

  return (
    <div style={{ padding: '1.25rem 1.5rem', background: 'var(--bg-primary)', borderTop: '1px solid var(--glass-border)' }}>

      {/* ── Menu bar ── */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '0.75rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.35rem', position: 'relative', zIndex: 200 }}
        onMouseLeave={() => setOpenMenu(null)}
      >
        {Object.entries(menuItems).map(([menuName, items]) => (
          <div key={menuName} style={{ position: 'relative' }}>
            <button
              onMouseEnter={() => setOpenMenu(menuName)}
              onClick={() => setOpenMenu(prev => prev === menuName ? null : menuName)}
              style={{ padding: '0.25rem 0.75rem', border: 'none', background: openMenu === menuName ? 'var(--accent-blue-15)' : 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: openMenu === menuName ? 600 : 400, color: openMenu === menuName ? 'var(--accent-blue)' : 'var(--text-secondary)', borderRadius: '5px 5px 0 0', fontFamily: 'inherit', transition: 'all 0.1s' }}
            >
              {menuName}
            </button>
            {openMenu === menuName && (
              <div style={{ position: 'absolute', top: '100%', left: 0, minWidth: 200, background: 'white', border: '1px solid var(--glass-border)', borderRadius: '0 6px 6px 6px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 300, padding: '0.3rem 0' }}>
                {items.map((item, i) =>
                  item.divider ? (
                    <div key={i} style={{ height: '1px', background: 'var(--glass-border)', margin: '0.2rem 0.5rem' }} />
                  ) : (
                    <button
                      key={i}
                      onClick={() => { item.action(); setOpenMenu(null); }}
                      style={{ display: 'block', width: '100%', padding: '0.35rem 1rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left', color: 'var(--text-primary)', fontFamily: 'inherit', transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-blue-15)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {item.label}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', paddingBottom: '0.1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center', fontFamily: 'monospace', background: 'var(--bg-secondary)', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)' }}>{seqName}</span>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <Pill label="Length" value={`${size.toLocaleString()} bp`} />
        <Pill label="GC" value={`${gcContent}%`} />
        <Pill label="Type" value={seqType === 'plasmid' ? 'Circular' : 'Linear'} />
        <Pill label="RE sites" value={`${reSitesByEnzyme.size} enzymes · ${allReSites.length} cuts`} />
        <Pill label="Features" value={`${features.length}`} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {dirty && (
            <button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save'}
            </button>
          )}
          <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
            onClick={() => navigator.clipboard.writeText(sequence)}>
            📋 Copy
          </button>
        </div>
      </div>

      {/* ── Selection banner ── */}
      {selection && (() => {
        const selSeq = sequence.substring(selection.start - 1, selection.end).toUpperCase();
        const selTm = selSeq.length >= 4 ? calcTm(selSeq) : null;
        const selGC = selSeq.length >= 4 ? calcGC(selSeq) : null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.5rem 1rem', marginBottom: '0.85rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', borderRadius: '8px', fontSize: '0.82rem', flexWrap: 'wrap', boxShadow: '0 4px 12px rgba(59,130,246,0.08)' }}>
            <span style={{ color: 'var(--accent-blue)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '1rem' }}>📍</span> {selection.start.toLocaleString()} – {selection.end.toLocaleString()} 
              <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: '0.2rem' }}>({selection.end - selection.start + 1} bp)</span>
            </span>
            <div style={{ width: '1px', height: '14px', background: 'var(--glass-border)' }} />
            {selTm !== null && <span style={{ color: 'var(--text-secondary)' }}>Tm <strong style={{ color: 'var(--accent-blue)' }}>{selTm}°C</strong></span>}
            {selGC !== null && <span style={{ color: 'var(--text-secondary)' }}>GC <strong>{selGC}%</strong></span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button onClick={() => openAddFeature()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                ＋ Feature
              </button>
              <button onClick={openAddPrimer} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-purple)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                ＋ Primer
              </button>
              <button onClick={() => setSelection(null)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>Clear</button>
            </div>
          </div>
        );
      })()}

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>

        {/* ── Left column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* View tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
            {VIEW_TABS.map(([t, label]) => (
              <button key={t} onClick={() => setLeftTab(t)} style={{ padding: '0.5rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: leftTab === t ? 600 : 400, color: leftTab === t ? 'var(--accent-blue)' : 'var(--text-muted)', borderBottom: `2px solid ${leftTab === t ? 'var(--accent-blue)' : 'transparent'}`, fontFamily: 'inherit', transition: 'all 0.15s', letterSpacing: '0.01em' }}>
                {label}
              </button>
            ))}

            {/*
              A tool gets its own tab while it is open, so the bar never claims
              you are somewhere you are not, and there is always a way back to
              the view you came from.
            */}
            {TOOL_NAMES[leftTab] && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.5rem 0.7rem 0.5rem 1.1rem', fontSize: '0.85rem', fontWeight: 600,
                color: 'var(--accent-blue)', borderBottom: '2px solid var(--accent-blue)',
                marginLeft: 'auto',
              }}>
                {TOOL_NAMES[leftTab]}
                <button
                  onClick={() => setLeftTabRaw(lastView)}
                  title={`Close and go back to ${VIEW_TABS.find(([v]) => v === lastView)?.[1] ?? 'Map'}`}
                  aria-label="Close this tool"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.15rem', fontFamily: 'inherit' }}
                >
                  &times;
                </button>
              </span>
            )}
          </div>

          {/* Tab content */}
          {leftTab === 'map' && (
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {(['linear', 'circular'] as const).map(v => (
                  <button key={v} onClick={() => setMapView(v)} style={{ padding: '0.3rem 0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: mapView === v ? 'var(--accent-blue-15)' : 'white', color: mapView === v ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: mapView === v ? 600 : 400 }}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}

                <span style={{ flex: 1 }} />

                {/*
                  A map is a figure. Exporting it is the difference between
                  drawing one and being able to put it in a paper, and the
                  alternative people fall back on is a screenshot of a browser
                  window at whatever resolution their monitor happens to be.
                */}
                {([['svg', 'SVG'], ['png', 'PNG']] as const).map(([kind, label]) => (
                  <button
                    key={kind}
                    onClick={() => exportMap(kind)}
                    disabled={exporting !== null}
                    title={kind === 'svg'
                      ? 'Vector, for a figure that will be scaled or edited'
                      : 'Raster at 3× for slides and documents that will not take an SVG'}
                    style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'white', color: 'var(--text-muted)', cursor: exporting ? 'default' : 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    <Download size={12} /> {exporting === kind ? '…' : label}
                  </button>
                ))}
              </div>
              {exportError && (
                <div style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: '0.6rem' }}>{exportError}</div>
              )}

              {/*
                What the map is showing, and the controls for it.
                
                A map that quietly draws 41 of 5,080 sites is making a large
                decision on the reader's behalf without saying so. The count
                states it, and the three controls are the decision itself:
                which enzymes, how often they may cut, and how long a site has
                to be. Defaults are SnapGene's.
              */}
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.85rem', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                <span>Enzymes</span>
                <select
                  value={enzymeSet}
                  onChange={e => setEnzymeSet(e.target.value)}
                  className="input-control"
                  style={{ fontSize: '0.76rem', padding: '0.22rem 0.4rem' }}
                  title="Narrow the map to a working set. Shared with the Sites panel."
                >
                  <option value="all">All</option>
                  {STARTER_SETS.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>

                <select
                  value={mapMaxCuts}
                  onChange={e => setMapMaxCuts(Number(e.target.value))}
                  className="input-control"
                  style={{ fontSize: '0.76rem', padding: '0.22rem 0.4rem' }}
                  title="An enzyme cutting many times is not a cloning site"
                >
                  <option value={1}>cutting once</option>
                  <option value={2}>up to twice</option>
                  <option value={3}>up to 3 times</option>
                  <option value={99}>however often</option>
                </select>

                <select
                  value={mapMinSite}
                  onChange={e => setMapMinSite(Number(e.target.value))}
                  className="input-control"
                  style={{ fontSize: '0.76rem', padding: '0.22rem 0.4rem' }}
                  title="A four-cutter lands every few hundred bases"
                >
                  <option value={6}>6 bp sites and up</option>
                  <option value={5}>5 bp and up</option>
                  <option value={4}>4 bp and up</option>
                </select>

                {/*
                  Reading frames are opt-in. Six-frame translation finds them
                  everywhere, so drawing them unasked would undo the
                  decluttering the rest of this map is for. The count next to
                  the switch is what makes it worth reaching for: it says how
                  many frames have no CDS over them before anyone turns it on.
                */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}
                       title="Open reading frames with no coding feature annotated over them">
                  <input type="checkbox" checked={showOrfs} onChange={e => setShowOrfs(e.target.checked)} />
                  ORFs
                  {orfSummary.unannotated > 0 && (
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '0.05rem 0.32rem', borderRadius: 8,
                      background: 'rgba(217,119,6,0.15)', color: '#a3560a',
                    }}>
                      {orfSummary.unannotated} unannotated
                    </span>
                  )}
                </label>

                {showOrfs && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}
                         title="Also draw frames that already have a CDS over them, faintly">
                    <input type="checkbox" checked={orfIncludeAnnotated}
                           onChange={e => setOrfIncludeAnnotated(e.target.checked)} />
                    incl. annotated
                  </label>
                )}

                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}
                      title={siteCounts.drawn < siteCounts.eligible
                        ? 'Too many to label legibly, so they are thinned evenly round the molecule rather than truncated on one side'
                        : undefined}>
                  {siteCounts.drawn === 0
                    ? `nothing to draw from ${allReSites.length.toLocaleString()} cuts found`
                    : siteCounts.drawn < siteCounts.eligible
                      ? `${siteCounts.drawn} of ${siteCounts.eligible} matching sites drawn — too many to label`
                      : `${siteCounts.drawn} site${siteCounts.drawn === 1 ? '' : 's'} drawn of ${allReSites.length.toLocaleString()} cuts found`}
                  {showOrfs && ` · ${orfSummary.drawn} of ${orfSummary.total.toLocaleString()} reading frames`}
                </span>
              </div>
              <div ref={mapRef}>
              {mapView === 'linear'
                ? <LinearMap sequence={sequence} features={visibleFeatures} reSites={allReSites} isCircular={seqType === 'plasmid'} selection={selection} onSelect={setSelection} onFeatureClick={setSelectedFeature} primers={placedPrimers} enzymeDisplay={enzymeDisplay} orfs={mapOrfs} />
                : <CircularMap sequence={sequence} features={visibleFeatures} reSites={allReSites} selection={selection} onSelect={setSelection} onFeatureClick={setSelectedFeature} name={seqName} primers={placedPrimers} enzymeDisplay={enzymeDisplay} orfs={mapOrfs} onAddFeature={(sel) => { setSelection(sel); setModalFeat({ name: '', type: 'gene', start: String(sel.start), end: String(sel.end), strand: '1', color: PRESET_COLORS[features.length % PRESET_COLORS.length], notes: '' }); setShowAddFeatureModal(true); }} />
              }
              </div>

              {/* Feature detail panel */}
              {selectedFeature && (
                <div style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: 'white', border: `2px solid ${selectedFeature.color}55`, borderRadius: '10px', fontSize: '0.84rem', position: 'relative' }}>
                  <button onClick={() => setSelectedFeature(null)} style={{ position: 'absolute', top: '0.5rem', right: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1 }}>✕</button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '3px', background: selectedFeature.color, flexShrink: 0 }} />
                    <strong style={{ fontSize: '1rem', color: selectedFeature.color }}>{selectedFeature.name}</strong>
                    <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: '4px', background: selectedFeature.color + '18', color: selectedFeature.color, fontWeight: 600 }}>{selectedFeature.type}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    {[
                      ['Position', `${selectedFeature.start}–${selectedFeature.end}`],
                      ['Length', `${selectedFeature.end - selectedFeature.start + 1} bp`],
                      ['Strand', selectedFeature.strand === 1 ? 'Forward (+)' : 'Reverse (−)'],
                    ].map(([k, v]) => (
                      <div key={k} style={{ padding: '0.35rem 0.5rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700, marginTop: '0.1rem' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {selectedFeature.notes && (
                    <p style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--glass-border)', paddingTop: '0.6rem' }}>{selectedFeature.notes}</p>
                  )}
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem' }}>
                    <button onClick={() => { setSelection({ start: selectedFeature.start, end: selectedFeature.end }); setSelectedFeature(null); }} style={{ padding: '0.3rem 0.7rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>Select Region</button>
                    <button onClick={() => { navigator.clipboard.writeText(sequence.substring(selectedFeature.start - 1, selectedFeature.end)); }} style={{ padding: '0.3rem 0.7rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>Copy Sequence</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {leftTab === 'sequence' && (
            <div className="seq-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 600 }}>

              {/* ── Selection action bar ── */}
              {selection && (() => {
                const selSeq = sequence.substring(selection.start - 1, selection.end).toUpperCase();
                const selTm = selSeq.length >= 4 ? calcTm(selSeq) : null;
                const selGC = selSeq.length >= 4 ? calcGC(selSeq) : null;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 1rem', marginBottom: '0.75rem', background: 'var(--accent-blue-15)', border: '1px solid var(--accent-blue-glow)', borderRadius: '8px', fontSize: '0.82rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>
                      {selection.start.toLocaleString()} – {selection.end.toLocaleString()}
                      <span style={{ opacity: 0.65, fontWeight: 400, marginLeft: '0.3rem' }}>({selection.end - selection.start + 1} bp)</span>
                    </span>
                    {selTm !== null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Tm <strong style={{ color: 'var(--accent-blue)' }}>{selTm}°C</strong></span>}
                    {selGC !== null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>GC <strong>{selGC}%</strong></span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        onClick={() => openAddFeature()}
                        style={{ padding: '0.3rem 0.8rem', borderRadius: '6px', border: 'none', background: 'var(--accent-blue)', color: 'white', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit' }}
                      >＋ Feature</button>
                      <button
                        onClick={openAddPrimer}
                        style={{ padding: '0.3rem 0.8rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'white', color: 'var(--accent-purple)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit' }}
                      >＋ Primer</button>
                      <button
                        onClick={() => navigator.clipboard.writeText(selSeq)}
                        style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'white', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}
                        title="Copy selected sequence"
                      >📋</button>
                      <button
                        onClick={() => setSelection(null)}
                        style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'white', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'inherit' }}
                      >✕</button>
                    </div>
                  </div>
                );
              })()}

              <MolbuilderToolbar
                layers={molLayers}
                setLayers={setMolLayers}
                frames={molFrames}
                setFrames={setMolFrames}
                viewMode="wrap"
                setViewMode={() => {}}
                lineLen={molLineLen}
                setLineLen={setMolLineLen}
                showStats={showMolStats}
                setShowStats={setShowMolStats}
                showFind={showMolFind}
                setShowFind={setShowMolFind}
              />
              {showMolFind && (
                <MolbuilderFindReplace 
                  onFind={(q) => {
                    // Search logic could be expanded here to highlight in the renderer
                  }} 
                  onReplace={(q, r) => {
                    if (!q || !r) return;
                    const next = sequence.replace(new RegExp(q, 'gi'), r);
                    // This would normally trigger a full state update. 
                    // Caution: modifying the main sequence requires careful handling in this project's architecture.
                    alert(`Replace ${q} with ${r} (Action: Not applied to safeguard data, implementation check)`);
                  }} 
                  onClose={() => setShowMolFind(false)} 
                />
              )}
              {molLayers.primer && unlocatedPrimers.length > 0 && (
                <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)', background: 'rgba(245,158,11,0.06)' }}>
                  Not shown on the map: {unlocatedPrimers.map(p => p.name).join(', ')} &mdash;{' '}
                  {unlocatedPrimers.length === 1 ? 'its 3\u2032 end does not' : 'their 3\u2032 ends do not'} anneal
                  anywhere on this sequence, so {unlocatedPrimers.length === 1 ? 'it belongs' : 'they belong'} to
                  a different construct.
                  Mutagenesis primers and primers carrying a tail behave this way.
                </div>
              )}
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <MolbuilderRenderer
                    sequence={sequence}
                    features={visibleFeatures}
                    enzymes={allReSites}
                    primers={drawablePrimers}
                    orfs={orfs}
                    lineLen={molLineLen}
                    layers={molLayers}
                    frames={molFrames}
                    selection={selection}
                    onSelect={setSelection}
                    onFeatureClick={(f) => {
                      setSelection({ start: f.start, end: f.end });
                      setSelectedFeature(f);
                    }}
                  />
                </div>
                {showMolStats && (
                  <MolbuilderStats 
                    seq={sequence} 
                    selection={selection} 
                    features={visibleFeatures.filter(f => !selection || (f.start <= selection.end && f.end >= selection.start))}
                    onClose={() => setShowMolStats(false)} 
                  />
                )}
              </div>
            </div>
          )}

          {leftTab === 'feature' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>Features ({features.length})</div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={handleAutoDetect} style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.77rem', fontFamily: 'inherit', fontWeight: 600 }}>Auto-detect</button>
                  <button onClick={() => openAddFeature()} style={{ padding: '0.3rem 0.75rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'white', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.77rem', fontFamily: 'inherit' }}>+ Add Feature</button>
                </div>
              </div>
              {features.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--glass-border)', borderRadius: '8px' }}>
                  No features annotated yet. Click Auto-detect or add a feature manually.
                </div>
              ) : (
                <div style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--glass-border)' }}>
                        {['Name', 'Type', 'Start', 'End', 'Length', 'Strand', ''].map(h => (
                          <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {features.map((f, i) => (
                        <tr key={f.id} style={{ borderBottom: i < features.length - 1 ? '1px solid var(--glass-border)' : 'none', background: i % 2 === 0 ? 'white' : 'var(--bg-secondary)' }}>
                          <td style={{ padding: '0.45rem 0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <span style={{ width: 10, height: 10, borderRadius: '2px', background: f.color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600 }}>{f.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem' }}>
                            <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: f.color + '18', color: f.color, fontWeight: 600 }}>{f.type}</span>
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{f.start.toLocaleString()}</td>
                          <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{f.end.toLocaleString()}</td>
                          <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{(f.end - f.start + 1).toLocaleString()} bp</td>
                          <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)' }}>{f.strand === 1 ? '+ (fwd)' : '− (rev)'}</td>
                          <td style={{ padding: '0.45rem 0.75rem' }}>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button onClick={() => { setSelection({ start: f.start, end: f.end }); setSelectedFeature(f); setLeftTab('map'); }} title="View on map" style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '4px', cursor: 'pointer', padding: '0.15rem 0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'inherit' }}>Map</button>
                              <button onClick={() => { setFeatures(prev => prev.filter(x => x.id !== f.id)); if (selectedFeature?.id === f.id) setSelectedFeature(null); setDirty(true); }} title="Delete" style={{ background: 'none', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer', padding: '0.15rem 0.4rem', fontSize: '0.72rem', color: '#dc2626', fontFamily: 'inherit' }}>✕</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {dirty && (
                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : '💾 Save Changes'}
                  </button>
                </div>
              )}
            </div>
          )}

          {leftTab === 'sites' && <RESitesPanel reSitesByEnzyme={reSitesByEnzyme} sequence={sequence} circular={seqType === 'plasmid'} setName={enzymeSet} onSetName={setEnzymeSet} />}
          {leftTab === 'orfs'  && <ORFsPanel sequence={sequence} />}
          {leftTab === 'translate' && <TranslatePanel sequence={sequence} />}
          {leftTab === 'pcr' && (
            <PCRPanel
              sequenceId={id}
              sequenceName={seqName}
              template={sequence}
              primers={primers}
              result={pcrResult}
              fwd={pcrFwd}
              rev={pcrRev}
              saved={pcrSaved}
              onFwdChange={setPcrFwd}
              onRevChange={setPcrRev}
              onRun={() => { setPcrResult(simulatePCR(sequence, pcrFwd, pcrRev)); setPcrSaved(false); }}
              onSave={async () => {
                if (!pcrResult) return;
                const fd = new FormData();
                fd.append('type', 'PCR');
                fd.append('name', `PCR on ${seqName}`);
                fd.append('inputData', JSON.stringify({ template: id, fwd: pcrFwd, rev: pcrRev }));
                fd.append('outputData', JSON.stringify(pcrResult));
                fd.append('geneSequenceId', id);
                await saveSimulation(fd);
                setPcrSaved(true);
              }}
            />
          )}
          {leftTab === 'ligation' && (
            <LigationPanel
              sequenceId={id}
              sequenceName={seqName}
              vectorSeq={sequence}
              vectorSize={size}
              result={ligResult}
              insertName={ligInsertName}
              insertSeq={ligInsertSeq}
              saved={ligSaved}
              onInsertNameChange={setLigInsertName}
              onInsertSeqChange={setLigInsertSeq}
              onRun={() => { setLigResult(ligateFragments(sequence, ligInsertSeq)); setLigSaved(false); }}
              onSave={async () => {
                if (!ligResult) return;
                const fd = new FormData();
                fd.append('type', 'LIGATION');
                fd.append('name', `${ligInsertName} → ${seqName}`);
                fd.append('inputData', JSON.stringify({ vector: id, insert: ligInsertName, insertSeq: ligInsertSeq.slice(0, 200) }));
                fd.append('outputData', JSON.stringify(ligResult));
                fd.append('geneSequenceId', id);
                await saveSimulation(fd);
                setLigSaved(true);
              }}
            />
          )}
          {leftTab === 'aigen'  && <AIGenePanel sequence={sequence} />}
          {leftTab === 'sanger' && <SangerPanel reference={sequence} />}
          {leftTab === 'crispr' && <CrisprPanel sequence={sequence} selection={selection} onSelect={setSelection} />}
          {leftTab === 'dimer'  && <DimerPanel primers={primers} />}
          {leftTab === 'design' && (
            <LiveDesignPanel
              sequence={sequence}
              selection={selection}
              onSelect={setSelection}
              allReSites={allReSites}
              reSitesByEnzyme={reSitesByEnzyme}
              onCreatePrimer={(s, e, seq, strand) => {
                setModalPrimer({ name: '', sequence: seq, strand, start: String(s), end: String(e), notes: '', reExtension: '', phospho5: false });
                setShowAddPrimerModal(true);
              }}
            />
          )}
          {leftTab === 'mutagenesis' && <MutagenesisPanel sequence={sequence} selection={selection} />}
          {leftTab === 'gel'  && <VirtualGelPanel sequence={sequence} allReSites={allReSites} reSitesByEnzyme={reSitesByEnzyme} seqType={seqType} />}
          {leftTab === 'fold' && <FoldPanel sequence={sequence} selection={selection} />}
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ width: 272, flexShrink: 0 }}>

          {/* 1. Add Elements */}
          <SidebarSection title="＋ Add Elements" open={addOpen} onToggle={() => setAddOpen(o => !o)}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <SidebarBtn label="Add Feature" onClick={() => openAddFeature()} />
              <SidebarBtn label="Add Primer" onClick={openAddPrimer} />
              <SidebarBtn label="Add RE Site" onClick={() => setShowAddREModal(true)} />
              <SidebarBtn label="Add Tag" onClick={() => openAddFeature('misc_feature')} />
              <SidebarBtn label="Auto-detect" onClick={handleAutoDetect} style={{ gridColumn: '1 / -1', background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', fontWeight: 600 }} />
            </div>
          </SidebarSection>

          {/* 2. Analysis Tools */}
          <SidebarSection title="🔬 Analysis" open={analysisOpen} onToggle={() => setAnalysisOpen(o => !o)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <SidebarBtn label="Find ORFs" onClick={() => setLeftTab('orfs')} />
              <SidebarBtn label="Translate" onClick={() => setLeftTab('translate')} />
              <SidebarBtn label="RE Analysis" onClick={() => setLeftTab('sites')} />
              <SidebarBtn label="Align a Read" onClick={() => setLeftTab('sanger')} />
              <SidebarBtn label="CRISPR Guides" onClick={() => setLeftTab('crispr')} />
              <SidebarBtn label="GC Content" onClick={() => setLeftTab('sequence')} />
              <SidebarBtn
                label={digestOpen ? 'Hide Digest Sim' : 'Digest Sim'}
                onClick={() => setDigestOpen(o => !o)}
                style={{ background: digestOpen ? 'var(--accent-blue-15)' : undefined, color: digestOpen ? 'var(--accent-blue)' : undefined }}
              />
              {digestOpen && (
                <div style={{ padding: '0.75rem', background: 'white', borderRadius: '8px', border: '1px solid var(--glass-border)', marginTop: '0.25rem' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Select Enzymes</div>
                  <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '0.5rem' }}>
                    {[...reSitesByEnzyme.keys()].map(enz => (
                      <label key={enz} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.76rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={digestEnzymes.includes(enz)}
                          onChange={e => {
                            setDigestEnzymes(prev =>
                              e.target.checked ? [...prev, enz] : prev.filter(x => x !== enz)
                            );
                            setDigestResult(null);
                          }}
                        />
                        <span style={{ fontFamily: 'monospace' }}>{enz}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({(reSitesByEnzyme.get(enz) ?? []).length})</span>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={handleDigest}
                    disabled={digestEnzymes.length === 0}
                    style={{ width: '100%', padding: '0.35rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: digestEnzymes.length === 0 ? '#f1f5f9' : 'var(--accent-blue)', color: digestEnzymes.length === 0 ? 'var(--text-muted)' : 'white', cursor: digestEnzymes.length === 0 ? 'not-allowed' : 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: 600 }}
                  >
                    Simulate Digest
                  </button>
                  {digestResult && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{digestResult.length} fragment(s)</div>
                      <div style={{ maxHeight: 100, overflowY: 'auto' }}>
                        {digestResult.map((frag, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', padding: '0.15rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Fragment {i + 1}</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{frag.toLocaleString()} bp</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SidebarSection>

          {/* 3. Feature Library */}
          <SidebarSection title="📚 Library" open={libraryOpen} onToggle={() => setLibraryOpen(o => !o)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {LIBRARY_FEATURES.map(item => (
                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', borderRadius: '5px', background: 'white', border: '1px solid var(--glass-border)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '0.76rem', fontWeight: 500 }}>{item.name}</span>
                  <span style={{ fontSize: '0.62rem', color: item.color, background: item.color + '18', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{item.type}</span>
                  <button
                    onClick={() => addLibraryFeature(item)}
                    style={{ background: 'none', border: '1px solid var(--glass-border)', borderRadius: '3px', cursor: 'pointer', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}
                  >+</button>
                </div>
              ))}
            </div>
          </SidebarSection>

          {/* 4. Features visibility */}
          <SidebarSection title="📍 Features" open={featuresOpen} onToggle={() => setFeaturesOpen(o => !o)}>
            {features.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No features added yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {features.map(f => {
                  const hidden = hiddenFeatures.has(f.id);
                  return (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.4rem', borderRadius: '5px', background: 'white', border: '1px solid var(--glass-border)', opacity: hidden ? 0.45 : 1, transition: 'opacity 0.15s' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '2px', background: f.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: '0.74rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>{f.end - f.start + 1}bp</span>
                      <button
                        onClick={() => setHiddenFeatures(prev => {
                          const next = new Set(prev);
                          if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                          return next;
                        })}
                        title={hidden ? 'Show' : 'Hide'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.82rem', color: hidden ? 'var(--text-muted)' : f.color, flexShrink: 0 }}
                      >{hidden ? '🚫' : '👁'}</button>
                      <button
                        onClick={() => { setFeatures(prev => prev.filter(x => x.id !== f.id)); if (selectedFeature?.id === f.id) setSelectedFeature(null); }}
                        title="Delete"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.78rem', color: '#dc2626', flexShrink: 0 }}
                      >✕</button>
                    </div>
                  );
                })}
                {hiddenFeatures.size > 0 && (
                  <button onClick={() => setHiddenFeatures(new Set())} style={{ marginTop: '0.25rem', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'none', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                    Show all ({hiddenFeatures.size} hidden)
                  </button>
                )}
              </div>
            )}
          </SidebarSection>

          {/* 5. Primers */}
          <SidebarSection title={`🧬 Primers (${primers.length})`} open={primersOpen} onToggle={() => setPrimersOpen(o => !o)}>
            {primers.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No primers yet. Select a region on the Sequence tab and click &ldquo;Make Primer&rdquo;.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {primers.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.5rem', borderRadius: '5px', background: 'white', border: '1px solid var(--glass-border)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.direction === 'forward' ? '#3b82f6' : '#a855f7', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        Tm {p.tm}°C · GC {p.gcContent}% · {p.sequence.length}nt
                      </div>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(p.sequence)}
                      title="Copy sequence"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem', color: '#64748b', flexShrink: 0 }}
                    >📋</button>
                    <button
                      onClick={() => openEditPrimer(p)}
                      title="Edit"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem', color: '#3b82f6', flexShrink: 0 }}
                    >✎</button>
                    <button
                      onClick={() => handleDeletePrimer(p.id)}
                      title="Delete"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '0.78rem', color: '#dc2626', flexShrink: 0 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </SidebarSection>

          {/* 6. Statistics */}
          <SidebarSection title="📊 Statistics" open={statsOpen} onToggle={() => setStatsOpen(o => !o)}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {[
                ['Length', `${size.toLocaleString()} bp`],
                ['GC content', `${gcContent}%`],
                ['AT content', `${atContent}%`],
                ['Mol. weight', `~${Number(mw).toLocaleString()} kDa`],
                ['Features', `${features.length}`],
                ['RE enzymes', `${reSitesByEnzyme.size}`],
                ['RE cuts', `${allReSites.length}`],
                ['ORFs (≥100nt)', `${orfsCount}`],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '0.4rem 0.5rem', background: 'white', borderRadius: '5px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.1rem' }}>{v}</div>
                </div>
              ))}
            </div>
          </SidebarSection>

          {/* 6. Import */}
          <SidebarSection title="⬆ Import" open={exportOpen} onToggle={() => setExportOpen(o => !o)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <input ref={importFileRef} type="file" accept=".gb,.gbk,.genbank,.fasta,.fa,.fna" style={{ display: 'none' }} onChange={handleFileImport} />
              <SidebarBtn label="Import GenBank / FASTA" onClick={() => importFileRef.current?.click()} style={{ background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', fontWeight: 600 }} />
              {importMsg && (
                <div style={{ fontSize: '0.72rem', padding: '0.3rem 0.5rem', borderRadius: '5px', background: importMsg.type === 'ok' ? '#f0fdf4' : '#fef2f2', color: importMsg.type === 'ok' ? '#16a34a' : '#dc2626', border: `1px solid ${importMsg.type === 'ok' ? '#bbf7d0' : '#fca5a5'}` }}>
                  {importMsg.text}
                </div>
              )}
              <SidebarBtn label="Export FASTA" onClick={exportFasta} />
              <SidebarBtn label="Export GenBank" onClick={exportGenBank} />
              <SidebarBtn label="Copy Sequence" onClick={() => navigator.clipboard.writeText(sequence)} />
              <SidebarBtn label="Export SVG" onClick={() => alert('Open the Map tab and right-click the SVG to save it.')} />
            </div>
          </SidebarSection>

        </div>
      </div>

      {/* ── Add Feature Modal ── */}
      {showAddFeatureModal && (
        <ModalOverlay onClose={() => setShowAddFeatureModal(false)}>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.25rem' }}>Add Feature</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <ModalField label="Feature Name">
              <input
                className="input-control"
                value={modalFeat.name}
                onChange={e => {
                  const n = e.target.value;
                  setModalFeat(prev => ({ ...prev, name: n, type: suggestType(n) }));
                }}
                placeholder="e.g. T7 promoter, GFP, AmpR"
                style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }}
              />
            </ModalField>
            <ModalField label="Type">
              <select
                className="input-control"
                value={modalFeat.type}
                onChange={e => setModalFeat(prev => ({ ...prev, type: e.target.value }))}
                style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem' }}
              >
                {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </ModalField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <ModalField label="Start (bp)">
                <input type="number" className="input-control" value={modalFeat.start} onChange={e => setModalFeat(prev => ({ ...prev, start: e.target.value }))} placeholder="1" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} />
              </ModalField>
              <ModalField label="End (bp)">
                <input type="number" className="input-control" value={modalFeat.end} onChange={e => setModalFeat(prev => ({ ...prev, end: e.target.value }))} placeholder={String(size)} style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} />
              </ModalField>
              <ModalField label="Strand">
                <select className="input-control" value={modalFeat.strand} onChange={e => setModalFeat(prev => ({ ...prev, strand: e.target.value }))} style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem' }}>
                  <option value="1">+ forward</option>
                  <option value="-1">− reverse</option>
                </select>
              </ModalField>
            </div>
            <ModalField label="Color">
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(c => (
                  <div key={c} onClick={() => setModalFeat(prev => ({ ...prev, color: c }))} style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: `2.5px solid ${modalFeat.color === c ? '#1e40af' : 'transparent'}`, transition: 'border 0.1s' }} />
                ))}
                <input type="color" value={modalFeat.color} onChange={e => setModalFeat(prev => ({ ...prev, color: e.target.value }))} style={{ width: 28, height: 28, borderRadius: '4px', border: '1px solid var(--glass-border)', cursor: 'pointer', padding: 0 }} />
              </div>
            </ModalField>
            <ModalField label="Notes (optional)">
              <textarea className="input-control" value={modalFeat.notes} onChange={e => setModalFeat(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes…" style={{ padding: '0.45rem 0.7rem', fontSize: '0.82rem', minHeight: 60, resize: 'vertical' }} />
            </ModalField>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button className="btn btn-secondary" onClick={() => setShowAddFeatureModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addFeatureFromModal} disabled={!modalFeat.name || !modalFeat.start || !modalFeat.end}>Add</button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Strand Picker ── */}
      {strandPickerSel && (() => {
        const selLen = strandPickerSel.end - strandPickerSel.start + 1;
        const topSeqFull = sequence.substring(strandPickerSel.start - 1, strandPickerSel.end).toUpperCase();
        const botSeqFull = reverseComplement(topSeqFull);
        const tmTop = calcTm(topSeqFull);
        const tmBot = calcTm(botSeqFull);
        const gcTop = calcGC(topSeqFull);
        const gcBot = calcGC(botSeqFull);
        const preview = (s: string) => s.length > 18 ? s.slice(0, 9) + '…' + s.slice(-9) : s;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) setStrandPickerSel(null); }}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '1.75rem', width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>Select Primer Strand</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                Region {strandPickerSel.start}–{strandPickerSel.end} · <strong>{selLen} bp</strong>
              </p>
              <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '7px', border: '1px solid var(--glass-border)', marginBottom: '1rem', lineHeight: 1.8 }}>
                <div style={{ color: '#0369a1' }}>5′ {preview(topSeqFull)} 3′ &nbsp;<span style={{ color: '#94a3b8', fontStyle: 'italic' }}>top</span></div>
                <div style={{ color: '#cbd5e1', letterSpacing: '0.05em' }}>&nbsp;&nbsp;&nbsp;{Array(Math.min(preview(topSeqFull).length - (topSeqFull.length > 18 ? 1 : 0), 18)).fill('|').join('')}</div>
                <div style={{ color: '#7c3aed' }}>3′ {preview(botSeqFull.split('').reverse().join(''))} 5′ &nbsp;<span style={{ color: '#94a3b8', fontStyle: 'italic' }}>bottom</span></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <button
                  onClick={() => {
                    setModalPrimer({ name: `Fwd_${strandPickerSel.start}`, sequence: topSeqFull, strand: 'forward', start: String(strandPickerSel.start), end: String(strandPickerSel.end), notes: '', reExtension: '', phospho5: false });
                    setShowAddPrimerModal(true);
                    setStrandPickerSel(null);
                  }}
                  style={{ padding: '0.8rem 1rem', borderRadius: '10px', border: '2px solid #bae6fd', background: '#f0f9ff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.88rem', color: '#0369a1', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '1rem' }}>→</span> Top Strand
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>Tm <strong style={{ color: '#0369a1' }}>{tmTop}°C</strong></span>
                    <span>GC <strong style={{ color: '#0369a1' }}>{gcTop}%</strong></span>
                    <span style={{ fontFamily: 'monospace', color: '#0369a1' }}>5′ {topSeqFull.slice(0, 12)}{topSeqFull.length > 12 ? '…' : ''} 3′</span>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setModalPrimer({ name: `Rev_${strandPickerSel.end}`, sequence: botSeqFull, strand: 'reverse', start: String(strandPickerSel.start), end: String(strandPickerSel.end), notes: '', reExtension: '', phospho5: false });
                    setShowAddPrimerModal(true);
                    setStrandPickerSel(null);
                  }}
                  style={{ padding: '0.8rem 1rem', borderRadius: '10px', border: '2px solid #e9d5ff', background: '#fdf4ff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.88rem', color: '#7c3aed', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '1rem' }}>←</span> Bottom Strand
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>Tm <strong style={{ color: '#7c3aed' }}>{tmBot}°C</strong></span>
                    <span>GC <strong style={{ color: '#7c3aed' }}>{gcBot}%</strong></span>
                    <span style={{ fontFamily: 'monospace', color: '#7c3aed' }}>5′ {botSeqFull.slice(0, 12)}{botSeqFull.length > 12 ? '…' : ''} 3′</span>
                  </div>
                </button>
                <button onClick={() => setStrandPickerSel(null)} style={{ padding: '0.55rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Add / Edit Primer Modal ── */}
      {showAddPrimerModal && (
        <AddPrimerModal
          onSave={editingPrimerId ? updatePrimerFromModal : addPrimerFromModal}
          onCancel={() => { setShowAddPrimerModal(false); setEditingPrimerId(null); setModalPrimer({ name: '', sequence: '', strand: 'forward', start: '', end: '', notes: '', reExtension: '', phospho5: false }); }}
          onChange={setModalPrimer}
          state={modalPrimer}
          template={sequence}
          isEditing={!!editingPrimerId}
        />
      )}

      {/* ── Add RE Site Modal ── */}
      {showAddREModal && (
        <ModalOverlay onClose={() => setShowAddREModal(false)}>
          <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1.25rem' }}>Add Custom RE Site</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <ModalField label="Enzyme Name">
              <input className="input-control" value={modalRE.name} onChange={e => setModalRE(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. BsaI" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} />
            </ModalField>
            <ModalField label="Recognition Pattern (5′→3′)">
              <input className="input-control" value={modalRE.pattern} onChange={e => setModalRE(prev => ({ ...prev, pattern: e.target.value.toUpperCase() }))} placeholder="e.g. GGTCTC" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace' }} />
            </ModalField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <ModalField label="Cut Before (bp in pattern)">
                <input type="number" className="input-control" value={modalRE.cutBefore} onChange={e => setModalRE(prev => ({ ...prev, cutBefore: e.target.value }))} style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem' }} />
              </ModalField>
              <ModalField label="Overhang Type">
                <select className="input-control" value={modalRE.overhangType} onChange={e => setModalRE(prev => ({ ...prev, overhangType: e.target.value }))} style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem' }}>
                  <option value="5prime">5′ overhang</option>
                  <option value="3prime">3′ overhang</option>
                  <option value="blunt">Blunt</option>
                </select>
              </ModalField>
            </div>
            <ModalField label="Overhang Sequence">
              <input className="input-control" value={modalRE.overhang} onChange={e => setModalRE(prev => ({ ...prev, overhang: e.target.value.toUpperCase() }))} placeholder="e.g. AAAC" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace' }} />
            </ModalField>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Custom enzymes are shown in the RE sites panel for this session.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => setShowAddREModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => setShowAddREModal(false)} disabled={!modalRE.name || !modalRE.pattern}>Done</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── Sidebar helpers ──────────────────────────────────────────────────────────

function SidebarSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.75rem', border: '1px solid var(--glass-border)', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'white', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}
      >
        <span>{title}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0.65rem 0.85rem 0.85rem', background: 'var(--bg-primary)', borderTop: '1px solid var(--glass-border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SidebarBtn({ label, onClick, style }: { label: string; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick}
      className="sidebar-btn"
      style={{
        padding: '0.45rem 0.75rem', borderRadius: '8px', border: '1px solid var(--glass-border)',
        background: 'white', color: 'var(--text-primary)', cursor: 'pointer',
        fontSize: '0.78rem', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        fontWeight: 500,
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        ...style,
      }}
    >
      {label}
    </button>
  );
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 70px rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)' }}>
        {children}
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Add Primer Modal ─────────────────────────────────────────────────────────

interface PrimerModalState {
  name: string; sequence: string; strand: string; start: string; end: string; notes: string;
  reExtension: string; phospho5: boolean;
}

const RE_EXTENSIONS: Record<string, string> = {
  '': '',
  EcoRI: 'GAATTC',
  BamHI: 'GGATCC',
  HindIII: 'AAGCTT',
  NcoI: 'CCATGG',
  NdeI: 'CATATG',
  XhoI: 'CTCGAG',
  NotI: 'GCGGCCGC',
  SalI: 'GTCGAC',
  XbaI: 'TCTAGA',
  SpeI: 'ACTAGT',
  PstI: 'CTGCAG',
  KpnI: 'GGTACC',
  SacI: 'GAGCTC',
  ClaI: 'ATCGAT',
  SphI: 'GCATGC',
};

function AddPrimerModal({
  state, onChange, onSave, onCancel, template, isEditing = false,
}: {
  state: PrimerModalState; onChange: (s: PrimerModalState) => void; onSave: () => void; onCancel: () => void;
  template: string; isEditing?: boolean;
}) {
  const bindingSeq = state.sequence.toUpperCase().replace(/[^ACGT]/g, '');
  const reSeq = RE_EXTENSIONS[state.reExtension] ?? '';
  const displaySeq = (state.phospho5 ? '[p]' : '') + reSeq + bindingSeq;
  const primerColor = state.strand === 'reverse' ? '#a855f7' : '#3b82f6';

  // ── QC ──────────────────────────────────────────────────────────────────────
  const tm = bindingSeq ? calcTm(bindingSeq) : null;
  const gc = bindingSeq ? calcGC(bindingSeq) : null;
  const lenOk = bindingSeq.length >= 18 && bindingSeq.length <= 30;
  const gcOk  = gc !== null && gc >= 40 && gc <= 60;
  const endWarn = bindingSeq.length >= 3 && (bindingSeq.slice(-3) === 'GGG' || bindingSeq.slice(-3) === 'CCC');
  const hairpinWarn = useMemo(() => {
    if (bindingSeq.length < 12) return false;
    const rc = reverseComplement(bindingSeq);
    for (let i = 0; i <= bindingSeq.length - 6; i++) {
      if (rc.includes(bindingSeq.substring(i, i + 6))) return true;
    }
    return false;
  }, [bindingSeq]);
  const bindingSites = useMemo(() => {
    if (!bindingSeq || bindingSeq.length < 10 || !template) return null;
    const t = template.toUpperCase();
    const rc = reverseComplement(bindingSeq);
    let count = 0;
    let idx = t.indexOf(bindingSeq);
    while (idx !== -1) { count++; idx = t.indexOf(bindingSeq, idx + 1); }
    idx = t.indexOf(rc);
    while (idx !== -1) { count++; idx = t.indexOf(rc, idx + 1); }
    return count;
  }, [bindingSeq, template]);

  // ── Pull sequence from template by position ──────────────────────────────
  const pullFromTemplate = () => {
    const s = parseInt(state.start), e = parseInt(state.end);
    if (!template || isNaN(s) || isNaN(e) || s < 1 || e > template.length || s > e) return;
    const region = template.substring(s - 1, e).toUpperCase();
    onChange({ ...state, sequence: state.strand === 'reverse' ? reverseComplement(region) : region });
  };

  // ── Find binding position in template ───────────────────────────────────
  const bindPos = useMemo(() => {
    if (!bindingSeq || bindingSeq.length < 10 || !template) return null;
    const t = template.toUpperCase();
    const fwdIdx = t.indexOf(bindingSeq);
    if (fwdIdx !== -1) return { pos: fwdIdx + 1, strand: 'forward' as const };
    const rcIdx = t.indexOf(reverseComplement(bindingSeq));
    if (rcIdx !== -1) return { pos: rcIdx + 1, strand: 'reverse' as const };
    return null;
  }, [bindingSeq, template]);

  const qcStats = [
    { label: 'Tm',      value: tm !== null ? `${tm}°C` : '—',     color: 'var(--accent-blue)' },
    { label: 'GC%',     value: gc !== null ? `${gc}%` : '—',      color: gcOk  ? 'var(--accent-green)' : 'var(--accent-orange)' },
    { label: 'Length',  value: `${bindingSeq.length} nt`,          color: lenOk ? 'var(--accent-green)' : 'var(--accent-red)' },
    { label: 'Sites',   value: bindingSites !== null ? String(bindingSites) : '—', color: bindingSites === 1 ? 'var(--accent-green)' : 'var(--accent-orange)' },
    { label: '3′ End',  value: endWarn    ? 'Warn' : 'OK',         color: endWarn    ? 'var(--accent-red)'    : 'var(--accent-green)' },
    { label: 'Hairpin', value: hairpinWarn ? 'Risk' : 'OK',        color: hairpinWarn ? 'var(--accent-orange)' : 'var(--accent-green)' },
  ];

  return (
    <ModalOverlay onClose={onCancel}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{isEditing ? 'Edit Primer' : 'Add Primer'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Design · Validate · Save</div>
        </div>
        {/* Strand toggle */}
        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
          {(['forward', 'reverse'] as const).map(s => (
            <button key={s} onClick={() => onChange({ ...state, strand: s })}
              style={{ padding: '0.3rem 0.85rem', background: state.strand === s ? primerColor : 'white', color: state.strand === s ? 'white' : 'var(--text-muted)', border: 'none', borderLeft: s === 'reverse' ? '1px solid var(--glass-border)' : 'none', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', transition: 'background 0.15s' }}>
              {s === 'forward' ? '→ Fwd' : '← Rev'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* ── Name ── */}
        <ModalField label="Primer Name">
          <input className="input-control" value={state.name} onChange={e => onChange({ ...state, name: e.target.value })}
            placeholder="e.g. AmpR_Fwd" style={{ padding: '0.55rem 0.85rem', fontSize: '0.88rem' }} />
        </ModalField>

        {/* ── Sequence input ── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Binding Sequence (5′→3′)
            </label>
            <button
              onClick={() => { if (bindingSeq) onChange({ ...state, sequence: reverseComplement(bindingSeq) }); }}
              disabled={!bindingSeq}
              style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'white', cursor: bindingSeq ? 'pointer' : 'default', color: bindingSeq ? 'var(--accent-blue)' : 'var(--text-muted)', fontFamily: 'inherit' }}
            >↔ Rev. Complement</button>
          </div>
          <textarea
            className="input-control"
            value={state.sequence}
            onChange={e => onChange({ ...state, sequence: e.target.value.toUpperCase().replace(/[^ACGT\s]/g, '') })}
            placeholder="Paste or type binding sequence (A, C, G, T)…"
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: '0.9rem', letterSpacing: '0.06em', minHeight: 64, resize: 'vertical', wordBreak: 'break-all', lineHeight: 1.6, padding: '0.55rem 0.75rem' }}
          />
          {bindingSeq && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontFamily: 'monospace' }}>
              {bindingSeq.length} nt
              {bindPos && <span style={{ marginLeft: '0.75rem', color: primerColor }}>binds at position {bindPos.pos} ({bindPos.strand})</span>}
            </div>
          )}
        </div>

        {/* ── Position + Pull from template ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
          <ModalField label="Start (bp)">
            <input type="number" className="input-control" value={state.start} onChange={e => onChange({ ...state, start: e.target.value })}
              placeholder="1" min={1} style={{ padding: '0.45rem 0.6rem', fontSize: '0.85rem' }} />
          </ModalField>
          <ModalField label="End (bp)">
            <input type="number" className="input-control" value={state.end} onChange={e => onChange({ ...state, end: e.target.value })}
              placeholder={String(template.length)} min={1} style={{ padding: '0.45rem 0.6rem', fontSize: '0.85rem' }} />
          </ModalField>
          <button onClick={pullFromTemplate} disabled={!state.start || !state.end}
            style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', border: `1px solid ${state.start && state.end ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: state.start && state.end ? 'var(--accent-blue-15)' : 'white', cursor: state.start && state.end ? 'pointer' : 'default', fontSize: '0.72rem', fontFamily: 'inherit', color: state.start && state.end ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', marginBottom: '0.05rem' }}>
            Pull from template
          </button>
        </div>

        {/* ── QC stats (only when sequence entered) ── */}
        {bindingSeq.length > 0 && (
          <div style={{ padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>Quality Check</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
              {qcStats.map(({ label, value, color }) => (
                <div key={label} style={{ padding: '0.4rem 0.5rem', background: 'white', borderRadius: '6px', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.1rem' }}>{label}</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RE Tail + phospho ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <ModalField label="RE Tail (5′ overhang)">
            <select className="input-control" value={state.reExtension} onChange={e => onChange({ ...state, reExtension: e.target.value })}
              style={{ padding: '0.5rem', fontSize: '0.82rem' }}>
              <option value="">None</option>
              {Object.keys(RE_EXTENSIONS).filter(k => k).map(k => (
                <option key={k} value={k}>{k}  —  {RE_EXTENSIONS[k]}</option>
              ))}
            </select>
          </ModalField>
          <div style={{ paddingTop: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={state.phospho5} onChange={e => onChange({ ...state, phospho5: e.target.checked })} />
              5′ Phosphorylation
            </label>
          </div>
        </div>

        {/* ── Final sequence preview ── */}
        {bindingSeq && (
          <div style={{ padding: '0.85rem 1rem', background: '#f8faff', border: `1px solid ${primerColor}33`, borderRadius: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Final Primer Sequence (5′→3′)</div>
              <button onClick={() => navigator.clipboard.writeText(displaySeq.replace('[p]',''))} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit' }}>Copy</button>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all', fontWeight: 700, lineHeight: 1.6 }}>
              {state.phospho5 && <span style={{ color: '#ef4444', marginRight: '0.15rem' }}>[p]</span>}
              {reSeq && <span style={{ color: '#f59e0b' }}>{reSeq}</span>}
              <span style={{ color: primerColor }}>{bindingSeq}</span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Total: {reSeq.length + bindingSeq.length} nt
              {reSeq && <span style={{ marginLeft: '0.5rem' }}>({reSeq.length} RE tail + {bindingSeq.length} binding)</span>}
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        <ModalField label="Notes / Purpose">
          <textarea className="input-control" value={state.notes} onChange={e => onChange({ ...state, notes: e.target.value })}
            placeholder="Purpose, target gene, experiment notes…"
            style={{ padding: '0.55rem 0.75rem', fontSize: '0.82rem', minHeight: 44, resize: 'none' }} />
        </ModalField>

      </div>

      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
        <button className="btn btn-secondary" onClick={onCancel} style={{ padding: '0.55rem 1.25rem' }}>Cancel</button>
        <button className="btn btn-primary" onClick={onSave} disabled={!state.name || !bindingSeq}
          style={{ padding: '0.55rem 1.5rem', fontWeight: 800 }}>
          {isEditing ? 'Update Primer' : 'Save Primer'}
        </button>
      </div>
    </ModalOverlay>
  );
}


function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: color + '18', color, fontWeight: 600, border: `1px solid ${color}44` }}>{label}</span>
  );
}

// ─── Pill ────────────────────────────────────────────────────────────────────

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: '0.78rem', display: 'flex', gap: '0.3rem' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
    </span>
  );
}

// ─── Linear Map ──────────────────────────────────────────────────────────────

function assignRows(features: SequenceFeature[]): Map<string, number> {
  const sorted = [...features].sort((a, b) => a.start - b.start);
  const rowEnds: number[] = [];
  const map = new Map<string, number>();
  for (const f of sorted) {
    let row = rowEnds.findIndex(e => e < f.start);
    if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = f.end;
    map.set(f.id, row);
  }
  return map;
}

// ─── RE Sites Panel ──────────────────────────────────────────────────────────

function RESitesPanel({
  reSitesByEnzyme, sequence, circular, setName, onSetName,
}: {
  reSitesByEnzyme: Map<string, ReSite[]>;
  sequence: string;
  circular: boolean;
  /** Shared with the map, so the two never disagree about what was asked for. */
  setName: string;
  onSetName: (name: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(
    () => [...reSitesByEnzyme.entries()].sort((a, b) => a[1].length - b[1].length),
    [reSitesByEnzyme],
  );
  const uniqueCutters = useMemo(() => entries.filter(([, s]) => s.length === 1), [entries]);

  // Which of these sites carry a methyl group that stops the enzyme binding.
  // Only enzymes that have sites here can be blocked at one.
  const blocked = useMemo(
    () => blockedSites(sequence, entries.map(([n]) => n), { circular }),
    [sequence, circular, entries],
  );

  const inSet = useMemo(() => {
    if (setName === 'all') return null;
    const set = STARTER_SETS.find(s => s.name === setName);
    return set ? new Set(resolveSet(set)) : null;
  }, [setName]);

  const displayed = (showAll ? entries : uniqueCutters).filter(([n]) => !inSet || inSet.has(n));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--accent-green)' }}>{uniqueCutters.length} unique cutters</strong>
          <span style={{ color: 'var(--text-muted)' }}> · {entries.length} enzymes total with sites</span>
        </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              value={setName}
              onChange={e => onSetName(e.target.value)}
              className="input-control"
              style={{ fontSize: '0.76rem', padding: '0.3rem 0.5rem' }}
              title="Narrow to a set of enzymes"
            >
              <option value="all">All enzymes</option>
              {STARTER_SETS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
        <button onClick={() => setShowAll(!showAll)} style={{ padding: '0.3rem 0.75rem', border: '1px solid var(--glass-border)', borderRadius: '6px', background: showAll ? 'var(--accent-blue-15)' : 'white', color: showAll ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit' }}>
          {showAll ? 'Unique only' : 'Show all'}
        </button>
          </div>
      </div>
        {(() => {
          // Warn about what is on screen. A note for an enzyme the filter has
          // hidden is noise, and a documented block is worth more than a dozen
          // "check the chart" notes -- so the known ones come first and the
          // rest are counted rather than listed.
          const shown = new Set(displayed.map(([n]) => n));
          const relevant = blocked.filter(b => shown.has(b.enzyme));
          const known = relevant.filter(b => b.known);
          const unsure = relevant.filter(b => !b.known);
          if (relevant.length === 0) return null;
          return (
            <div style={{
              padding: '0.75rem 1rem', marginBottom: '0.9rem', borderRadius: 7,
              background: known.length ? 'rgba(217,119,6,0.06)' : 'var(--bg-primary)',
              border: `1px solid ${known.length ? 'rgba(217,119,6,0.25)' : 'var(--glass-border)'}`,
            }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: known.length ? '#a3560a' : 'var(--text-muted)', marginBottom: '0.4rem' }}>
                Methylation
              </div>
              {known.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {known.slice(0, 6).map((b, i) => (
                    <li key={i} style={{ fontSize: '0.79rem', lineHeight: 1.5, color: '#a3560a' }}>{b.message}</li>
                  ))}
                </ul>
              )}
              {unsure.length > 0 && (
                <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: known.length ? '0.5rem 0 0' : 0, lineHeight: 1.5 }}>
                  {unsure.length} other site{unsure.length === 1 ? '' : 's'} here
                  {unsure.length === 1 ? ' overlaps' : ' overlap'} a Dam or Dcm sequence
                  ({[...new Set(unsure.map(b => b.enzyme))].slice(0, 6).join(', ')}
                  {new Set(unsure.map(b => b.enzyme)).size > 6 ? '…' : ''}).
                  Whether those enzymes mind is a property of the enzyme — check the supplier&rsquo;s chart.
                </p>
              )}
            </div>
          );
        })()}

      {displayed.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No restriction sites found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['Enzyme', 'Pattern', '# Cuts', 'Position(s)', 'Overhang', 'End type'].map(h => (
                  <th key={h} style={{ padding: '0.45rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map(([enz, sites]) => {
                const isUnique = sites.length === 1;
                const enzObj = ENZYMES[enz];
                return (
                  <tr key={enz} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <span style={{ fontWeight: 600, color: isUnique ? 'var(--accent-green)' : 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sites[0].color, display: 'inline-block' }} />
                        {enz}
                      </span>
                      {(() => {
                        const iso = isoschizomersOf(enz);
                        if (iso.identical.length === 0) return null;
                        return (
                          <span
                            title={`Same site, same cut: ${iso.identical.join(', ')}` +
                              (iso.neoschizomers.length
                                ? `\nSame site, cut elsewhere (different ends): ${iso.neoschizomers.join(', ')}`
                                : '')}
                            style={{ fontSize: '0.62rem', marginLeft: '0.35rem', color: 'var(--text-muted)', cursor: 'help' }}
                          >
                            +{iso.identical.length}
                          </span>
                        );
                      })()}
                      {isUnique && <span style={{ fontSize: '0.62rem', marginLeft: '0.35rem', color: 'var(--accent-green)', background: 'rgba(5,150,105,0.08)', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>unique</span>}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--accent-blue)', fontSize: '0.8rem' }}>{enzObj?.pattern ?? '—'}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace' }}>{sites.length}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{sites.map(s => s.cutPos).join(', ')}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: 'var(--accent-purple)' }}>{sites[0].overhang}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)' }}>{sites[0].overhangType}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Sequence Panel ──────────────────────────────────────────────────────────

function baseColor(base: string): string {
  switch (base.toUpperCase()) {
    case 'A': return '#16a34a';
    case 'T': return '#dc2626';
    case 'G': return '#ea580c';
    case 'C': return '#2563eb';
    default: return '#374151';
  }
}

const CODON_TABLE: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
};
const AA_3: Record<string, string> = {
  F:'Phe',L:'Leu',I:'Ile',M:'Met',V:'Val',S:'Ser',P:'Pro',T:'Thr',A:'Ala',
  Y:'Tyr',H:'His',Q:'Gln',N:'Asn',K:'Lys',D:'Asp',E:'Glu',C:'Cys',W:'Trp',
  R:'Arg',G:'Gly','*':'Stop',
};
function translate1(seq: string): string {
  let out = '';
  for (let i = 0; i + 2 < seq.length; i += 3) out += CODON_TABLE[seq.substring(i, i + 3).toUpperCase()] ?? 'X';
  return out;
}
function translate3(seq: string): string {
  const r: string[] = [];
  for (let i = 0; i + 2 < seq.length; i += 3) {
    const aa = CODON_TABLE[seq.substring(i, i + 3).toUpperCase()] ?? 'X';
    r.push(AA_3[aa] ?? aa);
  }
  return r.join('-');
}

function GCGraph({ sequence }: { sequence: string }) {
  const WINDOW = 100;
  const windows: number[] = [];
  for (let i = 0; i < sequence.length - WINDOW; i += WINDOW) {
    windows.push(calcGC(sequence.substring(i, i + WINDOW)));
  }
  if (windows.length === 0) return null;
  const W = 600;
  const H = 60;
  const barW = Math.max(1, W / windows.length);
  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        GC Content ({WINDOW} bp window)
      </div>
      <svg width={W} height={H + 20} style={{ display: 'block', overflow: 'visible' }}>
        {/* Axis lines */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#e2e8f0" strokeWidth={1} />
        <line x1={0} y1={H * 0.4} x2={W} y2={H * 0.4} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,4" />
        <text x={W + 2} y={H * 0.4 + 4} fontSize={8} fill="#94a3b8">60%</text>
        <line x1={0} y1={H * 0.6} x2={W} y2={H * 0.6} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,4" />
        <text x={W + 2} y={H * 0.6 + 4} fontSize={8} fill="#94a3b8">40%</text>
        {windows.map((gc, i) => {
          const barH = (gc / 100) * H;
          const color = gc >= 40 && gc <= 60 ? '#22c55e' : gc < 40 ? '#3b82f6' : '#ef4444';
          return (
            <rect
              key={i}
              x={i * barW}
              y={H - barH}
              width={Math.max(barW - 0.5, 1)}
              height={barH}
              fill={color}
              opacity={0.7}
            />
          );
        })}
        {/* X-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
          const pos = Math.round(frac * sequence.length);
          const x = frac * W;
          return (
            <text key={i} x={x} y={H + 14} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="monospace">
              {pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : pos}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function SequencePanel({
  sequence, features, reSites, selection, onSelect, onMakePrimer,
}: {
  sequence: string;
  features: SequenceFeature[];
  reSites: ReSite[];
  selection: { start: number; end: number } | null;
  onSelect: (sel: { start: number; end: number } | null) => void;
  onMakePrimer?: (sel: { start: number; end: number }) => void;
}) {
  const BASES_PER_LINE = 60;
  const GROUP = 10;
  const [dsMode, setDsMode] = useState<'single' | 'double'>('single');
  const [viewMode, setViewMode] = useState<'normal' | 'colored' | 'codon'>('normal');
  const [searchQuery, setSearchQuery] = useState('');
  const [clickStart, setClickStart] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; abs: number } | null>(null);

  const rc = useMemo(() => reverseComplement(sequence), [sequence]);

  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 3) return [];
    const q = searchQuery.toUpperCase().replace(/[^ACGT]/g, '');
    if (!q) return [];
    const matches: number[] = [];
    let idx = 0;
    while ((idx = sequence.toUpperCase().indexOf(q, idx)) !== -1) {
      matches.push(idx);
      idx++;
    }
    return matches;
  }, [sequence, searchQuery]);

  const searchLen = useMemo(() => {
    const q = searchQuery.toUpperCase().replace(/[^ACGT]/g, '');
    return q.length;
  }, [searchQuery]);

  // Per-character styling: feature color takes priority, then RE recognition site
  const charStyle = useMemo(() => {
    const style: ({ bg: string; border?: string; isSearch?: boolean } | null)[] = new Array(sequence.length).fill(null);
    reSites.forEach(s => {
      const start = Math.max(0, s.recognitionStart);
      const end = Math.min(sequence.length, s.recognitionStart + s.recognitionLen);
      for (let i = start; i < end; i++) {
        if (!style[i]) style[i] = { bg: '#fef08a', border: '#ca8a04' };
      }
    });
    features.forEach(feat => {
      for (let i = feat.start - 1; i < feat.end && i < sequence.length; i++) {
        style[i] = { bg: feat.color + '33', border: feat.color };
      }
    });
    // Search matches override everything
    searchMatches.forEach(pos => {
      for (let i = pos; i < pos + searchLen && i < sequence.length; i++) {
        style[i] = { bg: '#fbbf24', border: '#d97706', isSearch: true };
      }
    });
    // Selection highlight
    if (selection) {
      for (let i = selection.start - 1; i < selection.end && i < sequence.length; i++) {
        const existing = style[i];
        style[i] = { bg: 'rgba(59,130,246,0.18)', border: '#3b82f6', isSearch: existing?.isSearch };
      }
    }
    return style;
  }, [sequence, features, reSites, searchMatches, searchLen, selection]);

  const lines = [];
  for (let i = 0; i < sequence.length; i += BASES_PER_LINE) {
    lines.push({ start: i, text: sequence.substring(i, i + BASES_PER_LINE) });
  }

  const handleBaseClick = (abs: number) => {
    if (clickStart === null) {
      setClickStart(abs);
    } else {
      const s = Math.min(clickStart, abs) + 1;
      const e = Math.max(clickStart, abs) + 1;
      onSelect({ start: s, end: e });
      setClickStart(null);
      setTooltip(null);
    }
  };

  const handleBaseMouseEnter = (abs: number, e: React.MouseEvent) => {
    setTooltip({ x: e.clientX, y: e.clientY, abs });
  };

  const handleBaseMouseMove = (abs: number, e: React.MouseEvent) => {
    setTooltip({ x: e.clientX, y: e.clientY, abs });
  };

  // Compute what the tooltip should show
  const tooltipContent = React.useMemo(() => {
    if (!tooltip) return null;
    if (clickStart !== null) {
      // actively selecting — show live Tm of the range so far
      const s = Math.min(clickStart, tooltip.abs);
      const e = Math.max(clickStart, tooltip.abs);
      const len = e - s + 1;
      if (len < 4) return { label: `${len} bp`, tm: null, gc: null };
      const seq = sequence.substring(s, e + 1).toUpperCase();
      return { label: `${s + 1}–${e + 1} · ${len} bp`, tm: calcTm(seq), gc: calcGC(seq) };
    }
    // hovering without selection active — show single-base position
    return { label: `pos ${tooltip.abs + 1}`, tm: null, gc: null };
  }, [tooltip, clickStart, sequence]);

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="input-control"
          placeholder="Search sequence (IUPAC)…"
          style={{ padding: '0.38rem 0.75rem', fontSize: '0.82rem', flex: 1, minWidth: 180 }}
        />
        {searchMatches.length > 0 && (
          <span style={{ fontSize: '0.76rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
            {searchMatches.length} match{searchMatches.length !== 1 ? 'es' : ''}
          </span>
        )}
        {searchQuery.length >= 3 && searchMatches.length === 0 && (
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>No matches</span>
        )}
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {([['normal','Plain'], ['colored','A/T/G/C Colors'], ['codon','Codon View']] as const).map(([m, label]) => (
          <button key={m} onClick={() => setViewMode(m)} style={{ padding: '0.28rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: viewMode === m ? 'var(--accent-blue-15)' : 'white', color: viewMode === m ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: viewMode === m ? 600 : 400 }}>
            {label}
          </button>
        ))}
        {(['single', 'double'] as const).map(m => (
          <button key={m} onClick={() => setDsMode(m)} style={{ padding: '0.28rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: dsMode === m ? 'rgba(124,58,237,0.1)' : 'white', color: dsMode === m ? '#7c3aed' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: dsMode === m ? 600 : 400 }}>
            {m === 'single' ? '1-strand' : '2-strand'}
          </button>
        ))}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Click base to start, click again to end selection</span>
      </div>

      {/* Live selection info: Tm, GC, Make Primer */}
      {selection && (() => {
        const selSeq = sequence.substring(selection.start - 1, selection.end).toUpperCase();
        const tm = selSeq.length >= 4 ? calcTm(selSeq) : null;
        const gc = selSeq.length >= 4 ? calcGC(selSeq) : null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.9rem', marginBottom: '0.75rem', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
              {selection.start}–{selection.end} ({selection.end - selection.start + 1} bp)
            </span>
            {tm !== null && <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Tm: <strong>{tm}°C</strong></span>}
            {gc !== null && <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>GC: <strong>{gc}%</strong></span>}
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selSeq.length > 30 ? selSeq.slice(0, 15) + '…' + selSeq.slice(-15) : selSeq}</span>
            {onMakePrimer && selection.end - selection.start + 1 >= 4 && (
              <button
                onClick={() => { setClickStart(null); setTooltip(null); onMakePrimer?.({ start: selection.start, end: selection.end }); }}
                style={{ marginLeft: 'auto', padding: '0.3rem 0.75rem', borderRadius: '6px', border: '1px solid var(--accent-blue)', background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: 600 }}
              >
                🧬 Make Primer →
              </button>
            )}
            <button onClick={() => onSelect(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', padding: 0 }}>✕</button>
          </div>
        );
      })()}
      {/* ── Copy toolbar ── */}
      {selection && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#f8fafc', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: '0.25rem', fontWeight: 600 }}>Copy:</span>
          {[
            { label: "Top 5′→3′", action: () => navigator.clipboard.writeText(sequence.substring(selection.start - 1, selection.end).toUpperCase()) },
            { label: "Bottom 3′→5′", action: () => navigator.clipboard.writeText(reverseComplement(sequence.substring(selection.start - 1, selection.end)).split('').reverse().join('').toUpperCase()) },
            { label: 'Rev. Complement', action: () => navigator.clipboard.writeText(reverseComplement(sequence.substring(selection.start - 1, selection.end)).toUpperCase()) },
            { label: 'FASTA', action: () => navigator.clipboard.writeText(`>selection_${selection.start}_${selection.end}\n${sequence.substring(selection.start - 1, selection.end).toUpperCase()}`) },
            { label: '1-letter AA', action: () => navigator.clipboard.writeText(translate1(sequence.substring(selection.start - 1, selection.end))) },
            { label: '3-letter AA', action: () => navigator.clipboard.writeText(translate3(sequence.substring(selection.start - 1, selection.end))) },
          ].map(({ label, action }) => (
            <button key={label} onClick={action} style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 12, height: 10, background: '#fef08a', border: '1px solid #ca8a04', display: 'inline-block', borderRadius: '1px' }} />
          Restriction site
        </span>
        <span style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 12, height: 10, background: '#fbbf2480', border: '1px solid #d97706', display: 'inline-block', borderRadius: '1px' }} />
          Search match
        </span>
        <span style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
          <span style={{ width: 12, height: 10, background: 'rgba(59,130,246,0.18)', border: '1px solid #3b82f6', display: 'inline-block', borderRadius: '1px' }} />
          Selection
        </span>
        {features.map(f => (
          <span key={f.id} style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
            <span style={{ width: 12, height: 10, background: f.color + '33', border: `1px solid ${f.color}`, display: 'inline-block', borderRadius: '1px' }} />
            {f.name}
          </span>
        ))}
      </div>

      {/* Sequence */}
      <div style={{ fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 1.9, overflowX: 'auto', background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
        {lines.map(({ start, text }) => {
          return (
            <div key={start} style={{ marginBottom: dsMode === 'double' ? '0.6rem' : 0 }}>
              {/* Forward strand */}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 52, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>{start + 1}</span>
                <div>
                  {Array.from({ length: Math.ceil(text.length / GROUP) }, (_, gi) => {
                    const gStart = gi * GROUP;
                    const group = text.substring(gStart, gStart + GROUP);
                    return (
                      <span key={gi} style={{ marginRight: '0.45rem' }}>
                        {group.split('').map((base, bi) => {
                          const abs = start + gStart + bi;
                          const s = charStyle[abs];

                          // Codon mode: check if start of codon is ATG or stop
                          let codonHighlight: string | null = null;
                          if (viewMode === 'codon') {
                            const codonStart = abs - (abs % 3);
                            const codon = sequence.substring(codonStart, codonStart + 3).toUpperCase();
                            if (abs % 3 === 0 && codon === 'ATG') codonHighlight = 'rgba(34,197,94,0.18)';
                            else if (abs % 3 === 0 && ['TAA','TAG','TGA'].includes(codon)) codonHighlight = 'rgba(239,68,68,0.18)';
                          }

                          const textColor = viewMode === 'colored' || viewMode === 'codon' ? baseColor(base) : 'inherit';

                          return (
                            <span
                              key={bi}
                              onClick={() => handleBaseClick(abs)}
                              onMouseEnter={ev => handleBaseMouseEnter(abs, ev)}
                              onMouseMove={ev => handleBaseMouseMove(abs, ev)}
                              onMouseLeave={() => setTooltip(null)}
                              style={{
                                display: 'inline-block',
                                width: '1ch',
                                textAlign: 'center',
                                background: s?.bg ?? codonHighlight ?? 'transparent',
                                borderBottom: s?.border ? `2px solid ${s.border}` : 'none',
                                borderRadius: '1px',
                                cursor: clickStart !== null ? 'crosshair' : 'pointer',
                                color: textColor,
                                fontWeight: viewMode === 'colored' ? 600 : 'inherit',
                                boxSizing: 'border-box',
                              }}
                            >
                              {base}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
                <span style={{ color: 'var(--text-muted)', userSelect: 'none', flexShrink: 0 }}>{start + text.length}</span>
              </div>

              {/* Base-pair bonds row */}
              {dsMode === 'double' && (
                <div style={{ display: 'flex', gap: '0.75rem', lineHeight: 1, margin: '1px 0' }}>
                  <span style={{ minWidth: 52, flexShrink: 0 }} />
                  <div style={{ fontFamily: 'monospace', fontSize: '0.76rem', color: '#cbd5e1' }}>
                    {Array.from({ length: Math.ceil(text.length / GROUP) }, (_, gi) => {
                      const gStart = gi * GROUP;
                      const group = text.substring(gStart, gStart + GROUP);
                      return (
                        <span key={gi} style={{ marginRight: '0.45rem' }}>
                          {group.split('').map((_, bi2) => (
                            <span key={bi2} style={{ display: 'inline-block', width: '1ch', textAlign: 'center' }}>|</span>
                          ))}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Reverse complement strand — each base aligned directly below forward */}
              {dsMode === 'double' && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <span style={{ color: '#64748b', minWidth: 52, textAlign: 'right', userSelect: 'none', flexShrink: 0, fontSize: '0.7rem' }}>3′</span>
                  <div>
                    {Array.from({ length: Math.ceil(text.length / GROUP) }, (_, gi) => {
                      const gStart = gi * GROUP;
                      const group = text.substring(gStart, gStart + GROUP);
                      return (
                        <span key={gi} style={{ marginRight: '0.45rem' }}>
                          {group.split('').map((_, bi) => {
                            const abs = start + gStart + bi;
                            // complement base aligned directly below forward base
                            const compBase = rc[rc.length - 1 - abs] ?? '?';
                            return (
                              <span key={bi} style={{ display: 'inline-block', width: '1ch', textAlign: 'center', color: viewMode === 'colored' ? baseColor(compBase) : '#64748b' }}>
                                {compBase}
                              </span>
                            );
                          })}
                        </span>
                      );
                    })}
                  </div>
                  <span style={{ color: '#64748b', userSelect: 'none', flexShrink: 0, fontSize: '0.7rem' }}>5′</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* GC Content Graph */}
      <GCGraph sequence={sequence} />

      {/* ── Live Tm tooltip ── */}
      {tooltip && tooltipContent && (clickStart !== null || tooltipContent.tm !== null) && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 14,
          top: tooltip.y - 44,
          zIndex: 1500,
          pointerEvents: 'none',
          background: '#0f172a',
          color: '#f1f5f9',
          borderRadius: '7px',
          padding: '0.3rem 0.6rem',
          fontSize: '0.72rem',
          fontFamily: 'monospace',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          whiteSpace: 'nowrap',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
        }}>
          {clickStart !== null && (
            <span style={{ color: '#94a3b8' }}>
              {tooltipContent.label}
            </span>
          )}
          {tooltipContent.tm !== null && (
            <>
              <span style={{ color: '#60a5fa', fontWeight: 700 }}>Tm {tooltipContent.tm}°C</span>
              <span style={{ color: '#86efac' }}>GC {tooltipContent.gc}%</span>
            </>
          )}
          {clickStart !== null && tooltipContent.tm === null && (
            <span style={{ color: '#64748b', fontSize: '0.65rem' }}>select end…</span>
          )}
          {/* small arrow */}
          <div style={{
            position: 'absolute', bottom: -5, left: 14,
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #0f172a',
          }} />
        </div>
      )}

    </div>
  );
}

// ─── ORFs Panel ───────────────────────────────────────────────────────────────

const START_CODON_INFO: Record<string, string> = {
  ATG: 'canonical',
  GTG: 'alternative',
  TTG: 'alternative',
};

function ORFsPanel({ sequence }: { sequence: string }) {
  const [minLen, setMinLen] = useState(100);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showAltStart, setShowAltStart] = useState(false);
  const [showFrames, setShowFrames] = useState(false);

  const orfs = useMemo(() => findORFs(sequence, minLen), [sequence, minLen]);

  const filteredOrfs = useMemo(() => {
    return orfs.filter(orf => {
      if (!showAltStart) {
        const startCodon = orf.strand === '+'
          ? sequence.substring(orf.start, orf.start + 3).toUpperCase()
          : reverseComplement(sequence.substring(orf.end - 3, orf.end)).toUpperCase();
        if (startCodon !== 'ATG') return false;
      }
      return true;
    });
  }, [orfs, showAltStart, sequence]);

  const FRAME_COLORS: Record<number, string> = {
    1: '#3b82f6', 2: '#22c55e', 3: '#a855f7',
    [-1]: '#ef4444', [-2]: '#f59e0b', [-3]: '#06b6d4',
  };

  const selected = selectedIdx !== null ? filteredOrfs[selectedIdx] : null;

  function FrameDiagram({ orf }: { orf: ORF }) {
    const W = 280;
    const frames = [1, 2, 3, -1, -2, -3];
    return (
      <svg width={W} height={frames.length * 12 + 4} style={{ display: 'block' }}>
        {frames.map((f, fi) => {
          const color = FRAME_COLORS[f] ?? '#94a3b8';
          const isThis = f === orf.frame;
          const y = fi * 12 + 2;
          const x1 = (orf.start / sequence.length) * W;
          const x2 = (orf.end / sequence.length) * W;
          return (
            <g key={f}>
              <rect x={0} y={y} width={W} height={8} fill="#f1f5f9" rx={2} />
              {isThis && <rect x={x1} y={y} width={Math.max(x2 - x1, 3)} height={8} fill={color} rx={2} opacity={0.85} />}
              <text x={W + 3} y={y + 6} fontSize={7} fill={color} dominantBaseline="middle">
                {f > 0 ? `+${f}` : f}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  function getStartCodon(orf: ORF): string {
    const seq = orf.strand === '+'
      ? sequence.substring(orf.start, orf.start + 3).toUpperCase()
      : reverseComplement(sequence.substring(orf.end - 3, orf.end)).toUpperCase();
    return seq;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Min length:</label>
          <input
            type="range" min={30} max={600} step={30} value={minLen}
            onChange={e => { setMinLen(parseInt(e.target.value)); setSelectedIdx(null); }}
            style={{ width: 120 }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', minWidth: 52 }}>{minLen} nt</span>
        </div>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Found <strong style={{ color: 'var(--text-primary)' }}>{filteredOrfs.length}</strong> ORFs across 6 frames
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => setShowAltStart(p => !p)} style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: showAltStart ? 'rgba(245,158,11,0.12)' : 'white', color: showAltStart ? '#d97706' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {showAltStart ? '✓ ' : ''}Alt starts (GTG/TTG)
          </button>
          <button onClick={() => setShowFrames(p => !p)} style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '5px', border: '1px solid var(--glass-border)', background: showFrames ? 'var(--accent-blue-15)' : 'white', color: showFrames ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {showFrames ? '✓ ' : ''}Show reading frames
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {[1,2,3,-1,-2,-3].map(f => (
            <span key={f} style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '2px', background: FRAME_COLORS[f], display: 'inline-block' }} />
              {f > 0 ? `+${f}` : f}
            </span>
          ))}
        </div>
      </div>

      {filteredOrfs.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          No ORFs ≥ {minLen} nt found. Try reducing the minimum length.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: 420, overflowY: 'auto' }}>
            {filteredOrfs.map((orf, i) => {
              const startCodon = orf.strand === '+'
                ? sequence.substring(orf.start, orf.start + 3).toUpperCase()
                : reverseComplement(sequence.substring(orf.end - 3, orf.end)).toUpperCase();
              const isCanonical = startCodon === 'ATG';
              const color = isCanonical ? '#16a34a' : '#86efac';
              const isActive = selectedIdx === i;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(isActive ? null : i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.6rem 0.85rem', borderRadius: '7px', textAlign: 'left',
                    border: `1px solid ${isActive ? color : 'var(--glass-border)'}`,
                    background: isActive ? color + '12' : 'white',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '2px', background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>ORF {i + 1}</span>
                      {showFrames && <span style={{ fontSize: '0.68rem', color, background: color + '18', padding: '0.1rem 0.35rem', borderRadius: '3px', fontWeight: 600 }}>
                        frame {orf.frame > 0 ? `+${orf.frame}` : orf.frame}
                      </span>}
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'var(--bg-primary)', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                        {orf.strand === '+' ? '→' : '←'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {orf.start + 1}–{orf.end} · {orf.length} nt · {orf.protein.length} aa
                    </div>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {orf.protein.slice(0, 10)}…
                  </span>
                </button>
              );
            })}
          </div>

          {selected && (() => {
            const startCodon = getStartCodon(selected);
            const codonInfo = START_CODON_INFO[startCodon];
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ padding: '0.75rem 1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Frame Diagram</div>
                  <FrameDiagram orf={selected} />
                </div>

                <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', border: `1px solid ${FRAME_COLORS[selected.frame] ?? '#94a3b8'}44` }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>ORF Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    {[
                      ['Position', `${selected.start + 1}–${selected.end}`],
                      ['Frame', selected.frame > 0 ? `+${selected.frame}` : String(selected.frame)],
                      ['Strand', selected.strand === '+' ? 'Forward (+)' : 'Reverse (−)'],
                      ['nt length', `${selected.length} nt`],
                      ['aa length', `${selected.protein.length} aa`],
                      ['Est. MW', `~${(selected.protein.length * 0.11).toFixed(1)} kDa`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{k}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}>{v}</div>
                      </div>
                    ))}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Start codon</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {startCodon}
                        {codonInfo && (
                          <span style={{ fontSize: '0.68rem', color: codonInfo === 'canonical' ? 'var(--accent-green)' : '#f59e0b', background: codonInfo === 'canonical' ? 'rgba(5,150,105,0.08)' : 'rgba(245,158,11,0.1)', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                            {codonInfo}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Protein sequence</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.8, background: 'white', padding: '0.75rem', borderRadius: '7px', border: '1px solid var(--glass-border)', overflowX: 'auto', wordBreak: 'break-all', color: 'var(--text-secondary)', maxHeight: 180, overflowY: 'auto' }}>
                    {selected.protein}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem' }}>
                    <button
                      onClick={() => navigator.clipboard.writeText(selected.protein)}
                      style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      📋 Copy protein sequence
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(sequence.substring(selected.start, selected.end))}
                      style={{ fontSize: '0.72rem', color: 'var(--accent-green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      📋 Copy DNA
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── PCR Panel ────────────────────────────────────────────────────────────────

function PCRPanel({ sequenceId, sequenceName, template, primers, result, fwd, rev, saved, onFwdChange, onRevChange, onRun, onSave }: {
  sequenceId: string; sequenceName: string; template: string;
  primers: SavedPrimer[];
  result: PCRResult | null; fwd: string; rev: string; saved: boolean;
  onFwdChange: (v: string) => void; onRevChange: (v: string) => void;
  onRun: () => void; onSave: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  void sequenceId; void sequenceName; void template;
  const fwdPrimers = primers.filter(p => p.direction === 'forward');
  const revPrimers = primers.filter(p => p.direction === 'reverse');
  const bands = result?.success ? [{ size: result.size, label: `${result.size} bp (amplicon)`, color: 'var(--accent-blue)' }] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '1rem' }}>PCR Parameters</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <PrimerInputField label="Forward Primer (5′→3′)" value={fwd} onChange={onFwdChange} suggestions={fwdPrimers} />
          <PrimerInputField label="Reverse Primer (5′→3′)" value={rev} onChange={onRevChange} suggestions={revPrimers} />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={onRun} disabled={!fwd || !rev} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            🧪 Run PCR
          </button>
          {result && !saved && (
            <button className="btn btn-secondary" onClick={() => startTransition(() => { onSave(); })} disabled={isPending} style={{ fontSize: '0.82rem' }}>
              {isPending ? 'Saving…' : '💾 Save simulation'}
            </button>
          )}
          {saved && <span style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>✓ Saved</span>}
        </div>
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'start' }}>
          <div className="glass-panel" style={{ padding: '1rem', width: 140 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>Gel</div>
            <GelLane bands={bands} />
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: result.success ? 'var(--accent-green)' : 'var(--accent-red)', display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.92rem', color: result.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>{result.message}</span>
            </div>
            {result.success && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <StatPill label="Amplicon size" value={`${result.size} bp`} />
                  <StatPill label="Fwd binding" value={`pos ${result.fwdPos + 1}`} />
                  <StatPill label="Rev binding" value={`pos ${result.revPos + 1}`} />
                  <StatPill label="GC%" value={`${calcGC(result.product)}%`} />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase' }}>Product sequence</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'white', border: '1px solid var(--glass-border)', padding: '0.6rem 0.9rem', borderRadius: '6px', overflowX: 'auto', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {result.product.length > 120 ? result.product.slice(0, 60) + '…' + result.product.slice(-60) : result.product}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ligation Panel ───────────────────────────────────────────────────────────

function LigationPanel({ sequenceId, sequenceName, vectorSeq, vectorSize, result, insertName, insertSeq, saved, onInsertNameChange, onInsertSeqChange, onRun, onSave }: {
  sequenceId: string; sequenceName: string; vectorSeq: string; vectorSize: number;
  result: LigationResult | null; insertName: string; insertSeq: string; saved: boolean;
  onInsertNameChange: (v: string) => void; onInsertSeqChange: (v: string) => void;
  onRun: () => void; onSave: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  void sequenceId; void sequenceName; void vectorSeq;
  const bands = result?.success ? [{ size: result.size, label: `${result.size} bp (construct)`, color: 'var(--accent-purple)' }] : [];
  const vectorBand = [{ size: vectorSize, label: `${vectorSize} bp (vector)`, color: 'var(--accent-blue)' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.25rem', color: 'var(--text-primary)' }}>🔗 SnapGene-AI Pro Ligator</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Professional Multi-Fragment Assembly & Ligation Simulation</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 56, flexShrink: 0 }}>VECTOR</span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--accent-blue)' }}>{sequenceName}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{vectorSize.toLocaleString()} bp</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>Insert name</label>
              <input value={insertName} onChange={e => onInsertNameChange(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', width: '100%' }} placeholder="insert" />
            </div>
            <div style={{ flex: 3 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                Insert sequence
                {insertSeq && <span style={{ marginLeft: '0.4rem', color: 'var(--accent-blue)' }}>{insertSeq.replace(/[^ACGT]/gi,'').length} bp</span>}
              </label>
              <input value={insertSeq} onChange={e => onInsertSeqChange(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%' }} placeholder="Paste insert sequence…" />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={onRun} disabled={!insertSeq} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            ✂ Ligate
          </button>
          {result && !saved && (
            <button className="btn btn-secondary" onClick={() => startTransition(() => { onSave(); })} disabled={isPending} style={{ fontSize: '0.82rem' }}>
              {isPending ? 'Saving…' : '💾 Save simulation'}
            </button>
          )}
          {saved && <span style={{ fontSize: '0.82rem', color: 'var(--accent-green)' }}>✓ Saved</span>}
        </div>
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'start' }}>
          <div className="glass-panel" style={{ padding: '1rem', width: 200 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>Gel</div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <GelLabeledLane label="Ladder" bands={LADDER_1KB.map(s => ({ size: s, label: `${s >= 1000 ? s/1000 + 'k' : s}`, color: '#94a3b8' }))} isLadder />
              <GelLabeledLane label="Vector" bands={vectorBand} />
              <GelLabeledLane label="Construct" bands={bands} />
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: result.success ? 'var(--accent-green)' : 'var(--accent-red)', display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: '0.92rem', color: result.success ? 'var(--accent-green)' : 'var(--accent-red)' }}>{result.message}</span>
            </div>
            {result.success && (
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                <StatPill label="Construct size" value={`${result.size} bp`} />
                <StatPill label="Vector" value={`${vectorSize} bp`} />
                <StatPill label="Insert" value={`${insertSeq.replace(/[^ACGT]/gi,'').length} bp`} />
                <StatPill label="GC%" value={`${calcGC(result.product)}%`} />
                <StatPill label="Form" value="Circular plasmid" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Gel helpers ──────────────────────────────────────────────────────────────

function GelLane({ bands }: { bands: { size: number; label: string; color: string }[] }) {
  const GEL_H = 300;
  const LANE_W = 60;
  const ladderBands = LADDER_1KB.map(s => ({ size: s, color: '#94a3b8' }));
  return (
    <svg width={LANE_W * 2 + 20} height={GEL_H + 24} style={{ display: 'block' }}>
      {ladderBands.map((b, i) => {
        const y = gelPosition(b.size) * GEL_H + 4;
        return (
          <g key={i}>
            <rect x={4} y={y - 2} width={LANE_W - 8} height={4} fill={b.color} opacity={0.5} rx={1} />
            <text x={LANE_W - 2} y={y + 1} fontSize={6} fill="#94a3b8" textAnchor="end" dominantBaseline="middle">
              {b.size >= 1000 ? `${b.size / 1000}k` : b.size}
            </text>
          </g>
        );
      })}
      {bands.map((b, i) => {
        const y = gelPosition(b.size) * GEL_H + 4;
        return (
          <g key={i}>
            <rect x={LANE_W + 8} y={y - 3} width={LANE_W - 12} height={6} fill={b.color} opacity={0.9} rx={1} />
            <text x={LANE_W + 8 + (LANE_W - 12) / 2} y={y + 12} fontSize={7} fill={b.color} textAnchor="middle">{b.size} bp</text>
          </g>
        );
      })}
    </svg>
  );
}

function GelLabeledLane({ label, bands, isLadder = false }: { label: string; bands: { size: number; label: string; color: string }[]; isLadder?: boolean }) {
  const GEL_H = 240;
  const LANE_W = 44;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textAlign: 'center' }}>{label}</div>
      <svg width={LANE_W} height={GEL_H + 4} style={{ display: 'block' }}>
        {bands.map((b, i) => {
          const y = gelPosition(b.size) * GEL_H + 2;
          return (
            <g key={i}>
              <rect x={4} y={y - 2} width={LANE_W - 8} height={isLadder ? 3 : 5} fill={b.color} opacity={isLadder ? 0.5 : 0.9} rx={1} />
              {isLadder && <text x={2} y={y} fontSize={6} fill="#94a3b8" dominantBaseline="middle">{b.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function PrimerInputField({ label, value, onChange, suggestions }: { label: string; value: string; onChange: (v: string) => void; suggestions: SavedPrimer[] }) {
  const tm = value ? calcTm(value.toUpperCase().replace(/[^ACGT]/g, '')) : null;
  const gc = value ? calcGC(value.toUpperCase().replace(/[^ACGT]/g, '')) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {label}
        {tm !== null && <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)' }}>Tm: {tm}°C · GC: {gc}%</span>}
      </label>
      <input value={value} onChange={e => onChange(e.target.value)} className="input-control" style={{ padding: '0.45rem 0.7rem', fontSize: '0.85rem', fontFamily: 'monospace' }} placeholder="ACGTACGT…" list={`primers-${label.replace(/\s/g,'-')}`} />
      {suggestions.length > 0 && (
        <datalist id={`primers-${label.replace(/\s/g,'-')}`}>
          {suggestions.map(p => <option key={p.id} value={p.sequence} label={p.name} />)}
        </datalist>
      )}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {suggestions.map(p => (
            <button key={p.id} onClick={() => onChange(p.sequence)} style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'white', cursor: 'pointer', color: 'var(--text-muted)' }}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Translate Panel ──────────────────────────────────────────────────────────

const AA_3LETTER: Record<string, string> = {
  A:'Ala', R:'Arg', N:'Asn', D:'Asp', C:'Cys', E:'Glu', Q:'Gln', G:'Gly',
  H:'His', I:'Ile', L:'Leu', K:'Lys', M:'Met', F:'Phe', P:'Pro', S:'Ser',
  T:'Thr', W:'Trp', Y:'Tyr', V:'Val', '*':'***',
};

type FrameOption = '+1' | '+2' | '+3' | '-1' | '-2' | '-3';

function TranslatePanel({ sequence }: { sequence: string }) {
  const [frame, setFrame] = useState<FrameOption>('+1');
  const [revTransInput, setRevTransInput] = useState('');

  const rc = useMemo(() => reverseComplement(sequence), [sequence]);

  const translationResult = useMemo(() => {
    const frameNum = parseInt(frame);
    const offset = (Math.abs(frameNum) - 1);
    const template = frameNum > 0 ? sequence : rc;
    const sliced = template.substring(offset);
    const s = sliced.toUpperCase().replace(/[^ACGT]/g, '');
    const codons: { codon: string; aa: string }[] = [];
    for (let i = 0; i + 2 < s.length; i += 3) {
      const codon = s.substring(i, i + 3);
      const CODON_TABLE_LOCAL: Record<string, string> = {
        TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
        ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
        TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
        ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
        TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
        AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
        TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
        AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
      };
      codons.push({ codon, aa: CODON_TABLE_LOCAL[codon] ?? 'X' });
    }
    return codons;
  }, [sequence, rc, frame]);

  const revTransResult = useMemo(() => {
    const cleaned = revTransInput.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY*]/g, '');
    if (!cleaned) return '';
    return reverseTranslate(cleaned);
  }, [revTransInput]);

  const BLOCKS_PER_ROW = 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>Frame:</span>
        {(['+1','+2','+3','-1','-2','-3'] as FrameOption[]).map(f => (
          <button key={f} onClick={() => setFrame(f)} style={{ padding: '0.28rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: frame === f ? 'var(--accent-blue-15)' : 'white', color: frame === f ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: frame === f ? 700 : 400 }}>
            {f}
          </button>
        ))}
        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {translationResult.filter(c => c.aa !== '*').length} aa, {translationResult.filter(c => c.aa === '*').length} stop(s)
        </span>
      </div>

      <div style={{ background: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '1rem', overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'monospace', fontSize: '0.73rem', lineHeight: 2.2 }}>
          {Array.from({ length: Math.ceil(translationResult.length / BLOCKS_PER_ROW) }, (_, rowIdx) => {
            const rowCodons = translationResult.slice(rowIdx * BLOCKS_PER_ROW, (rowIdx + 1) * BLOCKS_PER_ROW);
            const posLabel = rowIdx * BLOCKS_PER_ROW * 3 + 1;
            return (
              <div key={rowIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.1rem' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 44, textAlign: 'right', userSelect: 'none', paddingTop: '0.15rem' }}>{posLabel}</span>
                <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '0.15rem' }}>
                  {rowCodons.map(({ codon, aa }, ci) => {
                    const isStop = aa === '*';
                    const threeL = AA_3LETTER[aa] ?? aa;
                    return (
                      <div key={ci} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 28 }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>{codon}</span>
                        <span style={{ fontWeight: 600, color: isStop ? '#ef4444' : 'var(--text-primary)', fontSize: '0.73rem' }}>
                          {isStop ? '*' : threeL}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>Reverse Translation (protein → DNA)</h4>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
          Uses E. coli codon optimization. Input single-letter amino acid codes.
        </p>
        <textarea
          value={revTransInput}
          onChange={e => setRevTransInput(e.target.value)}
          placeholder="e.g. MSKGEELFTGVVPILVELDGDVNGHKFSV…"
          className="input-control"
          style={{ fontFamily: 'monospace', fontSize: '0.82rem', padding: '0.6rem 0.8rem', minHeight: 72, resize: 'vertical' }}
        />
        {revTransResult && (
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
              DNA output ({revTransResult.length} bp)
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.8, background: 'white', padding: '0.75rem', borderRadius: '7px', border: '1px solid var(--glass-border)', wordBreak: 'break-all', color: 'var(--accent-blue)', maxHeight: 140, overflowY: 'auto' }}>
              {revTransResult}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(revTransResult)}
              style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              📋 Copy DNA sequence
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AI Gene Validator Panel ──────────────────────────────────────────────────

const CODON_TABLE_AI: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
};

const VALIDATION_MARKERS = {
  eukaryotes: { promoter: 'TATAAA', kozak: 'GCCACC' },
  prokaryotes: { shineDalgarno: 'AGGAGG', pribnow: 'TATAAT' },
};

function translateToStop(seq: string): string {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  let protein = '';
  for (let i = 0; i + 2 < s.length; i += 3) {
    const aa = CODON_TABLE_AI[s.substring(i, i + 3)] ?? 'X';
    if (aa === '*') break;
    protein += aa;
  }
  return protein;
}

interface AIGeneResult {
  startIndex: number;
  classification: 'VALID (Eukaryotic)' | 'VALID (Prokaryotic)';
  evidence: string;
  marker: string;
  protein: string;
}

function runAIGeneProcessor(dna: string): AIGeneResult[] {
  const s = dna.toUpperCase().replace(/[^ACGT]/g, '');
  const results: AIGeneResult[] = [];
  const { eukaryotes, prokaryotes } = VALIDATION_MARKERS;

  for (let i = 0; i < s.length - 2; i++) {
    if (s.substring(i, i + 3) !== 'ATG') continue;
    const upstream = s.substring(Math.max(0, i - 35), i);

    if (upstream.includes(eukaryotes.promoter)) {
      results.push({ startIndex: i, classification: 'VALID (Eukaryotic)', evidence: 'TATA-box detected upstream', marker: eukaryotes.promoter, protein: translateToStop(s.substring(i)) });
    } else if (upstream.includes(eukaryotes.kozak)) {
      results.push({ startIndex: i, classification: 'VALID (Eukaryotic)', evidence: 'Kozak sequence detected upstream', marker: eukaryotes.kozak, protein: translateToStop(s.substring(i)) });
    } else if (upstream.includes(prokaryotes.shineDalgarno)) {
      results.push({ startIndex: i, classification: 'VALID (Prokaryotic)', evidence: 'Shine-Dalgarno sequence detected upstream', marker: prokaryotes.shineDalgarno, protein: translateToStop(s.substring(i)) });
    } else if (upstream.includes(prokaryotes.pribnow)) {
      results.push({ startIndex: i, classification: 'VALID (Prokaryotic)', evidence: 'Pribnow box detected upstream', marker: prokaryotes.pribnow, protein: translateToStop(s.substring(i)) });
    }
  }
  return results;
}

function AIGenePanel({ sequence }: { sequence: string }) {
  const results = useMemo(() => runAIGeneProcessor(sequence), [sequence]);

  const totalATGs = useMemo(() => {
    const s = sequence.toUpperCase();
    let n = 0, i = s.indexOf('ATG');
    while (i !== -1) { n++; i = s.indexOf('ATG', i + 1); }
    return n;
  }, [sequence]);

  const euCount = results.filter(r => r.classification === 'VALID (Eukaryotic)').length;
  const proCount = results.filter(r => r.classification === 'VALID (Prokaryotic)').length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.35rem' }}>AI Gene Validator</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Scans all ATG codons and validates each against upstream regulatory markers.
          Decoy ATGs (internal Met, non-coding) are automatically rejected.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {[
          ['ATGs found', String(totalATGs), '#374151'],
          ['Valid genes', String(results.length), '#2563eb'],
          ['Eukaryotic', String(euCount), '#16a34a'],
          ['Prokaryotic', String(proCount), '#9333ea'],
        ].map(([k, v, c]) => (
          <div key={k} style={{ padding: '0.5rem 0.6rem', background: 'white', borderRadius: '7px', border: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: c, fontFamily: 'monospace', marginTop: '0.1rem' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Marker legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {[
          { label: 'TATA-box', seq: 'TATAAA', color: '#16a34a' },
          { label: 'Kozak', seq: 'GCCACC', color: '#16a34a' },
          { label: 'Shine-Dalgarno', seq: 'AGGAGG', color: '#9333ea' },
          { label: 'Pribnow box', seq: 'TATAAT', color: '#9333ea' },
        ].map(m => (
          <span key={m.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: m.color + '10', border: `1px solid ${m.color}30`, color: m.color, fontWeight: 600 }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', opacity: 0.75 }}>{m.seq}</span>
            {m.label}
          </span>
        ))}
      </div>

      {/* Results */}
      {results.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem', border: '1px dashed var(--glass-border)', borderRadius: '8px' }}>
          No valid gene starts found.<br />
          <span style={{ fontSize: '0.78rem' }}>No ATG was preceded by a TATA-box, Kozak, Shine-Dalgarno, or Pribnow marker within 35 bp.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {results.map((r, i) => {
            const isEuk = r.classification === 'VALID (Eukaryotic)';
            const color = isEuk ? '#16a34a' : '#9333ea';
            return (
              <div key={i} style={{ padding: '0.85rem 1rem', background: 'white', borderRadius: '8px', border: `1px solid ${color}33`, borderLeft: `4px solid ${color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', background: color + '15', color }}>{r.classification}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>pos {r.startIndex + 1}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>·</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.evidence}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: color + '12', color, fontWeight: 600 }}>{r.marker}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Protein · {r.protein.length} aa
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.76rem', color: '#374151', wordBreak: 'break-all', lineHeight: 1.7, background: '#f8fafc', padding: '0.4rem 0.6rem', borderRadius: '5px', maxHeight: 80, overflowY: 'auto' }}>
                  {r.protein || <span style={{ color: 'var(--text-muted)' }}>No translation (immediate stop codon)</span>}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(r.protein)}
                  style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  📋 Copy protein sequence
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejected ATGs count */}
      <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {totalATGs - results.length} ATG{totalATGs - results.length !== 1 ? 's' : ''} rejected as decoys or internal methionines
      </p>
    </div>
  );
}

// ─── Sanger Alignment Panel ───────────────────────────────────────────────────

// globalAlign lived here. It used a flat gap penalty and a full global alignment,
// so a short read inside a long plasmid was charged for the whole flanking
// reference, and scattered indels scored the same as contiguous ones. Replaced
// by verifyRead from lib/alignment: affine gaps, free reference ends, both
// orientations tried, and differences reported by position in the reference.


function SangerPanel({ reference }: { reference: string }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ReadVerification | null | 'overflow'>(null);
  const [running, setRunning] = useState(false);

  const run = () => {
    const q = query.toUpperCase().replace(/[^ACGT]/g, '');
    const r = reference.toUpperCase().replace(/[^ACGT]/g, '');
    if (!q) return;
    setRunning(true);
    // Yield first: a long alignment should not freeze the tab mid-click.
    setTimeout(() => {
      try { setResult(verifyRead(r, q)); }
      catch { setResult('overflow'); }
      setRunning(false);
    }, 0);
  };

  const CHUNK = 60;
  const chunks: { ref: string; qry: string; match: string; pos: number }[] = [];
  if (result && result !== 'overflow') {
    for (let k = 0; k < result.alignment.alignedA.length; k += CHUNK) {
      const ref = result.alignment.alignedA.substring(k, k + CHUNK);
      const qry = result.alignment.alignedB.substring(k, k + CHUNK);
      const match = ref.split('').map((b, i) => b === '-' || qry[i] === '-' ? ' ' : b === qry[i] ? '|' : '·').join('');
      chunks.push({ ref, qry, match, pos: k + 1 });
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Sanger Sequencing Alignment</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Compare a sequencing read to this reference. Both orientations are tried, so it does not matter which primer the read came from, and gaps are scored so a real indel stays in one piece.
        </p>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.3rem' }}>
          Paste Sequencing Read (Query)
        </label>
        <textarea
          className="input-control"
          value={query}
          onChange={e => { setQuery(e.target.value.toUpperCase()); setResult(null); }}
          placeholder="GAATTCAAAAAA…"
          style={{ width: '100%', minHeight: 72, fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.5rem 0.7rem', resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
          <button
            onClick={run}
            disabled={!query.replace(/[^ACGT]/gi, '') || running}
            className="btn btn-primary"
            style={{ fontSize: '0.82rem' }}
          >
            {running ? 'Aligning…' : 'Align to Reference'}
          </button>
          {query && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Query: {query.replace(/[^ACGT]/gi, '').length} bp · Ref: {reference.length} bp
            </span>
          )}
        </div>
      </div>

      {result === 'overflow' && (
        <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '0.82rem', color: '#dc2626' }}>
          Sequences too large to align in-browser (limit: 4M cell matrix). Try a shorter query or use BLAST for long references.
        </div>
      )}

      {result && result !== 'overflow' && (
        <div>
          {/* Score summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
            {[
              ['Identity', `${(result.identity * 100).toFixed(1)}%`, result.identity >= 0.99 ? '#16a34a' : result.identity >= 0.9 ? '#ea580c' : '#dc2626'],
              ['Covers', `${result.coverageStart}–${result.coverageEnd}`, '#2563eb'],
              ['Differences', String(result.differences.length), result.differences.length === 0 ? '#16a34a' : '#ea580c'],
              ['Orientation', result.reversed ? 'reverse' : 'forward', '#7c3aed'],
            ].map(([k, v, c]) => (
              <div key={k} style={{ padding: '0.45rem 0.6rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '7px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 800, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {result.differences.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Differences from the reference
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.2rem', maxHeight: 168, overflowY: 'auto' }}>
                {result.differences.slice(0, 60).map((d, i) => (
                  <li key={i} style={{ fontFamily: 'monospace', fontSize: '0.76rem', display: 'flex', gap: '0.6rem' }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 64, textAlign: 'right' }}>{d.position}</span>
                    <span style={{ minWidth: 74, color: d.kind === 'mismatch' ? '#ea580c' : d.kind === 'deletion' ? '#dc2626' : '#2563eb' }}>{d.kind}</span>
                    <span>{d.reference} &rarr; {d.read}</span>
                  </li>
                ))}
              </ul>
              {result.differences.length > 60 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  &hellip;and {result.differences.length - 60} more.
                </div>
              )}
            </div>
          )}

          {/* Alignment blocks */}
          <div style={{ background: '#0f172a', borderRadius: '8px', padding: '0.75rem 1rem', overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '0.74rem', lineHeight: 1.9, whiteSpace: 'pre' }}>
              {chunks.map((c, i) => (
                <div key={i} style={{ marginBottom: '0.5rem' }}>
                  <span style={{ color: '#64748b' }}>{'REF  '}{String(c.pos).padStart(6, ' ')}  </span>
                  <span>
                    {c.ref.split('').map((b, j) => (
                      <span key={j} style={{ color: b === '-' ? '#475569' : c.qry[j] === '-' ? '#94a3b8' : b === c.qry[j] ? '#86efac' : '#fca5a5' }}>{b}</span>
                    ))}
                  </span>
                  {'\n'}
                  <span style={{ color: '#64748b' }}>{'          '}</span>
                  <span style={{ color: '#475569' }}>{c.match}</span>
                  {'\n'}
                  <span style={{ color: '#64748b' }}>{'QRY  '}{String(c.pos).padStart(6, ' ')}  </span>
                  <span>
                    {c.qry.split('').map((b, j) => (
                      <span key={j} style={{ color: b === '-' ? '#475569' : c.ref[j] === '-' ? '#94a3b8' : b === c.ref[j] ? '#86efac' : '#fca5a5' }}>{b}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <span><span style={{ color: '#86efac' }}>■</span> Match</span>
            <span><span style={{ color: '#fca5a5' }}>■</span> Mismatch</span>
            <span><span style={{ color: '#475569' }}>■</span> Gap</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dimer & Thermodynamics Panel ─────────────────────────────────────────────

function complementBase(b: string): string {
  return ({ A: 'T', T: 'A', G: 'C', C: 'G' } as Record<string, string>)[b] ?? 'N';
}

function predictDimers(seq1: string, seq2?: string): 'High Risk' | 'Low Risk' {
  const s1 = seq1.toUpperCase().replace(/[^ACGT]/g, '');
  const s2 = seq2
    ? seq2.toUpperCase().replace(/[^ACGT]/g, '')
    : s1.split('').map(complementBase).reverse().join('');
  const tail1 = s1.slice(-5);
  const tail2Rev = s2.slice(-5).split('').map(complementBase).reverse().join('');
  let matches = 0;
  for (let i = 0; i < Math.min(tail1.length, tail2Rev.length); i++) {
    if (tail1[i] === tail2Rev[i]) matches++;
  }
  return matches >= 3 ? 'High Risk' : 'Low Risk';
}

function DimerPanel({ primers }: { primers: SavedPrimer[] }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');

  const seq1 = p1.toUpperCase().replace(/[^ACGT]/g, '');
  const seq2 = p2.toUpperCase().replace(/[^ACGT]/g, '');
  const tm1 = seq1.length >= 8 ? calcTm(seq1) : null;
  const tm2 = seq2.length >= 8 ? calcTm(seq2) : null;
  const gc1 = seq1.length ? calcGC(seq1) : null;
  const gc2 = seq2.length ? calcGC(seq2) : null;

  const heteroDimer = seq1 && seq2 ? predictDimers(seq1, seq2) : null;
  const homoDimer1  = seq1 ? predictDimers(seq1) : null;
  const homoDimer2  = seq2 ? predictDimers(seq2) : null;

  const riskColor = (r: string | null) => r === 'High Risk' ? '#dc2626' : r === 'Low Risk' ? '#16a34a' : '#94a3b8';
  const riskBg    = (r: string | null) => r === 'High Risk' ? '#fef2f2' : r === 'Low Risk' ? '#f0fdf4' : 'white';

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Primer Dimer & Thermodynamics</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Checks 3′-end complementarity (last 5 nt) for dimer risk. High risk = ≥3 complementary bases at 3′ ends.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        {[
          { label: "Forward Primer (5'→3')", val: p1, set: setP1, seq: seq1, tm: tm1, gc: gc1, color: '#3b82f6' },
          { label: "Reverse Primer (5'→3')", val: p2, set: setP2, seq: seq2, tm: tm2, gc: gc2, color: '#9333ea' },
        ].map(({ label, val, set, seq, tm, gc, color }) => (
          <div key={label}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.3rem' }}>{label}</label>
            <input
              className="input-control"
              value={val}
              onChange={e => set(e.target.value.toUpperCase())}
              placeholder="ATGCATGC…"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem', padding: '0.45rem 0.7rem', boxSizing: 'border-box' }}
            />
            {seq.length >= 8 && (
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '4px', background: color + '18', color, border: `1px solid ${color}44` }}>
                  Tm {tm}°C
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: '#f1f5f9', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
                  GC {gc}%
                </span>
                <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: '#f1f5f9', color: 'var(--text-muted)', border: '1px solid var(--glass-border)', fontFamily: 'monospace' }}>
                  {seq.length} nt
                </span>
              </div>
            )}
            {/* 3' end visualization */}
            {seq.length >= 5 && (
              <div style={{ marginTop: '0.4rem', padding: '0.3rem 0.6rem', background: '#f8fafc', borderRadius: '5px', border: '1px solid var(--glass-border)', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>3′ </span>
                {seq.slice(0, -5).split('').map((b, i) => <span key={i} style={{ color: '#94a3b8' }}>{b}</span>)}
                {seq.slice(-5).split('').map((b, i) => <span key={i} style={{ color, fontWeight: 700 }}>{b}</span>)}
                <span style={{ color: 'var(--text-muted)' }}> 3′</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: '0.4rem' }}>← critical region</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Quick-load from saved primers */}
      {primers.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.75rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '7px' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Load from saved primers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {primers.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: '0.2rem' }}>
                <button onClick={() => setP1(p.sequence)} style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid #3b82f644', background: '#eff6ff', color: '#3b82f6', cursor: 'pointer' }}>→F: {p.name}</button>
                <button onClick={() => setP2(p.sequence)} style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid #9333ea44', background: '#faf5ff', color: '#9333ea', cursor: 'pointer' }}>→R: {p.name}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dimer risk results */}
      {(seq1 || seq2) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Dimer Risk Assessment</div>
          {[
            { label: 'Heterodimer (F + R)', risk: heteroDimer, show: !!(seq1 && seq2) },
            { label: 'Homodimer (F + F)',   risk: homoDimer1,  show: !!seq1 },
            { label: 'Homodimer (R + R)',   risk: homoDimer2,  show: !!seq2 },
          ].filter(x => x.show).map(({ label, risk }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.85rem', background: riskBg(risk), border: `1px solid ${riskColor(risk)}44`, borderRadius: '7px' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{label}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '5px', background: riskColor(risk) + '15', color: riskColor(risk), border: `1px solid ${riskColor(risk)}44` }}>
                {risk ?? '—'}
              </span>
            </div>
          ))}
          {heteroDimer && seq1 && seq2 && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '0.78rem', color: '#92400e' }}>
              💡 A true professional tool (Primer3) calculates ΔG for exact dimer stability. This check uses 3′ complementarity as a fast heuristic.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GenBank / FASTA Parsers ──────────────────────────────────────────────────

function parseGenBankFeatures(text: string): SequenceFeature[] | null {
  if (!text.includes('FEATURES')) return null;
  const featStart = text.indexOf('FEATURES');
  const originIdx = text.indexOf('ORIGIN');
  const featSection = text.substring(featStart, originIdx > -1 ? originIdx : text.length);
  const features: SequenceFeature[] = [];
  const re = /^ {5}(\S+)\s+(complement\()?(<?(\d+))\.\.>?(\d+)\)?/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(featSection)) !== null) {
    const type = match[1];
    if (type === 'source') continue;
    const isComplement = !!match[2];
    const start = parseInt(match[4]);
    const end   = parseInt(match[5]);
    if (isNaN(start) || isNaN(end)) continue;
    const block = featSection.substring(match.index, match.index + 400);
    const label = block.match(/\/label="([^"]+)"/)?.[1]
                ?? block.match(/\/gene="([^"]+)"/)?.[1]
                ?? type;
    const color = block.match(/\/note="color: ([^"]+)"/)?.[1]
                ?? PRESET_COLORS[features.length % PRESET_COLORS.length];
    const notes = block.match(/\/note="([^"]+)"/)?.[1];
    features.push({
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: label, type, start, end,
      strand: isComplement ? -1 : 1,
      color,
      notes,
    });
  }
  return features;
}

function parseFastaFeatures(_text: string): SequenceFeature[] {
  return []; // FASTA has no annotations
}

// ─── Live Primer Design Panel ─────────────────────────────────────────────────

function LiveDesignPanel({
  sequence, selection, onSelect, allReSites, reSitesByEnzyme, onCreatePrimer,
}: {
  sequence: string;
  selection: { start: number; end: number } | null;
  onSelect: (s: { start: number; end: number }) => void;
  allReSites: ReSite[];
  reSitesByEnzyme: Map<string, ReSite[]>;
  onCreatePrimer: (start: number, end: number, seq: string, strand: string) => void;
}) {
  const [start, setStart] = useState(selection?.start ?? 1);
  const [end, setEnd]     = useState(selection?.end   ?? Math.min(25, sequence.length));
  const [strand, setStrand] = useState<'forward' | 'reverse'>('forward');

  const clampedStart = Math.max(1, Math.min(start, sequence.length));
  const clampedEnd   = Math.max(clampedStart, Math.min(end, sequence.length));
  const selectedSeq  = sequence.substring(clampedStart - 1, clampedEnd).toUpperCase();
  const primer       = strand === 'forward' ? selectedSeq : reverseComplement(selectedSeq);
  const tm           = primer.length >= 8 ? calcTm(primer) : null;
  const gc           = primer.length ? calcGC(primer) : null;
  const lenOk        = primer.length >= 18 && primer.length <= 30;

  const contextLeft  = sequence.substring(Math.max(0, clampedStart - 6), clampedStart - 1).toUpperCase();
  const contextRight = sequence.substring(clampedEnd, Math.min(sequence.length, clampedEnd + 5)).toUpperCase();

  const uniqueInSel = useMemo(() =>
    allReSites.filter(s =>
      (reSitesByEnzyme.get(s.enzyme)?.length ?? 0) === 1 &&
      s.cutPos >= clampedStart && s.cutPos <= clampedEnd
    ),
  [allReSites, reSitesByEnzyme, clampedStart, clampedEnd]);

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Live Primer Design Studio</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Set a binding region, choose strand, and inspect live Tm/GC. Unique cutters in-region are highlighted.
        </p>
      </div>

      {/* Region controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.6rem', alignItems: 'end', marginBottom: '0.75rem' }}>
        {[
          { label: 'Start (bp)', val: start, set: setStart },
          { label: 'End (bp)',   val: end,   set: setEnd   },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
            <input
              type="number" min={1} max={sequence.length}
              className="input-control" value={val}
              onChange={e => set(parseInt(e.target.value) || 1)}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <button onClick={() => onSelect({ start: clampedStart, end: clampedEnd })} style={{ padding: '0.4rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)', background: 'var(--accent-blue-15)', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
          Highlight
        </button>
      </div>

      {/* Strand toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {(['forward', 'reverse'] as const).map(s => (
          <button key={s} onClick={() => setStrand(s)} style={{ padding: '0.3rem 0.8rem', borderRadius: '6px', border: `1px solid ${strand === s ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: strand === s ? 'var(--accent-blue-15)' : 'white', color: strand === s ? 'var(--accent-blue)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', fontWeight: strand === s ? 600 : 400 }}>
            {s === 'forward' ? 'Top (Sense) →' : '← Bottom (Antisense)'}
          </button>
        ))}
      </div>

      {/* Live stats */}
      {primer.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem' }}>
          {tm !== null && <Badge label={`Tm ${tm}°C`} color="#3b82f6" />}
          {gc !== null && <Badge label={`GC ${gc}%`} color={gc >= 40 && gc <= 60 ? '#22c55e' : '#f59e0b'} />}
          <Badge label={`${primer.length} nt`} color={lenOk ? '#22c55e' : '#ef4444'} />
          {!lenOk && <Badge label={primer.length < 18 ? 'Too short' : 'Too long'} color="#ef4444" />}
        </div>
      )}

      {/* Binding preview */}
      <div style={{ background: '#0f172a', borderRadius: '8px', padding: '0.65rem 0.9rem', fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 1.8, marginBottom: '0.75rem', overflowX: 'auto' }}>
        <div>
          <span style={{ color: '#64748b' }}>Ref: </span>
          <span style={{ color: '#94a3b8' }}>…{contextLeft}</span>
          {selectedSeq.split('').map((b, i) => (
            <span key={i} style={{ color: '#86efac', fontWeight: 600 }}>{b}</span>
          ))}
          <span style={{ color: '#94a3b8' }}>{contextRight}…</span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>     </span>
          <span style={{ color: '#475569' }}>{''.padEnd(contextLeft.length + 1)}</span>
          <span style={{ color: '#3b82f6' }}>{'|'.repeat(selectedSeq.length)}</span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>Prm: </span>
          <span style={{ color: '#475569' }}>{''.padEnd(contextLeft.length + 1)}</span>
          {primer.split('').map((b, i) => (
            <span key={i} style={{ color: strand === 'forward' ? '#93c5fd' : '#c4b5fd' }}>{b}</span>
          ))}
        </div>
      </div>

      {/* Unique cutters in selection */}
      {uniqueInSel.length > 0 && (
        <div style={{ padding: '0.5rem 0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' }}>
            Unique cutters in region
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {uniqueInSel.map(s => (
              <span key={s.enzyme + s.cutPos} style={{ fontSize: '0.72rem', fontFamily: 'monospace', padding: '0.15rem 0.45rem', borderRadius: '4px', background: s.color + '18', color: s.color, border: `1px solid ${s.color}44`, fontWeight: 600 }}>
                {s.enzyme} @{s.cutPos}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onCreatePrimer(clampedStart, clampedEnd, primer, strand)}
        disabled={primer.length < 8}
        className="btn btn-primary"
        style={{ fontSize: '0.82rem' }}
      >
        Create Primer from Region
      </button>
    </div>
  );
}

// ─── Site-Directed Mutagenesis Panel ──────────────────────────────────────────

const CODON_TABLE_MUT: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
};

function translateRegion(seq: string): string {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  let out = '';
  for (let i = 0; i + 2 < s.length; i += 3) {
    out += CODON_TABLE_MUT[s.substring(i, i + 3)] ?? '?';
  }
  return out;
}

function MutagenesisPanel({ sequence, selection }: { sequence: string; selection: { start: number; end: number } | null }) {
  const defaultPos = selection ? selection.start : 1;
  const [mutPos, setMutPos] = useState(defaultPos);
  const [newBase, setNewBase] = useState<'A' | 'T' | 'C' | 'G'>('A');
  const [showMutSeq, setShowMutSeq] = useState(false);

  const pos = Math.max(1, Math.min(mutPos, sequence.length));
  const origBase = sequence[pos - 1]?.toUpperCase() ?? '';

  // Region: 15 bases around mutation (or use selection)
  const regionStart = selection ? selection.start : Math.max(1, pos - 14);
  const regionEnd   = selection ? selection.end   : Math.min(sequence.length, pos + 14);
  const origRegion  = sequence.substring(regionStart - 1, regionEnd).toUpperCase();

  const relPos = pos - regionStart; // 0-indexed within region
  const mutRegion = origRegion.substring(0, relPos) + newBase + origRegion.substring(relPos + 1);

  const origTm = origRegion.length >= 8 ? calcTm(origRegion) : 0;
  const mutTm  = mutRegion.length  >= 8 ? calcTm(mutRegion)  : 0;
  const tmDelta = mutTm - origTm;

  const origAA  = translateRegion(origRegion);
  const mutAA   = translateRegion(mutRegion);
  const impact  = origAA === mutAA ? 'Silent' : mutAA.includes('*') && !origAA.includes('*') ? 'Nonsense' : 'Missense';
  const impactColor = impact === 'Silent' ? '#16a34a' : impact === 'Nonsense' ? '#7c3aed' : '#dc2626';

  const mutFullSeq = sequence.substring(0, pos - 1) + newBase + sequence.substring(pos);

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Site-Directed Mutagenesis</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Substitute a single base and instantly see the thermodynamic and protein-coding impact.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'end', marginBottom: '0.75rem' }}>
        <div>
          <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.2rem' }}>
            Base Position (1 – {sequence.length})
          </label>
          <input
            type="number" min={1} max={sequence.length} className="input-control"
            value={mutPos} onChange={e => setMutPos(parseInt(e.target.value) || 1)}
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
            Original: <span style={{ color: '#ea580c', fontFamily: 'monospace' }}>{origBase}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {(['A', 'T', 'C', 'G'] as const).map(b => (
              <button key={b} onClick={() => setNewBase(b)} disabled={b === origBase} style={{ width: 32, height: 32, borderRadius: '5px', border: `1px solid ${newBase === b ? 'var(--accent-blue)' : 'var(--glass-border)'}`, background: newBase === b ? 'var(--accent-blue-15)' : b === origBase ? '#f1f5f9' : 'white', color: newBase === b ? 'var(--accent-blue)' : b === origBase ? '#94a3b8' : 'var(--text-primary)', cursor: b === origBase ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Impact summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ padding: '0.5rem 0.6rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '7px' }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mutant Tm</div>
          <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 800, color: '#2563eb' }}>{mutTm}°C</div>
          <div style={{ fontSize: '0.68rem', color: tmDelta >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
            {tmDelta >= 0 ? '+' : ''}{tmDelta.toFixed(1)}°C vs original
          </div>
        </div>
        <div style={{ padding: '0.5rem 0.6rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '7px' }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Substitution</div>
          <div style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 800 }}>
            <span style={{ color: '#ea580c' }}>{origBase}</span>
            <span style={{ color: 'var(--text-muted)' }}> → </span>
            <span style={{ color: '#3b82f6' }}>{newBase}</span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>pos {pos}</div>
        </div>
        <div style={{ padding: '0.5rem 0.6rem', background: impactColor + '10', border: `1px solid ${impactColor}33`, borderRadius: '7px' }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Protein Impact</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: impactColor }}>{impact}</div>
        </div>
      </div>

      {/* Before / after translation */}
      <div style={{ background: '#0f172a', borderRadius: '8px', padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.76rem', lineHeight: 1.85, marginBottom: '0.75rem' }}>
        <div style={{ marginBottom: '0.4rem' }}>
          <span style={{ color: '#64748b' }}>Orig: </span>
          {origRegion.split('').map((b, i) => (
            <span key={i} style={{ color: i === relPos ? '#fbbf24' : '#86efac', fontWeight: i === relPos ? 900 : 400 }}>{b}</span>
          ))}
        </div>
        <div style={{ marginBottom: '0.4rem' }}>
          <span style={{ color: '#64748b' }}>Mut:  </span>
          {mutRegion.split('').map((b, i) => (
            <span key={i} style={{ color: i === relPos ? '#f87171' : '#86efac', fontWeight: i === relPos ? 900 : 400 }}>{b}</span>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
          <span style={{ color: '#64748b' }}>AA orig: </span><span style={{ color: '#a5b4fc' }}>{origAA}</span>
        </div>
        <div>
          <span style={{ color: '#64748b' }}>AA mut:  </span>
          {mutAA.split('').map((aa, i) => (
            <span key={i} style={{ color: aa === origAA[i] ? '#a5b4fc' : '#f87171', fontWeight: aa !== origAA[i] ? 700 : 400 }}>{aa}</span>
          ))}
        </div>
      </div>

      {/* Full mutant sequence toggle */}
      <button onClick={() => setShowMutSeq(v => !v)} style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '0.4rem' }}>
        {showMutSeq ? '▲ Hide' : '▶ Show'} full mutant sequence
      </button>
      {showMutSeq && (
        <div style={{ background: '#f8fafc', border: '1px solid var(--glass-border)', borderRadius: '7px', padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
          {mutFullSeq.split('').map((b, i) => (
            <span key={i} style={{ color: i === pos - 1 ? '#dc2626' : '#374151', fontWeight: i === pos - 1 ? 800 : 400 }}>{b}</span>
          ))}
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        <button onClick={() => navigator.clipboard.writeText(mutFullSeq)} style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          📋 Copy mutant sequence
        </button>
      </div>
    </div>
  );
}

// ─── Virtual Gel Panel ────────────────────────────────────────────────────────

function VirtualGelPanel({ sequence, allReSites, reSitesByEnzyme, seqType }: { sequence: string; allReSites: ReSite[]; reSitesByEnzyme: Map<string, ReSite[]>; seqType: string }) {
  const [selectedEnzymes, setSelectedEnzymes] = useState<string[]>([]);
  const [ran, setRan] = useState(false);

  const enzymeNames = useMemo(() => [...reSitesByEnzyme.keys()].sort(), [reSitesByEnzyme]);

  const fragments = useMemo((): number[] => {
    if (!ran || selectedEnzymes.length === 0) return [];
    const cuts = selectedEnzymes
      .flatMap(e => reSitesByEnzyme.get(e)?.map(s => s.cutPos) ?? [])
    return calculateFragments(sequence.length, cuts, seqType === 'plasmid');
  }, [ran, selectedEnzymes, sequence, reSitesByEnzyme, seqType]);

  // Gel SVG constants
  const GEL_H = 360, GEL_W = 160, LANE_X = 90, LADDER_X = 30;
  const LADDER_SIZES = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250, 100];

  function bpToY(bp: number): number {
    const logMin = Math.log10(90), logMax = Math.log10(12000);
    const logBp  = Math.log10(Math.max(90, Math.min(bp, 12000)));
    return 30 + ((logMax - logBp) / (logMax - logMin)) * (GEL_H - 60);
  }

  const bandColor = (bp: number) => '#00FF00'; // SnapGene Fluorescent Green

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 0.25rem', color: 'var(--text-primary)' }}>🧪 SnapGene-AI Pro Digest</h3>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
          Virtual Agarose Gel Simulator · <strong>{seqType === 'plasmid' ? 'Circular Plasmid' : 'Linear Sequence'}</strong>
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* Enzyme selector */}
        <div style={{ flex: 1 }}>
          {enzymeNames.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No RE sites detected in this sequence.</p>
          ) : (
            <>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Select Enzymes</div>
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '0.6rem' }}>
                {enzymeNames.map(enz => {
                  const sites = reSitesByEnzyme.get(enz) ?? [];
                  const isUnique = sites.length === 1;
                  return (
                    <label key={enz} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', cursor: 'pointer', padding: '0.2rem 0.4rem', borderRadius: '4px', background: selectedEnzymes.includes(enz) ? sites[0].color + '12' : 'transparent' }}>
                      <input type="checkbox" checked={selectedEnzymes.includes(enz)} onChange={e => { setSelectedEnzymes(p => e.target.checked ? [...p, enz] : p.filter(x => x !== enz)); setRan(false); }} />
                      <span style={{ fontFamily: 'monospace', color: isUnique ? sites[0].color : 'var(--text-secondary)', fontWeight: isUnique ? 600 : 400 }}>{enz}</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>({sites.length} cut{sites.length !== 1 ? 's' : ''})</span>
                      {isUnique && <span style={{ fontSize: '0.6rem', color: '#16a34a', background: '#f0fdf4', padding: '0.05rem 0.3rem', borderRadius: '3px', border: '1px solid #bbf7d0' }}>unique</span>}
                    </label>
                  );
                })}
              </div>
              <button onClick={() => setRan(true)} disabled={selectedEnzymes.length === 0} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
                Run Digest &amp; Show Gel
              </button>

              {/* Fragment table */}
              {ran && fragments.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' }}>
                    {fragments.length} fragment{fragments.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    {fragments.map((bp, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0.4rem', borderRadius: '4px', background: bandColor(bp) + '10', border: `1px solid ${bandColor(bp)}22` }}>
                        <span style={{ width: 8, height: 3, background: bandColor(bp), borderRadius: 1, flexShrink: 0 }} />
                        <span style={{ fontFamily: 'monospace', fontSize: '0.76rem', fontWeight: 600, color: bandColor(bp) }}>{bp.toLocaleString()} bp</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Gel SVG */}
        {ran && fragments.length > 0 && (
          <div>
            <svg width={GEL_W} height={GEL_H} style={{ background: '#020617', borderRadius: '10px', display: 'block', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              {/* Gel background */}
              <rect x={0} y={0} width={GEL_W} height={GEL_H} fill="#020617" rx={10} />
              {/* Well labels */}
              <text x={LADDER_X} y={22} textAnchor="middle" fontSize={8} fill="#475569" fontWeight={700}>LDR</text>
              <text x={LANE_X} y={22} textAnchor="middle" fontSize={8} fill="#475569" fontWeight={700}>DIGEST</text>
              
              {/* Lane backgrounds */}
              <rect x={LADDER_X - 12} y={30} width={24} height={GEL_H - 60} fill="#0f172a" rx={4} />
              <rect x={LANE_X - 12} y={30} width={24} height={GEL_H - 60} fill="#0f172a" rx={4} />
              
              {/* Ladder bands */}
              {LADDER_SIZES.map(bp => {
                const y = bpToY(bp);
                const isStrong = bp === 1000 || bp === 5000 || bp === 10000;
                return (
                  <g key={bp}>
                    <line x1={LADDER_X - 10} y1={y} x2={LADDER_X + 10} y2={y} stroke="#fcd34d" strokeWidth={isStrong ? 2.5 : 1.2} opacity={isStrong ? 0.9 : 0.5} />
                    <text x={LADDER_X - 15} y={y + 3} fontSize={6} fill="#64748b" textAnchor="end">{bp >= 1000 ? `${bp / 1000}k` : bp}</text>
                  </g>
                );
              })}
              
              {/* Sample bands */}
              {fragments.map((bp, i) => {
                const y = bpToY(bp);
                // Band intensity decreases slightly for smaller fragments, or based on cut frequency
                const opacity = 1; 
                return (
                  <g key={i}>
                    {/* Glow effect */}
                    <line x1={LANE_X - 11} y1={y} x2={LANE_X + 11} y2={y} stroke={bandColor(bp)} strokeWidth={4} opacity={0.2} style={{ filter: 'blur(2px)' }} />
                    <line x1={LANE_X - 10} y1={y} x2={LANE_X + 10} y2={y} stroke={bandColor(bp)} strokeWidth={2.5} opacity={opacity} />
                  </g>
                );
              })}

              {/* well pockets */}
              <rect x={LADDER_X - 8} y={30} width={16} height={6} fill="#334155" rx={1} />
              <rect x={LANE_X - 8} y={30} width={16} height={6} fill="#334155" rx={1} />

              <text x={GEL_W / 2} y={GEL_H - 12} textAnchor="middle" fontSize={7} fill="#475569" fontWeight={600} letterSpacing="0.05em">AGAROSE GEL simulation</text>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 3D Protein Fold Panel ────────────────────────────────────────────────────

const VALID_AA = new Set('ACDEFGHIKLMNPQRSTVWY');

function aaFromDNA(seq: string): string {
  const s = seq.toUpperCase().replace(/[^ACGT]/g, '');
  let out = '';
  for (let i = 0; i + 2 < s.length; i += 3) {
    const aa = CODON_TABLE_AI[s.substring(i, i + 3)];
    if (!aa || aa === '*') break;
    out += aa;
  }
  return out;
}

function parsePdbAtoms(pdb: string): { x: number; y: number; z: number; chain: string }[] {
  return pdb.split('\n')
    .filter(l => l.startsWith('ATOM') && l.substring(12, 16).trim() === 'CA')
    .map(l => ({
      x: parseFloat(l.substring(30, 38)),
      y: parseFloat(l.substring(38, 46)),
      z: parseFloat(l.substring(46, 54)),
      chain: l.substring(21, 22),
    }))
    .filter(a => !isNaN(a.x));
}

function PdbViewer({ pdb }: { pdb: string }) {
  const atoms = useMemo(() => parsePdbAtoms(pdb), [pdb]);
  if (atoms.length === 0) return null;

  const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;

  const W = 360, H = 260, PAD = 24;
  const toSvgX = (x: number) => PAD + ((x - minX) / rangeX) * (W - PAD * 2);
  const toSvgY = (y: number) => PAD + ((y - minY) / rangeY) * (H - PAD * 2);

  const chainColors: Record<string, string> = {};
  const palette = ['#60a5fa', '#34d399', '#f87171', '#fbbf24', '#a78bfa', '#fb923c'];
  atoms.forEach(a => { if (!chainColors[a.chain]) chainColors[a.chain] = palette[Object.keys(chainColors).length % palette.length]; });

  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
        Cα backbone · {atoms.length} residues · top-down projection (X/Y plane)
      </div>
      <svg width={W} height={H} style={{ background: '#0f172a', borderRadius: '8px', display: 'block' }}>
        {atoms.map((a, i) => {
          if (i === 0) return null;
          const prev = atoms[i - 1];
          const color = chainColors[a.chain];
          const t = i / atoms.length;
          return (
            <line
              key={i}
              x1={toSvgX(prev.x)} y1={toSvgY(prev.y)}
              x2={toSvgX(a.x)}    y2={toSvgY(a.y)}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.4 + t * 0.6}
            />
          );
        })}
        {/* N-terminus marker */}
        {atoms[0] && (
          <circle cx={toSvgX(atoms[0].x)} cy={toSvgY(atoms[0].y)} r={4} fill="#22c55e" />
        )}
        {/* C-terminus marker */}
        {atoms[atoms.length - 1] && (
          <circle cx={toSvgX(atoms[atoms.length - 1].x)} cy={toSvgY(atoms[atoms.length - 1].y)} r={4} fill="#ef4444" />
        )}
        <text x={8} y={H - 8} fontSize={8} fill="#64748b">N</text>
        <circle cx={7} cy={H - 20} r={3} fill="#22c55e" />
        <text x={22} y={H - 8} fontSize={8} fill="#64748b">C</text>
        <circle cx={21} cy={H - 20} r={3} fill="#ef4444" />
      </svg>
    </div>
  );
}

function FoldPanel({ sequence, selection }: { sequence: string; selection: { start: number; end: number } | null }) {
  const [aaInput, setAaInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [pdb, setPdb] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const cleanAA = aaInput.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
  const lenOk = cleanAA.length >= 10 && cleanAA.length <= 400;

  const autoTranslate = () => {
    const region = selection
      ? sequence.substring(selection.start - 1, selection.end)
      : sequence;
    setAaInput(aaFromDNA(region));
    setPdb('');
    setStatus('idle');
  };

  const handleFold = async () => {
    if (!cleanAA) return;
    setStatus('loading');
    setPdb('');
    setErrorMsg('');
    try {
      const res = await fetch('/api/protein/fold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: cleanAA }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setErrorMsg(data.error ?? 'Unknown error'); setStatus('error'); return; }
      setPdb(data.pdb);
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  };

  const downloadPdb = () => {
    const blob = new Blob([pdb], { type: 'chemical/x-pdb' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'structure.pdb'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>Protein 3D Structure Prediction</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
          Predicts protein fold via <strong>ESMFold</strong> (Meta ESM-2). Enter an amino acid sequence or auto-translate the current sequence.
        </p>
      </div>

      {/* AA input */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
          <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Amino Acid Sequence (single-letter, max 400 aa)
          </label>
          <button
            onClick={autoTranslate}
            style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            ⬇ Translate {selection ? 'selection' : 'full sequence'}
          </button>
        </div>
        <textarea
          className="input-control"
          value={aaInput}
          onChange={e => { setAaInput(e.target.value.toUpperCase()); setStatus('idle'); setPdb(''); }}
          placeholder="MKTLLLTLVVVTIVCLDLGAVGNGNSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL…"
          style={{ width: '100%', minHeight: 72, fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.5rem 0.7rem', resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.35rem', flexWrap: 'wrap' }}>
          {cleanAA.length > 0 && (
            <>
              <Badge label={`${cleanAA.length} aa`} color={lenOk ? '#22c55e' : '#ef4444'} />
              {!lenOk && <Badge label={cleanAA.length < 10 ? 'Too short (min 10)' : 'Too long (max 400)'} color="#ef4444" />}
            </>
          )}
          {/* check invalid characters */}
          {aaInput.replace(/\s/g, '').split('').some(c => !VALID_AA.has(c.toUpperCase())) && (
            <Badge label="Non-standard chars removed" color="#f59e0b" />
          )}
        </div>
      </div>

      <button
        onClick={handleFold}
        disabled={!lenOk || status === 'loading'}
        className="btn btn-primary"
        style={{ fontSize: '0.82rem', marginBottom: '1rem' }}
      >
        {status === 'loading' ? '⏳ Predicting structure…' : '⚛️ Predict 3D Structure'}
      </button>

      {status === 'loading' && (
        <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '7px', fontSize: '0.82rem', color: '#1d4ed8', marginBottom: '1rem' }}>
          Calling ESMFold… this typically takes 5–30 seconds depending on sequence length.
        </div>
      )}

      {status === 'error' && (
        <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '0.82rem', color: '#dc2626', marginBottom: '1rem' }}>
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {status === 'done' && pdb && (
        <div>
          {/* Backbone viewer */}
          <div style={{ marginBottom: '0.75rem' }}>
            <PdbViewer pdb={pdb} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button onClick={downloadPdb} className="btn btn-primary" style={{ fontSize: '0.82rem' }}>
              ⬇ Download PDB File
            </button>
            <button
              onClick={() => {
                const blob = new Blob([pdb], { type: 'text/plain' });
                const url  = URL.createObjectURL(blob);
                window.open(`https://molstar.org/viewer/?snapshot-url=${encodeURIComponent(url)}&snapshot-url-type=pdb`, '_blank');
              }}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem' }}
            >
              🌐 View in Mol*
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(pdb)}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem' }}
            >
              📋 Copy PDB
            </button>
          </div>

          {/* PDB text preview */}
          <details>
            <summary style={{ fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '0.4rem' }}>
              Show raw PDB ({pdb.split('\n').length} lines)
            </summary>
            <pre style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: '#0f172a', color: '#86efac', padding: '0.75rem', borderRadius: '7px', maxHeight: 220, overflowY: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {pdb.substring(0, 4000)}{pdb.length > 4000 ? '\n…[truncated]' : ''}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
