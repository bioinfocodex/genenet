# GeneNet

A lab information system you run yourself. Sample inventory, sequences,
protocols, projects and an audit trail — on your own machine, with the database
in a file you can copy.

Most lab software of this kind is a hosted subscription: your data lives on
someone else's server, priced per seat, and leaving means an export ticket.
GeneNet is the other arrangement. It is a single Next.js application over a
SQLite file. If you can copy that file, you have your data.

**Status:** in use, but young. The schema is still moving and there is no
upgrade path between versions yet. Read [Before you rely on it](#before-you-rely-on-it).

## What's in it

**Inventory** — samples with freezer/rack/box/position, freezer contents,
collections, and a search across every record type.

**Sequences** — a viewer with restriction mapping against 570 enzymes from
[REBASE](http://rebase.neb.com/), Type IIS support for Golden Gate, feature
tracks, translation, and import from GenBank, FASTA, SnapGene `.dna`, or an
NCBI/UniProt accession. Plus:

- *Alignment* — Gotoh affine-gap, used to verify a Sanger read against its
  reference. Tries both orientations and reports which one fit.
- *CRISPR* — guide design for SpCas9 and friends, scored with published rules
  rather than a fitted model, so the panel can show you why a guide lost points.
  Off-targets are searched within the loaded sequence, not genome-wide.

**Protocols and work** — SOPs with versions, experiments, projects, tasks,
gels, bioreactors, proteins, reports.

**Records that hold up** — every write is captured with who, what and when.
Electronic signatures carry a meaning (authorship, review, approval,
responsibility) and are hashed against the content they signed, so a signature
stops reading as current the moment the record changes underneath it.

**An API** — bearer tokens with read or write scope, for instruments and
scripts. Writes are attributed to the person the token belongs to, so the audit
trail stays honest. Revoking someone's account revokes their tokens.

## Running it

Node 24 or newer. The test suite uses Node's built-in runner and its native
TypeScript support, so there are no test dependencies to install.

```bash
git clone https://github.com/bioinfocodex/genenet.git
cd genenet
npm install
cp .env.example .env          # then set SESSION_SECRET
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000. The first account you create becomes the admin.

```bash
npm test          # 196 tests
npm run typecheck
npm run build
```

### Where the database goes

Point `DATABASE_URL` somewhere **outside** Dropbox, OneDrive, iCloud or Google
Drive. Two machines syncing one SQLite file will corrupt it — this is a property
of file sync, not a GeneNet bug. Startup checks the path and warns you.

To share a database between people, run one instance on one machine and have
everyone point a browser at it. Back it up: GeneNet takes an hourly `VACUUM INTO`
snapshot and keeps the last 14.

## Before you rely on it

Worth saying plainly, because the alternative is you finding out later:

- **No upgrade path yet.** Schema changes may need a manual migration.
- **Audit trail, not a validated system.** The record-keeping is built along
  21 CFR Part 11 lines — attribution, tamper-evident signatures, no silent
  edits. That is a foundation for a validated deployment, not a substitute for
  one. Validation is something *you* perform against *your* SOPs, and no
  software can hand it to you off the shelf.
- **Off-target search is local.** CRISPR off-targets are found within the
  sequence you loaded. For a genome-wide search, use a genome-wide tool.
- **Single-server.** SQLite in WAL mode, one Next.js process. It suits a lab.
  It is not built for a multi-tenant deployment.

## Contributing

Issues and pull requests are welcome. `npm test && npm run typecheck` should
pass; CI runs both plus a build against a real database.

The code aims to explain its reasoning where the reasoning is not obvious —
see `src/lib/api-auth.ts` or `src/lib/crispr.ts` for the register. Comments
explain *why*, not *what*.

## Licence

[AGPL-3.0](LICENSE). You may run, study, modify and share it freely.

The one condition worth understanding: if you offer a modified GeneNet to
others over a network, you must offer them your modifications too. Running it
for your own lab — modified or not — triggers nothing. This is deliberate. It
keeps a hosted fork from becoming the version everyone uses while the shared
one withers.

GeneNet is free, and funded by support and hosting for labs that want it rather
than by charging per seat.
