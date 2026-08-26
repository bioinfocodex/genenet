"""
BioEngine – core bioinformatics logic for the GeneNet lab platform.

Requires:
    pip install biopython
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from Bio.Seq import Seq
from Bio.SeqUtils.MeltingTemp import Tm_NN, salt_correction
from Bio.Restriction import RestrictionBatch, Analysis


# ─── Session state ────────────────────────────────────────────────────────────

@dataclass
class Session:
    """Global mutable session that BioEngine methods update in place."""
    sequence: str = ""
    ligated_parts: list[str] = field(default_factory=list)
    ligated_sequence: str = ""

    def update_sequence(self, seq: str) -> None:
        self.sequence = seq.upper().strip()

    def clear_ligation(self) -> None:
        self.ligated_parts = []
        self.ligated_sequence = ""


# Singleton session (replace with a proper store in production)
_SESSION = Session()


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ORF:
    frame: int          # +1, +2, +3, -1, -2, -3
    start: int          # 1-indexed, inclusive, on the returned strand
    end: int            # 1-indexed, inclusive, on the returned strand
    length_nt: int
    protein: str

@dataclass
class CutSite:
    enzyme: str
    position: int       # 1-indexed cut position


@dataclass
class LigationResult:
    parts: list[str]
    sequence: str
    size: int


# ─── BioEngine ────────────────────────────────────────────────────────────────

class BioEngine:
    """
    Stateless helper methods that operate on DNA strings.
    Methods that update session state accept / return a Session object.
    """

    # ── 1. Melting temperature ────────────────────────────────────────────────

    @staticmethod
    def get_tm(
        primer: str,
        Na: float = 50.0,
        Mg: float = 0.0,
        dnac1: float = 250.0,
        dnac2: float = 250.0,
    ) -> float:
        """
        Return the nearest-neighbour melting temperature (°C) for *primer*
        with monovalent salt correction.

        Parameters
        ----------
        primer : str
            5'→3' primer sequence (ACGT only).
        Na : float
            [Na+] in mM (default 50 mM).
        Mg : float
            [Mg2+] in mM (default 0 mM – ignored when Na is given).
        dnac1 : float
            Concentration of the primer strand in nM (default 250 nM).
        dnac2 : float
            Concentration of the complementary strand in nM (default 250 nM).
        """
        seq = primer.upper().replace(" ", "")
        if not seq:
            raise ValueError("Primer sequence is empty.")
        if re.search(r"[^ACGT]", seq):
            raise ValueError(f"Primer contains non-ACGT characters: {seq!r}")

        tm = Tm_NN(
            Seq(seq),
            Na=Na,
            Mg=Mg,
            dnac1=dnac1,
            dnac2=dnac2,
            saltcorr=5,   # Owczarzy 2004 unified salt correction
        )
        return round(tm, 2)

    # ── 2. 6-frame ORF scanner ────────────────────────────────────────────────

    @staticmethod
    def find_orfs(
        dna: str,
        min_aa: int = 30,
    ) -> list[ORF]:
        """
        Scan all 6 reading frames and return a list of ORF objects.

        An ORF starts at the first in-frame ATG and ends at the first
        in-frame stop codon (TAA / TAG / TGA).  The stop codon itself
        is NOT included in the returned protein sequence but IS included
        in *end* (for the nt coordinates).

        Parameters
        ----------
        dna : str
            Template DNA sequence (ACGT, any case).
        min_aa : int
            Minimum ORF length in amino acids (default 30).
        """
        dna = dna.upper().strip()
        seq = Seq(dna)
        rc_seq = seq.reverse_complement()
        length = len(dna)
        orfs: list[ORF] = []

        def _scan(template: Seq, strand: int) -> None:
            for frame in range(3):
                i = frame
                while i < len(template) - 2:
                    codon = str(template[i:i + 3])
                    if codon == "ATG":
                        # Found a start — walk forward to the next stop
                        protein_codons: list[str] = []
                        j = i
                        while j < len(template) - 2:
                            triplet = str(template[j:j + 3])
                            if triplet in ("TAA", "TAG", "TGA"):
                                # Complete ORF found
                                if len(protein_codons) >= min_aa:
                                    protein = str(Seq("".join(protein_codons)).translate())
                                    orf_len_nt = (j + 3) - i
                                    if strand == 1:
                                        orf_start = i + 1
                                        orf_end = j + 3
                                    else:
                                        # Map rc coordinates back to forward strand
                                        orf_start = length - (j + 3) + 1
                                        orf_end = length - i
                                    orfs.append(ORF(
                                        frame=strand * (frame + 1),
                                        start=orf_start,
                                        end=orf_end,
                                        length_nt=orf_len_nt,
                                        protein=protein,
                                    ))
                                # Advance past the stop codon
                                i = j + 3
                                break
                            protein_codons.append(triplet)
                            j += 3
                        else:
                            # No stop codon found — partial ORF; skip
                            i += 3
                    else:
                        i += 3

        _scan(seq, strand=1)
        _scan(rc_seq, strand=-1)

        orfs.sort(key=lambda o: o.start)
        return orfs

    # ── 3. Unique cutters within a range ─────────────────────────────────────

    @staticmethod
    def unique_cutters(
        dna: str,
        start: int = 1,
        end: Optional[int] = None,
    ) -> list[CutSite]:
        """
        Find restriction enzymes that cut *exactly once* within
        ``dna[start-1 : end]`` (1-indexed, inclusive).

        Uses the full ``Bio.Restriction`` commercial enzyme database.

        Parameters
        ----------
        dna : str
            Full DNA sequence.
        start : int
            1-indexed start of the region of interest (default 1).
        end : int | None
            1-indexed end of the region (default: end of sequence).
        """
        dna = dna.upper().strip()
        if end is None:
            end = len(dna)

        region = dna[start - 1 : end]
        if not region:
            raise ValueError(f"Invalid range [{start}, {end}] for sequence of length {len(dna)}.")

        rb = RestrictionBatch(first=[], suppliers=["N"])   # NEB supplier = large commercial set
        analysis = Analysis(rb, Seq(region), linear=True)
        results = analysis.full()

        sites: list[CutSite] = []
        for enzyme, positions in results.items():
            if len(positions) == 1:
                # positions are 1-indexed within *region*; offset back to full seq
                sites.append(CutSite(
                    enzyme=str(enzyme),
                    position=positions[0] + (start - 1),
                ))

        sites.sort(key=lambda s: s.position)
        return sites

    # ── 4. Ligation ───────────────────────────────────────────────────────────

    @staticmethod
    def ligate(
        parts: list[str],
        session: Session,
        *,
        validate_overhangs: bool = False,
    ) -> LigationResult:
        """
        Join *parts* end-to-end and update *session* with the result.

        When ``validate_overhangs=True`` the function checks that each
        adjacent pair shares a compatible 4-nt sticky end (e.g. for
        Golden Gate / restriction-ligation assemblies).  A ``ValueError``
        is raised on mismatch.

        Parameters
        ----------
        parts : list[str]
            Ordered list of DNA fragment sequences to ligate.
        session : Session
            The global session object to update in place.
        validate_overhangs : bool
            If True, verify 4-nt overhang compatibility between parts.
        """
        if not parts:
            raise ValueError("Nothing to ligate: parts list is empty.")

        cleaned = [p.upper().strip() for p in parts]
        for i, part in enumerate(cleaned):
            if not part:
                raise ValueError(f"Part {i + 1} is an empty sequence.")
            if re.search(r"[^ACGT]", part):
                raise ValueError(f"Part {i + 1} contains non-ACGT characters.")

        if validate_overhangs:
            OVERHANG_LEN = 4
            for i in range(len(cleaned) - 1):
                left_end = cleaned[i][-OVERHANG_LEN:]
                right_start = cleaned[i + 1][:OVERHANG_LEN]
                if left_end != right_start:
                    raise ValueError(
                        f"Overhang mismatch between part {i + 1} and part {i + 2}: "
                        f"3′ end {left_end!r} ≠ 5′ start {right_start!r}"
                    )
                # Trim the shared overhang from the right fragment to avoid duplication
                cleaned[i + 1] = cleaned[i + 1][OVERHANG_LEN:]

        ligated = "".join(cleaned)

        # Update session
        session.ligated_parts = list(parts)
        session.ligated_sequence = ligated
        session.update_sequence(ligated)

        return LigationResult(
            parts=list(parts),
            sequence=ligated,
            size=len(ligated),
        )


# ─── Module-level convenience wrappers (use the singleton session) ────────────

def get_tm(primer: str, **kwargs) -> float:
    return BioEngine.get_tm(primer, **kwargs)


def find_orfs(dna: str, min_aa: int = 30) -> list[ORF]:
    return BioEngine.find_orfs(dna, min_aa=min_aa)


def unique_cutters(dna: str, start: int = 1, end: Optional[int] = None) -> list[CutSite]:
    return BioEngine.unique_cutters(dna, start=start, end=end)


def ligate(parts: list[str], *, validate_overhangs: bool = False) -> LigationResult:
    return BioEngine.ligate(parts, _SESSION, validate_overhangs=validate_overhangs)


def get_session() -> Session:
    return _SESSION


# ─── Quick smoke-test ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    engine = BioEngine()

    # 1. Tm
    primer = "ATGCGTACGCTAGCTACGATCG"
    tm = engine.get_tm(primer)
    print(f"Tm({primer}) = {tm} °C")

    # 2. ORFs
    test_dna = (
        "ATGAAACCCGGGTTTTAA"   # frame+1 ORF: MKP(G)F*   6aa – too short
        "ATGGCTTTTGCTTTTGCTTTTGCTTTTGCTTTTGCTTTTGCTTTTGCTTTTGCTTAA"  # 18aa
    )
    orfs = engine.find_orfs(test_dna, min_aa=10)
    for o in orfs:
        print(f"ORF frame{o.frame:+d}  {o.start}–{o.end}  {o.length_nt}nt  {o.protein}")

    # 3. Unique cutters
    puc19_fragment = (
        "GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCT"
    )
    cuts = engine.unique_cutters(puc19_fragment)
    print(f"\nUnique cutters ({len(cuts)}):")
    for c in cuts:
        print(f"  {c.enzyme:20s}  pos {c.position}")

    # 4. Ligation
    result = ligate(["ATGCCC", "GGGAAA", "TTTGCA"])
    print(f"\nLigation: {result.sequence}  ({result.size} bp)")
    print(f"Session: {get_session().ligated_sequence}")
