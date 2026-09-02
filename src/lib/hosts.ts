/**
 * Where a construct is grown, and what it is grown in.
 *
 * Two questions a plasmid record could not answer. Both are free text in every
 * lab notebook and neither should be: "BL21" and "BL21(DE3)" are different
 * strains with different behaviour, and a digest that fails because the DNA
 * came out of a Dam+ strain is a wasted afternoon that the record already had
 * the information to prevent.
 *
 * The strain entries carry genotype rather than only a name, because that is
 * the part the rest of the application can reason about -- lib/methylation.ts
 * already tells people to "use a dam- strain" without knowing whether they
 * did.
 */

// ─── Laboratory host ─────────────────────────────────────────────────────────

export type HostKingdom = 'bacteria' | 'fungi' | 'insect' | 'mammalian' | 'plant';

export interface HostOrganism {
  /** Stored. Stable across renames of the label. */
  id: string;
  name: string;
  /** Binomial, where the common name above is an abbreviation or a line. */
  latin?: string;
  note?: string;
}

export interface HostGroup {
  id: HostKingdom;
  label: string;
  organisms: HostOrganism[];
}

export const LAB_HOSTS: HostGroup[] = [
  {
    id: 'bacteria',
    label: 'Bacteria',
    organisms: [
      { id: 'e-coli', name: 'Escherichia coli', note: 'Cloning and most expression work' },
      { id: 'b-subtilis', name: 'Bacillus subtilis', note: 'Gram-positive; secreted expression' },
      { id: 'a-tumefaciens', name: 'Agrobacterium tumefaciens', note: 'Vector for plant transformation' },
      { id: 'p-putida', name: 'Pseudomonas putida', note: 'Solvent-tolerant chassis' },
    ],
  },
  {
    id: 'fungi',
    label: 'Yeast / Fungi',
    organisms: [
      { id: 's-cerevisiae', name: 'Saccharomyces cerevisiae', note: 'Budding yeast; homologous recombination cloning' },
      { id: 'p-pastoris', name: 'Pichia pastoris', latin: 'Komagataella phaffii', note: 'Methylotrophic; high-density secreted expression' },
      { id: 's-pombe', name: 'Schizosaccharomyces pombe', note: 'Fission yeast' },
    ],
  },
  {
    id: 'insect',
    label: 'Insect cells',
    organisms: [
      { id: 'sf9', name: 'Sf9', latin: 'Spodoptera frugiperda', note: 'Baculovirus expression' },
      { id: 'sf21', name: 'Sf21', latin: 'Spodoptera frugiperda' },
      { id: 'high-five', name: 'High Five (BTI-Tn-5B1-4)', latin: 'Trichoplusia ni', note: 'Higher secreted yield than Sf9' },
    ],
  },
  {
    id: 'mammalian',
    label: 'Mammalian cells',
    organisms: [
      { id: 'hek293', name: 'HEK293', note: 'Transient expression; 293T/293F variants' },
      { id: 'cho', name: 'CHO', note: 'Stable lines; biologics manufacture' },
      { id: 'cos7', name: 'COS-7', note: 'SV40 large T; episomal replication of SV40-ori plasmids' },
      { id: 'hela', name: 'HeLa', note: 'Cell biology and reporter assays' },
    ],
  },
  {
    id: 'plant',
    label: 'Plant host',
    organisms: [
      { id: 'a-thaliana', name: 'Arabidopsis thaliana', note: 'Floral dip; stable lines' },
      { id: 'n-benthamiana', name: 'Nicotiana benthamiana', note: 'Agroinfiltration; transient expression' },
    ],
  },
];

// ─── Transformation strain ───────────────────────────────────────────────────

/**
 * Whether the strain's own methylases mark the DNA it produces.
 *
 * This is the field that earns the taxonomy its keep. Dam methylation blocks
 * MboI, ClaI, XbaI, BclI and others at overlapping sites; Dcm blocks EcoRII,
 * StuI and friends. A plasmid prepped from DH5-alpha carries both, and the
 * digest that then fails is not a bad enzyme.
 */
export interface StrainMethylation {
  /** GATC adenine methylase. */
  dam: boolean;
  /** CCWGG cytosine methylase. */
  dcm: boolean;
  /**
   * Host restriction of *incoming* methylated DNA -- McrA, McrBC, Mrr and
   * EcoKI. 'restricting' cuts methylated genomic DNA on the way in, which is
   * why cloning from a methylated source needs a deficient strain.
   */
  incoming: 'restricting' | 'deficient';
}

