# Getting data in and out

A second gap analysis against SnapGene and Benchling, this time about
interoperability rather than drawing. The first one
([SNAPGENE-GAPS.md](SNAPGENE-GAPS.md)) asked what the maps cannot show. This
one asks what a lab cannot bring with them.

## What reverse engineering could and could not reach

Worth stating plainly, because the honest answer shaped the rest.

**Benchling cannot be reverse engineered here, and should not be.** It is a
hosted application with no artefact on this machine. The only thing REA could
observe is a browser tab somebody is already signed into, which would show
that person's own workspace rather than anything about how Benchling is
built. Its gaps have to come from its documentation and its interface, which
is where the ones below come from.

**SnapGene is installed**, so its binary could be opened. It was not, beyond
confirming it exists. Taking apart a competitor's program to copy how it
implements a feature is not interoperability; it is lifting protected work,
and the feature list is published anyway. What is legitimate -- and what this
document is about -- is its *file format*, so that files a lab already owns
can be read.

That turned out not to need decompiling either. Biopython ships a documented
reader for the format, and it is already installed on this machine. Reading
an open-source parser is faster than inferring the same thing from compiled
code, and it is authoritative in a way that inference is not.

## The format, as verified

The `.dna` file is a sequence of packets: one type byte, a four-byte
big-endian length, then that many bytes.

| type | holds |
|---|---|
| `0x09` | the cookie that must come first: the string `SnapGene`, then type and version words |
| `0x00` | the bases, behind a flags byte whose low bit means circular |
| `0x0A` | the features, as XML, with ranges, strand and `Segment` elements for spliced ones |
| `0x05` | the primers, as XML |
| `0x06` | the notes, as XML |

Confirmed on a real file rather than from the description: the Addgene
plasmid in Downloads reads as **4,791 bp, circular, with 32 features** --
twenty primer binding sites, six CDSs, two terminators, two promoters, an
origin and a misc feature. All of that is data GeneNet has a column for.

## The gap, corrected

The first version of this document said GeneNet cannot open a SnapGene file
at all. That was wrong, and wrong in a way worth recording, because the
mistake was made by reading the import control instead of the code behind it.

A reader exists (`src/lib/snapgene.ts`), a writer exists
(`src/lib/formats/snapgene-write.ts`), both are wired into the import action
and the export route, and both were tested. What was actually wrong was
narrower, worse, and only visible from outside:

**The reader had never read a file SnapGene wrote.** Every test built a `.dna`
file and read it back, which proves the reader agrees with itself. Against
real Addgene plasmids, checked with BioPython's independent reader: eighteen
features where we found thirty-two, forty-three where we found seventy-seven.
Every extra one a primer binding site SnapGene does not show, every primer
one base to the left of where SnapGene draws it, and every reverse primer
pointing forwards -- because the attribute is `boundStrand` and we read
`strand`, which no real file contains.

**The writer had never written a file anyone else read.** Handing one to
BioPython raised rather than parsing: SnapGene writes `2025.12.15` and we
wrote `2026-11-11`. Every file this codebase had ever produced was unreadable
by an independent reader because of a punctuation mark, and no test could
have caught it, since our own reader never looks at the date.

**And none of it was reachable.** The file picker's `accept` attribute was a
fourth list of formats, shorter than the parsers, shorter than the drop-zone
hint and shorter than the error message naming the supported formats -- so a
`.dna` file was greyed out in the dialog and the message that would have said
it was supported never ran.

The lesson generalises past this format: a parser tested only against its own
output is untested, and a feature is only as reachable as the narrowest list
that mentions it.

## What Benchling still has that we do not

From its documentation and interface, not from its code. Lower confidence
than the format work above, and worth checking against a live account before
anybody builds from it.

Most of the Benchling gap is already closed -- the registry, the notebook,
requests and workflows, the API and its Python client, webhooks, single
sign-on and the audit trail all exist. What remains:

**Custom entity schemas.** Benchling lets an organisation define its own
entity types with their own fields and validation -- a construct here has a
vector and an insert, a strain has a genotype and a parent. We have fixed
tables with fixed columns. This is the largest remaining difference and the
one a big lab notices first.

**Registration rules.** Naming schemes and identifier formats that the
registry enforces on entry, rather than a code issued after the fact.

**Granular permissions.** `ProjectMember` exists, but access decisions are
mostly admin-or-not. Benchling has per-project and per-folder roles.

## The phases

Ordered by how many people each one unblocks per week of work.

### Phase 1 — Read SnapGene files ✓ done

Not written from nothing: checked against two real Addgene plasmids with
BioPython as the authority, and fixed until the feature table matched it
exactly. The fixture is SnapGene's own bytes. The format list is now one list
rather than four.

### Phase 2 — Write SnapGene files ✓ done

The round trip starts from a file SnapGene wrote rather than one we wrote, so
a difference is a difference from the real thing. Verified through the whole
circuit in the running app: Addgene's file imports, is stored, is exported by
the real export route, and BioPython reads that export as the same eighteen
features at the same coordinates and strands it read from Addgene's original.

What that does not show, since it is worth being exact: that SnapGene itself
opens the file. It shows an independent implementation of the format accepts
it and sees what SnapGene put there.

### Phase 3 — Custom entity schemas ✓ already built

Also wrong in the first version of this document. `EntityType`, `FieldDef`,
`Entity` and `FieldValue` exist, with a typed-field engine, validation, link
fields, per-type prefixes and an admin builder -- and values in typed columns
rather than a JSON blob, so that a custom field is something you can query
rather than something you can only read.

What was wrong with it was the registry underneath. A code is read off the
records that exist and then written, so two people registering in the same
second both get the same number and the second one receives the database's
own error where the confirmation should be. Measured: three at once gave two
records and one raw error. Fixed, with the same read-then-write found and
fixed everywhere else it issues a code.

Naming and identifier rules beyond a per-type prefix remain unbuilt: Benchling
lets an organisation define the shape of an identifier, where we offer
`PREFIX-001`. That is the real remaining piece of this phase.

### Phase 4 — Permissions worth the name

Per-project and per-folder roles rather than admin-or-not. Smaller than
Phase 3 and dependent on nothing in it, so it can be taken whenever a
multi-group installation needs it.

## How to tell whether it worked

| | before | now |
|---|---|---|
| a real SnapGene file | greyed out in the picker | opens, matching BioPython exactly |
| primers in an imported plasmid | several times too many, all forward, one base left | what SnapGene shows |
| a file we export | an independent reader raised on it | read correctly |
| a feature's colour | repainted from its type | the one the lab chose |
| two people registering at once | one loses their record to a Prisma error | both registered |
| identifier format | `PREFIX-001` | `PREFIX-001` — still to do |
| who can see a project | admin, or everyone | admin, or everyone — Phase 4 |

## What this does not cover

The drawing gaps are in [SNAPGENE-GAPS.md](SNAPGENE-GAPS.md) and the layout
work in [UI-REDESIGN.md](UI-REDESIGN.md). The minimap is the one item still
open there.
