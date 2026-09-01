/**
 * Microplate geometry and transfers.
 *
 * Inventory up to now stops at freezer / rack / box / position, which describes
 * where one tube sits. It cannot describe a screen: there the identity of a
 * sample *is* its coordinates, and the whole point is that ninety-six of them
 * were handled as one object by one pipetting step.
 *
 * Everything here is coordinate arithmetic, which sounds too simple to be worth
 * isolating until the first off-by-one puts row H where row A should be and
 * nobody notices until the plate is read. Wells are addressed by 0-indexed
 * (row, col) internally and by label ("A1", "H12") at every edge.
 */

export interface PlateFormat {
  wells: number;
  rows: number;
  cols: number;
  name: string;
}

/**
 * The standard SBS formats.
 *
 * All of them are 2:3 in row:column ratio, which is why a 96-well plate maps
 * onto a 384 by interleaving rather than by any more complicated rule.
 */
export const FORMATS: Record<number, PlateFormat> = {
  6: { wells: 6, rows: 2, cols: 3, name: '6-well' },
  12: { wells: 12, rows: 3, cols: 4, name: '12-well' },
  24: { wells: 24, rows: 4, cols: 6, name: '24-well' },
  48: { wells: 48, rows: 6, cols: 8, name: '48-well' },
  96: { wells: 96, rows: 8, cols: 12, name: '96-well' },
  384: { wells: 384, rows: 16, cols: 24, name: '384-well' },
  1536: { wells: 1536, rows: 32, cols: 48, name: '1536-well' },
};

export const FORMAT_LIST = Object.values(FORMATS);

export function formatOf(wells: number): PlateFormat {
  const f = FORMATS[wells];
  if (!f) {
    throw new Error(
      `${wells} is not a plate format. Known: ${Object.keys(FORMATS).join(', ')}.`,
    );
  }
  return f;
}

/**
 * Row letters.
 *
 * Past row 25 the convention doubles up — AA, AB — which is what 1536-well
 * plates need. Wrapping back to "A" instead would give two different wells the
 * same name on one plate.
 */
export function rowLabel(row: number): string {
  if (row < 0) throw new Error(`Row ${row} does not exist.`);
  if (row < 26) return String.fromCharCode(65 + row);
  const first = Math.floor(row / 26) - 1;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + (row % 26));
}

export function rowIndex(label: string): number {
  const s = label.toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(s)) throw new Error(`"${label}" is not a row.`);
  if (s.length === 1) return s.charCodeAt(0) - 65;
  return (s.charCodeAt(0) - 65 + 1) * 26 + (s.charCodeAt(1) - 65);
}

/** "A1" for (0, 0). Columns are 1-indexed in the label, as they are on a plate. */
export function wellLabel(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`;
}

export function parseWell(label: string): { row: number; col: number } {
  const m = /^([A-Za-z]{1,2})(\d{1,2})$/.exec(label.trim());
  if (!m) throw new Error(`"${label}" is not a well.`);
  const col = Number(m[2]) - 1;
  if (col < 0) throw new Error(`"${label}" is not a well — columns start at 1.`);
  return { row: rowIndex(m[1]), col };
}

/** Every well of a plate, row-major: A1, A2, ... A12, B1, ... */
export function allWells(format: PlateFormat): { row: number; col: number; label: string }[] {
  const out: { row: number; col: number; label: string }[] = [];
  for (let r = 0; r < format.rows; r++) {
    for (let c = 0; c < format.cols; c++) {
      out.push({ row: r, col: c, label: wellLabel(r, c) });
    }
  }
  return out;
}

export function inBounds(format: PlateFormat, row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < format.rows && col < format.cols;
}

/**
 * Expand a well range as people write it.
 *
 * "A1", "A1:C4", "A1-A12", or a comma-separated mixture. A range is the
 * rectangle between its corners, not the row-major run between them: selecting
 * A1:C4 on a plate means twelve wells in a block, which is what a multichannel
 * pipette actually touches. Reading it as a run would give thirty.
 */
export function expandRange(spec: string, format: PlateFormat): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  const seen = new Set<string>();

  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const [a, b] = part.split(/[:\-]/).map(s => s.trim());
    const from = parseWell(a);
    const to = b ? parseWell(b) : from;

    const r0 = Math.min(from.row, to.row), r1 = Math.max(from.row, to.row);
    const c0 = Math.min(from.col, to.col), c1 = Math.max(from.col, to.col);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!inBounds(format, r, c)) {
          throw new Error(`${wellLabel(r, c)} is outside a ${format.name} plate.`);
        }
        const k = `${r}:${c}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ row: r, col: c });
      }
    }
  }
  return out;
}

