/**
 * Proving an installation is the one it is supposed to be.
 *
 * A regulated lab cannot use software because it works; it has to be able to
 * show that this copy, on this machine, is the version that was qualified, and
 * that the things it depends on are as they were when somebody signed for it.
 * That is what an installation qualification is, and the reason it is usually
 * a folder of screenshots is that nothing produces it.
 *
 * Split in two, the way the documents are:
 *
 *   Installation qualification asks whether the right thing is installed --
 *   versions, schema, configuration, the database it is actually talking to.
 *
 *   Operational qualification asks whether it does what it says. Those are the
 *   application's own checks, run against the live installation rather than
 *   against a test fixture, which is the distinction that makes them worth
 *   anything: a test suite proves the code is right, and an OQ proves the
 *   deployment is.
 *
 * Nothing here decides whether a lab is compliant. It produces evidence with
 * enough detail to be argued with, which is all a tool can honestly do.
 */

export type CheckState = 'pass' | 'fail' | 'warn' | 'info';

export interface Check {
  id: string;
  /** What is being asked, in the words a reader of the report needs. */
  question: string;
  state: CheckState;
  /** What was found. Always filled, including on a pass. */
  found: string;
  /** What was expected, where there is a definite answer. */
  expected?: string;
  /** Why this is being asked at all. */
  because?: string;
}

export interface Qualification {
  /** installation | operational */
  stage: 'IQ' | 'OQ';
  at: string;
  checks: Check[];
  summary: { pass: number; fail: number; warn: number; info: number };
  /** True only when nothing failed. Warnings do not make it false. */
  qualified: boolean;
}

export function summarise(stage: 'IQ' | 'OQ', checks: Check[], at = new Date()): Qualification {
  const summary = { pass: 0, fail: 0, warn: 0, info: 0 };
  for (const c of checks) summary[c.state]++;
  return {
    stage,
    at: at.toISOString(),
    checks,
    summary,
    /*
     * A warning does not fail a qualification, and this is deliberate. Most
     * warnings here are about how an installation is configured rather than
     * whether it is correct -- no outbound mail, no NCBI contact address --
     * and a report that failed on those would be ignored, which is how a
     * failing check stops meaning anything.
     */
    qualified: summary.fail === 0,
  };
}

// ─── Version comparison ──────────────────────────────────────────────────────

/**
 * Whether a version is at least another, by semantic version order.
 *
 * Written out rather than compared as strings, because "22.18.0" is less than
 * "9.0.0" as text and a node version check that got that backwards would pass
 * on exactly the installations it exists to catch.
 */
