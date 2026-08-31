import { revComp } from './alignment';
import { assemble, sticky, blunt, type Assembly, type Fragment } from './assembly';

/**
 * TA, TOPO-TA, blunt TOPO and directional TOPO.
 *
 * The simplest joins in the set, and the ones where the honest answer is not
 * a single construct. Taq leaves a single 3' A on a PCR product; the vector
 * carries a single 3' T. An A pairs with a T at both ends, so the insert goes
 * in either way round, and the reaction has no preference. That is not a fault
 * to be warned about -- it is the method, and it is why the next step is
 * screening colonies rather than assuming.
 *
 * So both orientations are returned, labelled, and the one matching the insert
 * as supplied is marked. Directional TOPO is the exception: a CACC added to
 * the forward primer anneals to the vector's four-base overhang, and only one
 * orientation forms.
 */

export type TopoMethod = 'ta' | 'topo-ta' | 'topo-blunt' | 'topo-directional';

export interface TopoSpec {
  name: string;
  directional: boolean;
  /** What the vector presents at each end. */
  vectorEnd: string;
  note: string;
}

export const TOPO_METHODS: Record<TopoMethod, TopoSpec> = {
  'ta': {
    name: 'TA cloning',
    directional: false,
    vectorEnd: "single 3' T",
    note: 'Taq leaves a 3′ A on the product; the vector carries a 3′ T. Ligase joins them.',
  },
  'topo-ta': {
    name: 'TOPO TA',
    directional: false,
    vectorEnd: "single 3' T, topoisomerase-charged",
    note: 'The same A/T geometry, but topoisomerase I is already bound to the vector and does the joining. Five minutes, no ligase.',
  },
  'topo-blunt': {
    name: 'Blunt TOPO',
    directional: false,
    vectorEnd: 'blunt, topoisomerase-charged',
    note: 'For products from a proofreading polymerase, which leave blunt ends and will not TA clone.',
  },
  'topo-directional': {
    name: 'Directional TOPO',
    directional: true,
    vectorEnd: "4-base 3' overhang",
    note: 'A CACC added to the forward primer anneals to the vector overhang, so the insert can only go in one way.',
  },
};

/** The 5′ extension a directional TOPO forward primer must carry. */
export const DIRECTIONAL_TAG = 'CACC';

export interface TopoOrientation {
  /** 'forward' when the insert reads as supplied; 'reverse' when flipped. */
  sense: 'forward' | 'reverse';
  assembly: Assembly;
}

export interface TopoResult {
  method: TopoMethod;
  spec: TopoSpec;
  orientations: TopoOrientation[];
  problems: string[];
  notes: string[];
}

/**
 * Build the insert as the polymerase leaves it.
 *
 * A Taq product carries one unpaired A at the 3′ end of each strand, which in
 * this model is a one-base 3′ overhang at both ends. A proofreading enzyme
 * leaves neither, which is exactly why such a product fails to TA clone.
 */
function insertFragment(id: string, name: string, seq: string, method: TopoMethod): Fragment {
  const core = seq.toUpperCase().replace(/[^ACGTN]/g, '');
  if (method === 'topo-blunt') {
    return { id, name, seq: core, left: blunt(), right: blunt() };
  }
  if (method === 'topo-directional') {
    // The CACC is carried on the forward primer, so it is part of the product,
    // and the vector's overhang pairs with it. A product without it is not a
    // directional product: it is a blunt one, and it goes in either way round.
    // Modelling it as directional anyway would show a single orientation while
    // the warning says two, which is worse than either answer alone.
    return { id, name, seq: core, left: sticky("3'", revComp(DIRECTIONAL_TAG)), right: blunt() };
  }
  return { id, name, seq: core, left: sticky("3'", 'A'), right: sticky("3'", 'A') };
}

function vectorFragment(id: string, name: string, seq: string, method: TopoMethod): Fragment {
  const core = seq.toUpperCase().replace(/[^ACGTN]/g, '');
  if (method === 'topo-blunt') {
    return { id, name, seq: core, left: blunt(), right: blunt() };
  }
  if (method === 'topo-directional') {
    return { id, name, seq: core, left: blunt(), right: sticky("3'", DIRECTIONAL_TAG) };
  }
  return { id, name, seq: core, left: sticky("3'", 'T'), right: sticky("3'", 'T') };
}

export function topoCloning(
  insert: { name: string; sequence: string },
  vector: { name: string; sequence: string },
  method: TopoMethod = 'topo-ta',
): TopoResult {
  const spec = TOPO_METHODS[method];
  const problems: string[] = [];
  const notes: string[] = [];

  const insertSeq = insert.sequence.toUpperCase().replace(/[^ACGTN]/g, '');
  const vectorSeq = vector.sequence.toUpperCase().replace(/[^ACGTN]/g, '');

  if (!insertSeq || !vectorSeq) {
    problems.push('Both an insert and a vector are needed.');
    return { method, spec, orientations: [], problems, notes };
  }

  if (method === 'topo-directional' && !insertSeq.startsWith(DIRECTIONAL_TAG)) {
    problems.push(
      `Directional TOPO needs the insert to begin with ${DIRECTIONAL_TAG}, added on the forward primer. ` +
      `Without it the product still clones, but in either orientation, which defeats the point.`,
    );
  }

  if (method !== 'topo-blunt' && method !== 'topo-directional') {
    notes.push(
      'This assumes a Taq-amplified product. A proofreading polymerase leaves blunt ends and will not ' +
      'TA clone; use blunt TOPO, or add an A with a short Taq extension.',
    );
  }

  // Without the tag, a directional vector is simply a blunt one: its overhang
  // has nothing to pair with and goes unused, and topoisomerase joins both
  // ends blunt. Modelling it as directional anyway finds no product at all,
  // which contradicts the warning that says it clones in either orientation.
  const tagged = insertSeq.startsWith(DIRECTIONAL_TAG);
  const effective: TopoMethod =
    method === 'topo-directional' && !tagged ? 'topo-blunt' : method;

  const ins = insertFragment('insert', insert.name, insertSeq, effective);
  const vec = vectorFragment('vector', vector.name, vectorSeq, effective);

  const result = assemble([vec, ins], {
    mode: 'overhang',
    topology: 'circular',
    // Directional TOPO is sticky at one end and blunt at the other:
    // topoisomerase joins the blunt side. Only the sticky end decides
    // orientation, which is the whole point of the CACC.
    allowBlunt: effective === 'topo-blunt' || effective === 'topo-directional',
    limit: 4,
  });

  const orientations: TopoOrientation[] = result.assemblies.map(a => {
    const placed = a.order.find(p => p.fragmentId === 'insert');
    return { sense: placed?.flipped ? 'reverse' : 'forward', assembly: a };
  });

  if (orientations.length === 0) {
    problems.push(
      method === 'topo-directional'
        ? 'The insert and vector ends do not pair. Check the CACC extension.'
        : 'The insert and vector ends do not pair.',
    );
  }

  if (!spec.directional && orientations.length > 1) {
    notes.push(
      'Both orientations form, in roughly equal numbers. That is the method working, not failing: ' +
      'screen colonies, or use directional TOPO if orientation matters.',
    );
  }

  const actuallyDirectional = method === 'topo-directional' && tagged;
  if (actuallyDirectional && orientations.length > 1) {
    problems.push('More than one orientation formed, which a directional reaction should not allow.');
  }
  if (method === 'topo-directional' && !actuallyDirectional && orientations.length > 1) {
    notes.push('Shown as it would actually behave without the tag: both orientations, in equal numbers.');
  }

  return { method, spec, orientations, problems, notes };
}