export type FillOrder = 'row' | 'column';

/**
 * Order wells the way a person fills a plate.
 *
 * Down the columns is the default in most protocols, because that is the
 * direction an eight-channel pipette moves. Across the rows is what a
 * spreadsheet gives you. Getting this backwards transposes an entire
 * experiment, silently, and every value still looks plausible.
 */
export function fillOrder<T extends { row: number; col: number }>(
  wells: T[], order: FillOrder,
): T[] {
  return [...wells].sort((a, b) =>
    order === 'row'
      ? a.row - b.row || a.col - b.col
      : a.col - b.col || a.row - b.row);
}

export interface TransferStep {
  from: { row: number; col: number; label: string };
  to: { row: number; col: number; label: string };
}

/**
 * A one-to-one transfer between plates of the same format.
 *
 * The common case, and the one worth having a name for: a replica plate, a
 * stamp from a master.
 */
export function stamp(format: PlateFormat, wells?: { row: number; col: number }[]): TransferStep[] {
  const list = wells ?? allWells(format);
  return list.map(w => ({
    from: { ...w, label: wellLabel(w.row, w.col) },
    to: { ...w, label: wellLabel(w.row, w.col) },
  }));
}

/**
 * Map a 96-well plate into one quadrant of a 384.
 *
 * Quadrant 0 is the top-left well of each 2×2 group, 1 is top-right, 2 is
 * bottom-left, 3 is bottom-right — the order a four-plate consolidation runs
 * in. Well A1 of a 96 goes to A1, A2, B1 or B2 of the 384 depending on the
 * quadrant, and every other well follows by doubling its coordinates.
 */
export function quadrant(quad: number): TransferStep[] {
  if (quad < 0 || quad > 3) throw new Error('A 384-well plate has four quadrants, 0 to 3.');
  const dr = quad >= 2 ? 1 : 0;
  const dc = quad % 2;

  return allWells(FORMATS[96]).map(w => ({
    from: { ...w, label: wellLabel(w.row, w.col) },
    to: {
      row: w.row * 2 + dr,
      col: w.col * 2 + dc,
      label: wellLabel(w.row * 2 + dr, w.col * 2 + dc),
    },
  }));
}

/**
 * Cherry-pick: named source wells into consecutive destination wells.
 *
 * The destination fills in the given order, which is why `order` is a
 * parameter and not an assumption.
 */
export function cherryPick(
  sources: { row: number; col: number }[],
  destFormat: PlateFormat,
  order: FillOrder = 'column',
  startAt = 0,
): TransferStep[] {
  const targets = fillOrder(allWells(destFormat), order).slice(startAt);
  if (sources.length > targets.length) {
    throw new Error(
      `${sources.length} wells will not fit in the ${targets.length} remaining on a ${destFormat.name} plate.`,
    );
  }
  return sources.map((s, i) => ({
    from: { ...s, label: wellLabel(s.row, s.col) },
    to: { row: targets[i].row, col: targets[i].col, label: targets[i].label },
  }));
}

/** Several source wells into one destination. */
export function pool(
  sources: { row: number; col: number }[], dest: { row: number; col: number },
): TransferStep[] {
  return sources.map(s => ({
    from: { ...s, label: wellLabel(s.row, s.col) },
    to: { ...dest, label: wellLabel(dest.row, dest.col) },
  }));
}

export interface DilutionStep {
  well: { row: number; col: number; label: string };
  /** Dilution relative to the starting material. 1 is neat. */
  factor: number;
  /** Volume of the previous well to carry over. */
  transferUl: number;
  /** Volume of diluent already in the well. */
  diluentUl: number;
}