export function atLeast(version: string, minimum: string): boolean {
  const parts = (v: string) =>
    v.replace(/^v/, '').split('.').map(n => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function versionCheck(id: string, what: string, found: string, minimum: string, because?: string): Check {
  const ok = atLeast(found, minimum);
  return {
    id,
    question: `Is ${what} at least ${minimum}?`,
    state: ok ? 'pass' : 'fail',
    found: found || 'not found',
    expected: `${minimum} or newer`,
    because,
  };
}

// ─── Comparing a schema against the one that was qualified ───────────────────

export interface SchemaShape {
  /** Table name to its column names, sorted. */
  tables: Record<string, string[]>;
}

export interface SchemaDiff {
  missingTables: string[];
  extraTables: string[];
  changedTables: { table: string; missingColumns: string[]; extraColumns: string[] }[];
  same: boolean;
}

/**
 * What differs between the schema here and the one recorded at qualification.
 *
 * Both directions are reported, and extra is not treated as harmless. A column
 * nobody expected is the normal shape of an undocumented change, and in a
 * regulated setting the fact that nobody can say where it came from is the
 * finding, not the column.
 */
export function diffSchema(expected: SchemaShape, found: SchemaShape): SchemaDiff {
  const expectedTables = Object.keys(expected.tables);
  const foundTables = Object.keys(found.tables);

  const missingTables = expectedTables.filter(t => !foundTables.includes(t)).sort();
  const extraTables = foundTables.filter(t => !expectedTables.includes(t)).sort();

  const changedTables: SchemaDiff['changedTables'] = [];
  for (const table of expectedTables) {
    if (!foundTables.includes(table)) continue;
    const want = expected.tables[table] ?? [];
    const have = found.tables[table] ?? [];
    const missingColumns = want.filter(c => !have.includes(c)).sort();
    const extraColumns = have.filter(c => !want.includes(c)).sort();
    if (missingColumns.length || extraColumns.length) {
      changedTables.push({ table, missingColumns, extraColumns });
    }
  }

  return {
    missingTables,
    extraTables,
    changedTables,
    same: missingTables.length === 0 && extraTables.length === 0 && changedTables.length === 0,
  };
}

export function schemaCheck(diff: SchemaDiff): Check {
  if (diff.same) {
    return {
      id: 'schema',
      question: 'Does the database schema match the one recorded at qualification?',
      state: 'pass',
      found: 'Every table and column matches.',
      because: 'A schema that has drifted is a deployment nobody can say the version of.',
    };
  }

  const bits: string[] = [];
  if (diff.missingTables.length) bits.push(`missing ${diff.missingTables.join(', ')}`);
  if (diff.extraTables.length) bits.push(`unexpected ${diff.extraTables.join(', ')}`);
  for (const t of diff.changedTables) {
    const parts = [
      t.missingColumns.length ? `missing ${t.missingColumns.join(', ')}` : '',
      t.extraColumns.length ? `unexpected ${t.extraColumns.join(', ')}` : '',
    ].filter(Boolean);
    bits.push(`${t.table}: ${parts.join('; ')}`);
  }

  return {
    id: 'schema',
    question: 'Does the database schema match the one recorded at qualification?',
    /*
     * A missing column breaks the application; an extra one does not. Both are
     * reported, and only the first fails -- but the second is a warning rather
     * than nothing, because an undocumented change is the thing an audit is
     * looking for.
     */
    state: diff.missingTables.length || diff.changedTables.some(t => t.missingColumns.length) ? 'fail' : 'warn',
    found: bits.join(' · '),
    expected: 'The schema recorded when this version was qualified.',
    because: 'A schema that has drifted is a deployment nobody can say the version of.',
  };
}

// ─── The report ──────────────────────────────────────────────────────────────

/**
 * The report as text, which is what gets printed and signed.
 *
 * Plain text on purpose. It has to survive being pasted into a quality
 * management system that was written in 2004, and a reader has to be able to
 * tell at a glance that nothing was left out.
 */
export function renderReport(q: Qualification, title: string, context: Record<string, string> = {}): string {
  const line = '─'.repeat(72);
  const out: string[] = [];

  out.push(title);
  out.push(line);
  out.push(`Stage        ${q.stage === 'IQ' ? 'Installation qualification' : 'Operational qualification'}`);
  out.push(`Generated    ${q.at}`);
  for (const [k, v] of Object.entries(context)) {
    out.push(`${k.padEnd(12)} ${v}`);
  }
  out.push(line);
  out.push('');

  for (const c of q.checks) {
    out.push(`[${c.state.toUpperCase().padEnd(4)}] ${c.question}`);
    out.push(`         found: ${c.found}`);
    if (c.expected) out.push(`      expected: ${c.expected}`);
    if (c.because) out.push(`           why: ${c.because}`);
    out.push('');
  }

  out.push(line);
  out.push(
    `${q.summary.pass} passed, ${q.summary.fail} failed, `
    + `${q.summary.warn} warning${q.summary.warn === 1 ? '' : 's'}, ${q.summary.info} for information.`,
  );
  out.push(q.qualified
    ? 'No check failed. This evidences the installation; it does not certify it — '
    + 'that is a judgement for whoever signs below.'
    : 'One or more checks failed. This installation is not qualified until they are resolved.');
  out.push('');
  out.push('Performed by ......................................  Date ................');
  out.push('Reviewed by  ......................................  Date ................');

  return out.join('\n');
}