export interface Strain {
  /** Stored. */
  id: string;
  name: string;
  /** The species, where it is not E. coli. */
  species?: string;
  /** The part of the genotype that explains the strain's purpose. */
  genotype?: string;
  methylation: StrainMethylation;
  /** What it is reached for. */
  use?: string;
}

export interface StrainGroup {
  id: string;
  label: string;
  /** The genotype heading this group sits under, where there is one. */
  subLabel?: string;
  strains: Strain[];
}

const WILD_TYPE: StrainMethylation = { dam: true, dcm: true, incoming: 'restricting' };
const MCR_FREE: StrainMethylation = { dam: true, dcm: true, incoming: 'deficient' };

export const TRANSFORMATION_STRAINS: StrainGroup[] = [
  {
    id: 'cloning',
    label: 'Standard cloning',
    strains: [
      { id: 'dh5a', name: 'DH5α', genotype: 'recA1 endA1 lacZΔM15', methylation: WILD_TYPE, use: 'General subcloning; blue/white selection' },
      { id: 'top10', name: 'TOP10', genotype: 'mcrA Δ(mrr-hsdRMS-mcrBC) recA1 endA1', methylation: MCR_FREE, use: 'General cloning; tolerates methylated inserts' },
      { id: 'xl1-blue', name: 'XL1-Blue', genotype: 'recA1 endA1 lacIqZΔM15 Tn10 (TetR), F′', methylation: WILD_TYPE, use: 'Cloning; F′ allows helper-phage rescue' },
      { id: 'jm109', name: 'JM109', genotype: 'recA1 endA1 Δ(lac-proAB), F′', methylation: WILD_TYPE, use: 'Cloning; stable for repeats' },
      { id: 'hb101', name: 'HB101', genotype: 'recA13 hsdS20 (rB− mB−)', methylation: WILD_TYPE, use: 'Older general-purpose host' },
      { id: 'dh10b', name: 'DH10B / MegaX', genotype: 'Δ(mrr-hsdRMS-mcrBC) recA1 endA1', methylation: MCR_FREE, use: 'Large plasmids, BACs, unmethylated and methylated DNA alike' },
    ],
  },
  {
    id: 'restriction-wt',
    label: 'Methylation & restriction',
    subLabel: 'Wild type — Dam+ Dcm+ EcoKI+',
    strains: [
      {
        id: 'wild-type-status',
        name: 'Standard strain (Dam+ Dcm+ EcoKI+)',
        genotype: 'Wild-type restriction and modification',
        methylation: WILD_TYPE,
        use: 'The default for ordinary cloning strains; DNA carries Dam and Dcm marks',
      },
    ],
  },
  {
    id: 'restriction-dam-dcm',
    label: 'Methylation & restriction',
    subLabel: 'Dam− Dcm−',
    strains: [
      { id: 'jm110', name: 'JM110', genotype: 'dam− dcm− recA1 endA1, F′', methylation: { dam: false, dcm: false, incoming: 'restricting' }, use: 'Prep DNA for XbaI, BclI, ClaI, MboI and other Dam-blocked sites' },
      { id: 'inv110', name: 'INV110', genotype: 'dam− dcm− (Invitrogen)', methylation: { dam: false, dcm: false, incoming: 'restricting' }, use: 'As JM110; Dam/Dcm-free plasmid prep' },
    ],
  },
  {
    id: 'restriction-mcr',
    label: 'Methylation & restriction',
    subLabel: 'McrA− McrBC− Mrr−',
    strains: [
      { id: 'dh12s', name: 'DH12S', genotype: 'mcrA Δ(mrr-hsdRMS-mcrBC), F′', methylation: MCR_FREE, use: 'Cloning methylated genomic DNA; ssDNA rescue' },
      { id: 'epi300', name: 'EPI300', genotype: 'mcrA Δ(mrr-hsdRMS-mcrBC) trfA', methylation: MCR_FREE, use: 'Methylated genomic DNA; inducible copy number for hard inserts' },
    ],
  },
  {
    id: 'expression',
    label: 'Protein expression',
    strains: [
      { id: 'bl21-de3', name: 'BL21(DE3)', genotype: 'lon− ompT−, λDE3 (T7 pol under lacUV5)', methylation: WILD_TYPE, use: 'Workhorse T7 expression; protease deficient' },
      { id: 'bl21-codonplus', name: 'BL21-CodonPlus(DE3)', genotype: 'λDE3 + extra rare-codon tRNAs', methylation: WILD_TYPE, use: 'Genes with rare codons for E. coli' },
      { id: 'rosetta-de3', name: 'Rosetta(DE3)', genotype: 'λDE3, pRARE (AUA AGG AGA CUA CCC GGA)', methylation: WILD_TYPE, use: 'Eukaryotic genes with rare codons' },
      { id: 'tuner-de3', name: 'Tuner(DE3)', genotype: 'lacY1 (lac permease deletion)', methylation: WILD_TYPE, use: 'IPTG enters uniformly, so expression level is tunable' },
      { id: 'origami-de3', name: 'Origami(DE3)', genotype: 'trxB− gor− , λDE3', methylation: WILD_TYPE, use: 'Disulfide-bonded protein folded in the cytoplasm' },
    ],
  },
  {
    id: 'ssdna',
    label: 'Phage display / single-stranded DNA',
    strains: [
      { id: 'tg1', name: 'TG1', genotype: 'supE thi-1 Δ(lac-proAB), F′ traD36', methylation: WILD_TYPE, use: 'Phage display library propagation' },
      { id: 'xl1-blue-mrf', name: "XL1-Blue MRF′", genotype: 'Δ(mcrA)183 Δ(mcrCB-hsdSMR-mrr)173, F′', methylation: MCR_FREE, use: 'Phagemid rescue; restriction deficient' },
      { id: 'er2738', name: 'ER2738', genotype: 'F′ proA+B+ lacIq Δ(lacZ)M15 zzf::Tn10', methylation: WILD_TYPE, use: 'M13 propagation; Ph.D. peptide display' },
    ],
  },
  {
    id: 'library',
    label: 'High-efficiency / library construction',
    strains: [
      { id: 'electromax-dh10b', name: 'ElectroMAX DH10B', genotype: 'DH10B, electrocompetent ≥10¹⁰ cfu/µg', methylation: MCR_FREE, use: 'Large libraries where transformants per µg is the limit' },
      { id: 'epi300-library', name: 'EPI300 (copy control)', genotype: 'trfA, inducible copy number', methylation: MCR_FREE, use: 'Low-copy library maintenance, induced to high copy for prep' },
    ],
  },
  {
    id: 'non-ecoli',
    label: 'Non-E. coli transformation',
    strains: [
      { id: 'gv3101', name: 'Agrobacterium GV3101', species: 'Agrobacterium tumefaciens', genotype: 'C58 rifR, pMP90 (gentR)', methylation: { dam: true, dcm: false, incoming: 'restricting' }, use: 'Arabidopsis floral dip; N. benthamiana agroinfiltration' },
      { id: 'lba4404', name: 'Agrobacterium LBA4404', species: 'Agrobacterium tumefaciens', genotype: 'Ach5, pAL4404 (strepR rifR)', methylation: { dam: true, dcm: false, incoming: 'restricting' }, use: 'Broad-host-range plant transformation' },
    ],
  },
];