/**
 * A serial dilution along a row or down a column.
 *
 * Reported as the cumulative factor, not the per-step one, because the
 * cumulative factor is what goes on the axis of the graph — and computing it by
 * hand from the step factor is exactly where a decade of concentration goes
 * missing.
 */
export function serialDilution(
  start: { row: number; col: number },
  steps: number,
  foldPerStep: number,
  direction: 'row' | 'column',
  format: PlateFormat,
  transferUl = 20,
): DilutionStep[] {
  if (foldPerStep <= 1) throw new Error('A dilution step has to be more than 1-fold.');
  if (steps < 1) throw new Error('A dilution needs at least one step.');

  const out: DilutionStep[] = [];
  // The diluent volume that gives this fold change: carrying over v into d of
  // diluent dilutes by (v + d) / v.
  const diluentUl = transferUl * (foldPerStep - 1);

  for (let i = 0; i < steps; i++) {
    const row = direction === 'column' ? start.row + i : start.row;
    const col = direction === 'row' ? start.col + i : start.col;
    if (!inBounds(format, row, col)) {
      throw new Error(
        `A ${steps}-step dilution from ${wellLabel(start.row, start.col)} runs off a ${format.name} plate.`,
      );
    }
    out.push({
      well: { row, col, label: wellLabel(row, col) },
      factor: Math.pow(foldPerStep, i),
      transferUl: i === 0 ? 0 : transferUl,
      diluentUl: i === 0 ? 0 : diluentUl,
    });
  }
  return out;
}

export interface WellLike {
  row: number;
  col: number;
  label: string;
  role?: string | null;
  content?: string | null;
  sampleId?: string | null;
  entityId?: string | null;
  sequenceId?: string | null;
}

/**
 * True when the well has not been laid out at all.
 *
 * A role counts. Marking a block of wells "control" before anything physical
 * exists is a real and common step in designing a plate, and it is information
 * about the plate. Treating those wells as empty produced a plate that reported
 * "12 wells filled", drew nothing, said "0 of 96 wells used", and still listed
 * "control" in the legend — three parts of one feature disagreeing, because
 * roleColours looked at every well and this did not.
 */
export function isEmpty(w: WellLike): boolean {
  return !w.sampleId && !w.entityId && !w.sequenceId && !w.content && !w.role?.trim();
}

/** True when the well holds material a transfer could actually move. */
export function hasMaterial(w: WellLike): boolean {
  return Boolean(w.sampleId || w.entityId || w.sequenceId || w.content);
}

/**
 * Stable colours for the roles on a plate.
 *
 * Assigned by first appearance in row-major order, so the same layout always
 * looks the same. Hashing the role name would be stable too, but two roles
 * would eventually collide on one colour and a plate map whose "control" and
 * "treated" wells are the same shade is worse than useless.
 */
const ROLE_COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#14b8a6', '#ef4444', '#6366f1', '#84cc16', '#f97316',
];

export function roleColours(wells: WellLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const w of [...wells].sort((a, b) => a.row - b.row || a.col - b.col)) {
    const role = w.role?.trim();
    if (!role || out[role]) continue;
    out[role] = ROLE_COLOURS[n % ROLE_COLOURS.length];
    n++;
  }
  return out;
}

export interface PlateSummary {
  total: number;
  filled: number;
  empty: number;
  roles: { role: string; count: number }[];
  /** Wells holding something that is not a tracked record. */
  untracked: number;
}

export function summarise(wells: WellLike[], format: PlateFormat): PlateSummary {
  const filled = wells.filter(w => !isEmpty(w));
  const counts = new Map<string, number>();
  for (const w of filled) {
    const role = w.role?.trim();
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return {
    total: format.wells,
    filled: filled.length,
    empty: format.wells - filled.length,
    roles: [...counts.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    // Laid out, but not against a record the system holds: free text, or a
    // role and nothing else.
    untracked: filled.filter(w => !w.sampleId && !w.entityId && !w.sequenceId).length,
  };
}
