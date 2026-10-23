#!/usr/bin/env node
/**
 * Produce an installation qualification report for this deployment.
 *
 *   node scripts/qualify.mjs            # print it
 *   node scripts/qualify.mjs --out IQ.txt
 *   node scripts/qualify.mjs --record   # record this schema as the qualified one
 *
 * It runs against the installation it is in: the real database, the real
 * environment, the real versions. A report produced against a fixture would
 * prove nothing about the machine the lab is using, which is the only machine
 * the report is about.
 *
 * Exits non-zero when a check fails, so a deployment pipeline can refuse to
 * finish on an installation that is not what it should be.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = path.join(root, 'docs', 'qualified-schema.json');

const { summarise, renderReport, versionCheck, diffSchema, schemaCheck } =
  await import(path.join(root, 'src/lib/qualification.ts'));
const { providerFor, PORTABILITY_NOTES } =
  await import(path.join(root, 'src/lib/db-provider.ts'));

const args = process.argv.slice(2);
const outAt = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const record = args.includes('--record');

const checks = [];
const note = (id, question, state, found, extra = {}) =>
  checks.push({ id, question, state, found, ...extra });

// ── What is installed ────────────────────────────────────────────────────────

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
note('version', 'Which version of the application is this?', 'info', `${pkg.name} ${pkg.version ?? 'unversioned'}`);

checks.push(versionCheck(
  'node', 'the Node runtime', process.versions.node, '22.18.0',
  'The test runner and the type stripping both need it; below this the application does not start.',
));

// The commit, where this is a checkout rather than a tarball. Not a failure
// when absent: a released build has no git directory, and demanding one would
// fail exactly the deployments that were done properly.
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  note('commit', 'Which revision is deployed?', dirty ? 'warn' : 'pass',
    dirty ? `${commit} with uncommitted changes` : commit,
    dirty ? { because: 'A working copy with local edits is not a revision anybody can reproduce.' } : {});
} catch {
  note('commit', 'Which revision is deployed?', 'info', 'not a git checkout');
}

// ── What it is talking to ────────────────────────────────────────────────────

const url = process.env.DATABASE_URL;
const provider = providerFor(url);
note('database', 'Which database is this installation using?', url ? 'pass' : 'fail',
  url ? `${provider} (${redact(url)})` : 'DATABASE_URL is not set',
  { because: 'Every other check is about the contents of this database.' });

let found = { tables: {} };
if (url) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    found = await readSchema(prisma, provider);
    const tableCount = Object.keys(found.tables).length;
    note('reachable', 'Does the database answer?', tableCount > 0 ? 'pass' : 'fail',
      tableCount > 0 ? `${tableCount} tables` : 'no tables found');

    // A few counts, so the report says what was in it at the time. An empty
    // installation is not a failure; an unexplained one is a question.
    const users = await prisma.user.count();
    note('users', 'How many accounts exist?', users > 0 ? 'pass' : 'warn',
      `${users}`, users === 0 ? { because: 'An installation with no accounts has not been handed over yet.' } : {});
  } catch (e) {
    note('reachable', 'Does the database answer?', 'fail', String(e.message ?? e));
  } finally {
    await prisma.$disconnect();
  }
}

// ── Is it the schema that was qualified ──────────────────────────────────────

if (record) {
  await writeFile(baseline, JSON.stringify(found, null, 2) + '\n');
  console.error(`Recorded ${Object.keys(found.tables).length} tables as the qualified schema in ${path.relative(root, baseline)}.`);
  process.exit(0);
}

try {
  await access(baseline);
  const expected = JSON.parse(await readFile(baseline, 'utf8'));
  checks.push(schemaCheck(diffSchema(expected, found)));
} catch {
  note('schema', 'Does the database schema match the one recorded at qualification?', 'warn',
    'No qualified schema has been recorded',
    { because: 'Run with --record on the installation being qualified, and keep the file under change control.' });
}

// ── Configuration a regulated install is asked about ─────────────────────────

const env = (name) => (process.env[name] ?? '').trim();

note('session-secret', 'Is the session secret set to something of its own?', env('SESSION_SECRET').length >= 32 ? 'pass' : 'fail',
  env('SESSION_SECRET') ? `${env('SESSION_SECRET').length} characters` : 'not set',
  { expected: '32 characters or more', because: 'It signs every session cookie; a short or shared one makes them forgeable.' });

note('mail', 'Can the installation send mail?', env('SMTP_HOST') ? 'pass' : 'warn',
  env('SMTP_HOST') || 'not configured',
  { because: 'Invitations and notifications go out this way; without it they have to be carried by hand.' });

note('local-webhooks', 'Are webhooks allowed to post inside this network?', env('WEBHOOK_ALLOW_LOCAL') === '1' ? 'warn' : 'pass',
  env('WEBHOOK_ALLOW_LOCAL') === '1' ? 'yes' : 'no',
  { because: 'It is for writing an integration against a local script, and should be off in a validated deployment.' });

for (const n of PORTABILITY_NOTES) {
  if (provider === 'sqlite' && n.area === 'Backups') continue;
  note(`portability-${n.area.toLowerCase()}`, `${n.area}: what differs between SQLite and PostgreSQL?`, 'info', n.note);
}

// ── Out ──────────────────────────────────────────────────────────────────────

const report = summarise('IQ', checks);
const text = renderReport(report, `${pkg.name} — installation qualification`, {
  Version: pkg.version ?? 'unversioned',
  Revision: commit || 'unknown',
  Database: provider,
  Host: process.env.HOSTNAME || (await hostname()),
});

if (outAt) {
  await writeFile(outAt, text + '\n');
  console.error(`Written to ${outAt}`);
} else {
  console.log(text);
}

process.exit(report.qualified ? 0 : 1);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tables and columns, asked of the database rather than of the schema file. */
async function readSchema(prisma, provider) {
  const tables = {};
  if (provider === 'postgresql') {
    const rows = await prisma.$queryRawUnsafe(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' order by table_name, column_name`,
    );
    for (const r of rows) (tables[r.table_name] ??= []).push(r.column_name);
  } else {
    const names = await prisma.$queryRawUnsafe(
      `select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_prisma%' order by name`,
    );
    for (const { name } of names) {
      const cols = await prisma.$queryRawUnsafe(`pragma table_info('${name.replace(/'/g, "''")}')`);
      tables[name] = cols.map(c => c.name).sort();
    }
  }
  return { tables };
}

/** A connection string without its password, because this report gets filed. */
function redact(u) {
  try {
    const parsed = new URL(u);
    if (parsed.password) parsed.password = '…';
    return parsed.toString();
  } catch {
    return u.replace(/:\/\/[^@]*@/, '://…@');
  }
}

async function hostname() {
  const os = await import('node:os');
  return os.hostname();
}
