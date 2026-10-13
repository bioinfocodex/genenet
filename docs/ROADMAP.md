# GeneNet roadmap: SnapGene and Benchling, phase by phase

GeneNet already does most of what both products do. This document lists what
is left, in the order it is worth building, and the concrete steps for each
phase. It was written on 2026-10-13 against the `mutagenesis-primers` branch
(PRs #1–#7, all green in CI).

Each phase is sized to ship as a short stack of reviewable PRs, follows the
house rules (pure logic in `src/lib/` with tests, schema changes additive and
applied with `prisma db push` after a backup), and ends with a browser check on
a scratch database before it is called done.

---

## Where GeneNet stands

### SnapGene side: covered
- Circular, linear and sequence views; features coloured and named by purpose;
  virtualised sequence view; editing in place with features moving to match.
- 570 REBASE enzymes, enzyme sets, Dam/Dcm blocking warnings tied to the
  recorded host strain.
- Cloning simulation with real product sequences: restriction, Gibson,
  In-Fusion, NEBuilder, Golden Gate (with overhang checks), Gateway BP/LR,
  TA / TOPO / directional TOPO. Method-specific primer design.
- Construct lineage and edit history.
- Annotation (40 shipped features plus a library the lab teaches it).
- ORFs, translation, codon optimisation, silent mutagenesis, CRISPR guides.
- Pairwise alignment, guide-tree MSA, contig assembly, phylogeny, search the
  library by sequence.
- Sanger trace viewer with graded differences and mixed-peak detection.
- Site-directed mutagenesis primers (Q5 and QuikChange), amino-acid mode.
- Nearest-neighbour Tm with Mg²⁺ correction, one value everywhere.
- Import: GenBank, EMBL, GFF3, FASTA, FASTQ, .ab1, ApE, SnapGene .dna.
  Export: GenBank, FASTA, SnapGene .dna, SVG/PNG maps.

### Benchling side: covered
- Lab-defined record types with typed fields and codes (registry).
- Samples, freezers, collections; microplates with transfers.
- Structured assay results; notebook entries with signing, witnessing and
  corrections; procedures with versions; projects, tasks, reports.
- Per-project permissions, full audit trail, e-signatures, REST API with
  tokens, backups.
- Lab-wide oligo collection with library-wide binding search.

### The gaps, at a glance

| Area | Gap | Phase |
|---|---|---|
| Release | 7 open PRs; two schema changes not applied to the live database | 0 |
| Verification | Traces not saved; no multi-read view over one construct; primer binding exact-only | 1 |
| Reference content | 40 features vs thousands; no common-vector library; no standard primer set | 2 |
| Cloning | No blunting / fill-in / dephosphorylation / partial digest; no IVA, LIC, USER, MoClo standards; no graphical construct history | 3 |
| Output | No PDF/print; limited map styling; protein view thin | 4 |
| Registry & inventory | Sequences have no registry codes; samples have no quantity, volume, expiry, check-out or labels; no bulk CSV | 5 |
| Notebook & workflow | No entry templates; no embedded live objects; no comments/@mentions outside tasks; no requests or workflow stages | 6 |
| Analysis & integration | No dashboards over results; no webhooks; no instrument adapters; no remote BLAST | 7 |
| Scale | SQLite, one server; no real-time co-editing; no SSO | 8 |

---

## Phase 0 — Land what is built (days)

**Goal:** the seven open PRs merged and the live database in step.

1. Review and merge #1 → #7 in order. Each PR retargets to `main` when the one
   below it merges.
2. After #1 (host/strain columns) and #3 (`Oligo` table): back up from the
   app, preview with `npx prisma migrate diff`, apply with `npx prisma db push`.
3. Fix two small debts found on the way:
   - primers added optimistically in the viewer get a temporary id and cannot
     be deleted until reload — return the created row from `addPrimer` and
     swap the id in;
   - `saveConstruct` returns no feature count — have the mutagenesis and
     cloning panels say how many annotations came across.
4. Seed the oligo collection from the per-sequence primers already in the
   database (one-off script, duplicates by sequence skipped).

**Done when:** `main` contains all seven, the live database has the new
columns and table, and the debts above are closed.

---

## Phase 1 — Clone verification, end to end (1–2 weeks)

**Goal:** a sequencing order goes from trace files to a recorded verdict on the
construct, the way SnapGene and Benchling's sequence-verification tools do.

**Gaps:** traces vanish when the page closes; each read is viewed alone; a
primer with a mismatch is not placed at all.

1. **Persist traces.** `SequencingRead` model: sequence id, file name, sample
   name, run date, the .ab1 bytes (or a path under the data directory), and the
   computed verdict. Upload from the Sanger tab stores them; the tab lists the
   saved reads on open.
2. **Many reads, one construct.** A coverage track under the map showing every
   saved read's span, coloured by verdict, and a stacked trace view at any
   position (reuse `verifyTrace` per read; draw lanes in `TracePanel`).
   Consensus per position, with disagreements between reads called out.
3. **Verification record.** "Mark this construct verified" writes a signed
   record (existing `Signature` table) naming the reads, the region covered,
   and any accepted differences — so a plasmid's page says whether it has been
   sequence-confirmed and by whom.
4. **Mismatch-tolerant primer binding.** Extend `findBindings` with an option to
   allow up to N mismatches outside the last 3–5 bases of the 3′ end, scored
   by position. Use it on the map (dashed for imperfect sites) and in PCR
   simulation, so mutagenic and degenerate primers show where they anneal.

**Tests:** persistence round-trip; consensus with two agreeing and one
dissenting read; mismatch binding never accepts a 3′-end mismatch.

**Done when:** a set of reads uploaded once is still there tomorrow, coverage
and consensus are visible on the map, and a construct can be signed off as
verified.

---

## Phase 2 — Reference content (1–2 weeks, mostly curation)

**Goal:** a new plasmid opens fully annotated, and the vectors and primers a
lab uses every day are already in the system.

**Gaps:** 40 features against SnapGene's thousands; no vector library; no
standard primer set.

1. **Feature library expansion.** Grow `features.data.ts` from published,
   invariant parts only — promoters, terminators, origins, resistance genes,
   tags, recombinase sites — each with its source recorded. Keep the existing
   rule: a part is added only if its sequence is a published standard, never
   reconstructed. Target the few hundred that cover nearly all common vectors.
2. **Common vector library.** A curated list of accession numbers for widely
   used vectors (pUC19, pET series, pcDNA3.1, pGEX, pBAD, lentiviral backbones,
   pDONR/pDEST), fetched through the existing NCBI accession import into a
   read-only "Reference vectors" collection. Ship the accession list, not the
   sequences, to keep licensing clean.
3. **Standard primers.** Seed the oligo collection with universal primers (M13
   F/R, T7, T7 term, SP6, CMV-F, BGH-R, pGEX 5′/3′, …) marked as reference so
   they show on every map they anneal to.
4. **Annotation report.** After auto-annotation, list features found, partial
   matches (with percent identity), and stretches with nothing recognised.

**Done when:** importing pUC19 and pET-28a from GenBank, stripped of features,
re-annotates them with their standard map, and M13/T7 primers appear on both.

---

## Phase 3 — Cloning completeness (2–3 weeks)

**Goal:** any route a molecular biologist takes on paper can be simulated,
step by step, and the construct remembers each step.

**Gaps:** end modification (blunting, fill-in, chew-back, dephosphorylation),
partial digests, several homology/assembly methods, and a graphical history.

1. **Fragment workbench.** A panel holding fragments with real ends (the
   assembly engine already models ends). Operations: digest (complete or
   partial), fill-in (Klenow), chew-back (T4 polymerase), dephosphorylate,
   phosphorylate, anneal oligos, ligate any compatible set. Each operation is a
   pure function in `src/lib/fragments.ts` with tests on the resulting ends.
2. **More methods.** IVA and SLiCE (homology, no enzyme mix), LIC (T4
   chew-back to defined overhangs), USER (uracil excision), and MoClo /
   GoldenBraid part standards with their fixed overhang sets validated.
3. **History graph.** Draw `SequenceLineage` as a tree of steps (fragment,
   operation, product), each node openable, like SnapGene's history view. The
   edges already exist; this is a view plus the operation recorded per edge.
4. **PCR realism.** Simulate with mismatch-tolerant binding from Phase 1: show
   every product a primer pair makes, not only the intended one.

**Done when:** a construct built by digest → fill-in → blunt ligation → Gibson
shows each step in its history graph, and every intermediate opens as a map.

---

## Phase 4 — Maps, figures and proteins (1–2 weeks)

**Goal:** figures go straight into a paper or a slide; proteins get the same
care as DNA.

1. **Publication output.** PDF and print for maps and sequence views (vector,
   not screenshots). Page setup, title block, legend.
2. **Map styling.** Per-feature arrow/box style, label text and placement,
   show/hide by type, line widths, saved as a map style on the sequence.
3. **Protein view.** Protein records get domains/features, MW/pI along the
   sequence, hydropathy plot, and protein MSA (the aligner already handles
   amino acids). Link CDS → protein both ways.
4. **Remote BLAST.** Submit a selection to NCBI BLAST and show hits, with the
   request made from the server and rate-limited.

**Done when:** a map can be exported to PDF with custom labels, and a CDS opens
its protein with features carried over.

---

## Phase 5 — Registry and inventory (2–3 weeks)

**Goal:** every physical and digital thing in the lab has an ID, a place and a
quantity, the way Benchling's registry and inventory work.

**Gaps:** sequences have no registry code; samples carry no quantity, volume,
concentration or expiry, cannot be checked out, and cannot print labels; nothing
imports in bulk except oligos.

1. **Codes for sequences.** Add a nullable `code` to `GeneSequence` (e.g.
   PL-001 for plasmids, GN-001 for genes), issued with `nextCode` like
   entities and oligos. Backfill existing rows once.
2. **Containers and quantities.** Add amount, unit, concentration, expiry and
   lot to `Sample`; record each use (who, how much, when) in a `SampleUse`
   table so the remaining amount is computed, not typed.
3. **Check-out / check-in.** A sample can be held by a person with a due date;
   the freezer view shows what is out.
4. **Barcodes and labels.** Code 128 / Data Matrix on sample, plate and oligo
   pages; label sheets for common label stock (PDF) and ZPL for Zebra
   printers. The search bar already treats an exact code as a scan.
5. **Bulk CSV.** Import and export for samples, entities, sequences (FASTA /
   GenBank zip) and oligos, with a dry-run preview that shows what will be
   created, updated or rejected, line by line.

**Done when:** a box of 81 tubes can be imported from a spreadsheet, labelled,
scanned back, and drawn down by use until the system says it is empty.

---

## Phase 6 — Notebook and workflow (2–3 weeks)

**Goal:** the notebook is where work is recorded, with live links into
everything else, and work can be handed between people.

**Gaps:** entries are plain Markdown; no templates; no embedded objects; no
comments outside tasks; no requests or stages.

1. **Entry templates.** Templates per project or procedure (headings, tables,
   required fields), chosen when an entry is created.
2. **Embedded live objects.** `@`-insert a sequence, sample, plate, result or
   oligo into an entry; it renders as a live card (map thumbnail, well grid,
   values) and is recorded in `NotebookLink`. Signing captures the state of
   embedded objects into the content hash, so a signature still means what it
   meant.
3. **Comments and mentions** on any record, reusing the task comment model,
   with notifications.
4. **Requests.** A request type (e.g. "sequence these clones", "make this
   construct") with a form, a queue, an assignee, statuses and the samples
   attached — the core of Benchling's request workflow.
5. **Workflow stages.** A project can define ordered stages (design → clone →
   verify → express), and records move through them with a board view.

**Done when:** a scientist can request sequencing for four clones, a core
member works the request from a queue, and the results land in a signed
notebook entry that embeds the reads and the verified construct.

---

## Phase 7 — Analysis and integration (2 weeks)

**Goal:** results become charts without exporting to Excel, and other systems
can listen to GeneNet.

1. **Dashboards.** Charts over structured results (time series, dose response,
   plate heatmaps) built from `AssayResult` fields; saved per project.
2. **Webhooks.** Outgoing events (record created, signed, sample used, request
   status changed) with signed payloads and retry, configured by admins.
3. **Instrument adapters.** Parsers for common exports — plate readers (CSV),
   NanoDrop, qPCR (Cq tables) — mapping into result schemas with a preview.
4. **API completeness.** Cover oligos, reads, requests and plates in `/api/v1`,
   and publish a small Python client.

**Done when:** a plate-reader export is imported into a result schema, charted
on a dashboard, and a webhook fires to a test endpoint.

---

## Phase 8 — Scale and collaboration (as needed)

**Goal:** many people, many sites, at the same time.

1. **Postgres option.** The README already documents the move; make it a
   tested deployment path, with CI running the suite against both databases.
2. **Real-time co-editing** for notebook entries and sequence annotations
   (CRDT or server-ordered operations), with presence indicators.
3. **SSO** (OIDC/SAML) alongside local accounts.
4. **Validation package.** IQ/OQ scripts and documentation a regulated lab
   needs to validate a deployment (Part 11 is already designed for; this
   makes it provable).

---

## Suggested order and checkpoints

| Phase | Depends on | Checkpoint |
|---|---|---|
| 0 Land PRs | — | `main` has #1–#7; database in step |
| 1 Verification | 0 | Reads saved; construct signed off as verified |
| 2 Reference content | 0 | pUC19 / pET re-annotate; universal primers on maps |
| 3 Cloning | 1 (mismatch binding) | Multi-step construct with history graph |
| 4 Output & proteins | 2 | PDF map; CDS ↔ protein |
| 5 Registry & inventory | 0 | 81-tube box imported, labelled, drawn down |
| 6 Notebook & workflow | 5 | Request → queue → signed entry with embeds |
| 7 Analysis & integration | 5, 6 | Plate import → dashboard → webhook |
| 8 Scale | any | Postgres CI; SSO |

Phases 1–4 close the SnapGene gap; 5–7 close the Benchling gap; 8 is for when
GeneNet outgrows one server. Phases 2 and 5 can run in parallel with the
others, since one is mostly curation and the other mostly schema and forms.
