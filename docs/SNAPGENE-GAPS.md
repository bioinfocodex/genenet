# What SnapGene draws that we do not

A gap analysis of DNA visualisation — the circular map, the linear map and
the sequence view — against SnapGene, and a plan to close it.

Written by reading the code and driving the running app, not from memory.
Several things I expected to be missing turned out to be there, and they are
listed too, because a plan that proposes rebuilding what already works is
worse than no plan.

## What we already have

Checked in the running application on a 4,927 bp plasmid.

**Circular map.** Features as arrows with labels, restriction sites with
enzyme names and cut counts, primers, open reading frames, a GC-content ring
drawn as a deviation from the mean, a selection arc, zoom in/out/fit, and
export to SVG and PNG.

**Linear map.** The same layers, with zoom and horizontal scrolling, and the
three-dot ends that mark a circular molecule shown linearly.

**Sequence view.** This is the one I was wrong about. It already draws
**both strands**, 5′ above and 3′ below, with per-base colouring, position
numbers every ten bases, restriction sites highlighted with separate top and
bottom cut bars — so an overhang reads as an overhang — all six reading
frames on demand, layer toggles for features, enzymes, primers and ORFs,
fit-to-width, click-and-drag selection, and in-place editing with a caret.

**Selection.** Dragging reports length, melting temperature and GC content.

**Enzyme choice.** All, unique cutters, common six-cutters, Golden Gate, or
named enzymes, with minimum recognition length and maximum cut count. Named
enzymes outrank the filters, which is the right way round.

**Feature visibility.** By type, by individual feature, and by a minimum
length that hides the short clutter.

That is most of SnapGene's map. The gaps are narrower than they look, and
they cluster.

## The gaps

Ordered by how often a working scientist would hit them.

### 1. Find does nothing

The Find button exists in the sequence view and opens a panel. `onFind` has
an empty body, and `onReplace` computes the replacement, throws it away and
shows an alert saying it was not applied.

This is the largest gap by a distance. Searching a sequence for a motif,
a primer, a restriction site that the enzyme list does not carry, is one of
the three things anybody does in a sequence view, and it is the only one of
the three that does not work. SnapGene has it on Ctrl+F with the matches
highlighted in place and a count.

### 2. No coordinates on the map

SnapGene has a Show Locations toggle that puts the base position next to each
restriction site and primer on the map. We draw the enzyme name and its cut
count — `EcoRV +1` — but never the position. Reading a position off our map
means finding the site again in the sequence view.

### 3. Nothing can be extracted from a selection

SnapGene's File → New File from Selection makes a new sequence from the
selected range, and asks whether to keep the original numbering or restart at
1. We can copy the bases to the clipboard and nothing else: no new record, no
features carried over, no choice about numbering.

### 4. Copy has two of its six forms

We have Copy Sequence and Copy Reverse Complement. SnapGene also copies the
bottom strand in either orientation, and the amino acids of a selection in
one-letter or three-letter form. The protein ones matter most: reading a
translation off the screen and retyping it is how transcription errors get
into an order form.

### 5. The circular map has no origin control

A plasmid map's origin is a presentation choice — people rotate a map so the
promoter is at twelve o'clock before putting it in a paper, and SnapGene
lets them. Ours always starts at the top of whatever the file says is base 1.
There is no rotate, and no "linearise here".

### 6. No minimap

SnapGene offers a minimap for a long sequence: a whole-molecule strip showing
where the scrolled view sits. On a 250 kb record our sequence view gives no
sense of place at all.

### 7. The view cannot be flipped

SnapGene's View → Flip shows the reverse complement of the whole record, with
the features coming along. Checking an insert that went in backwards means
reading our map backwards in your head.

### 8. Features sit below the line, always

SnapGene has a "show features on line" choice. Ours draws them in tracks
below. This is small, but it is the difference between a map that fits a
figure column and one that does not.

### 9. ORF options are partial

We have a minimum length and an "include annotated" toggle. SnapGene also
offers whether a start codon is required and whether to include ORFs
truncated by the end of a linear sequence. Both change what the panel claims
is there.

### 10. No split view

SnapGene can show two views of one record at once — map above, sequence
below. We switch between them. Lower priority than the rest, and the most
work.

### Not worth copying

**Secondary-structure prediction** for single-stranded sequences. It is a
real SnapGene feature and it is a different piece of software — a folding
algorithm, not a drawing. If it is wanted it should be its own project, not
a line in a visualisation plan.

## The plan

Four phases, ordered by value per unit of work, each shippable alone.

### Phase A — Make Find work

Search the sequence for a motif, with IUPAC ambiguity codes, both strands,
and matches highlighted in place with a count and next/previous. Then
Replace, which is the same search plus an edit through the path the editor
already uses so that undo and the dirty flag keep working.

The search itself is pure logic and belongs in `src/lib/`, tested against the
cases that catch these: a motif crossing the origin of a circular sequence,
an ambiguity code matching more than it should, a replacement that changes
length underneath a feature's coordinates.

**Why first:** it is the only gap where a control exists and lies.

### Phase B — Coordinates, copying, and extracting

The three clipboard and readout gaps together, because they are all the same
shape — take a selection, give back something true about it:

- positions next to sites and primers on both maps, as a toggle that lives
  with the other map style settings and is remembered with them
- copy the bottom strand in either orientation; copy amino acids in one- and
  three-letter form
- extract a selection to a new sequence, carrying the features that fall
  inside it, asking whether to keep the numbering

**Why second:** small, independent, and each one removes a retyping step.

### Phase C — Orientation: origin and flip

Rotate the circular map to put any base at twelve o'clock, and flip the whole
record to its reverse complement with the features following. Both are
presentation state rather than edits to the sequence, so both belong in the
stored map style, and neither may touch the bases.

The trap here is coordinates: everything drawn is positioned from base 1, and
a flip changes what base 1 means on screen but not in the file. The
transform belongs in one function with tests, not spread through two
renderers.

**Why third:** real work, contained, and it is what a figure needs.

### Phase D — Minimap, features on the line, ORF options

The remaining smaller settings, plus the minimap for long records. Split view
is explicitly out: it is a layout change on the scale of the whole redesign
and should be judged on its own.

## How to tell whether it worked

Not by counting features. For each phase, the check is that a specific thing
somebody does stops needing a workaround:

| | today | after |
|---|---|---|
| find a motif | not possible in the app | highlighted in place, counted |
| read a site's position | switch to the sequence view and hunt | on the map |
| get a protein sequence | retype it off the screen | one copy command |
| take a region to a new record | copy bases, make a record, re-annotate | one command, features carried |
| put the promoter at the top | not possible | rotate |
| check an inverted insert | read the map backwards | flip |

## What this does not cover

The map's own control stack — the export row, the enzyme row, the zoom row —
is still about 193px of height above the drawing, and folding it into the
icon rail is unfinished business from the layout work rather than a gap
against SnapGene. It is tracked in [UI-REDESIGN.md](UI-REDESIGN.md).