// ─── Lookups ─────────────────────────────────────────────────────────────────

const HOST_BY_ID = new Map(LAB_HOSTS.flatMap(g => g.organisms.map(o => [o.id, { group: g, organism: o }] as const)));
const STRAIN_BY_ID = new Map(TRANSFORMATION_STRAINS.flatMap(g => g.strains.map(s => [s.id, { group: g, strain: s }] as const)));

export function findHost(id: string | null | undefined) {
  return id ? HOST_BY_ID.get(id) ?? null : null;
}

export function findStrain(id: string | null | undefined) {
  return id ? STRAIN_BY_ID.get(id) ?? null : null;
}

/** How a strain reads on one line: "JM110 — dam− dcm−". */
export function strainSummary(id: string | null | undefined): string | null {
  const found = findStrain(id);
  if (!found) return null;
  const { dam, dcm, incoming } = found.strain.methylation;
  const marks = [
    dam ? 'Dam+' : 'Dam−',
    dcm ? 'Dcm+' : 'Dcm−',
    incoming === 'deficient' ? 'McrBC−' : null,
  ].filter(Boolean).join(' ');
  return `${found.strain.name} — ${marks}`;
}

/**
 * Whether DNA prepped from this strain carries the mark a given system leaves.
 *
 * The question lib/methylation.ts is really asking when it says "use a dam−
 * strain": it has been guessing that the answer is yes, because nothing in the
 * record could tell it otherwise.
 */
export function carriesMethylation(id: string | null | undefined, system: 'dam' | 'dcm'): boolean {
  const found = findStrain(id);
  // Unknown strain: assume the ordinary case, which is what the warning always did.
  if (!found) return true;
  return system === 'dam' ? found.strain.methylation.dam : found.strain.methylation.dcm;
}
