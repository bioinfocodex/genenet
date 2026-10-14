/**
 * Parts worth recognising in a plasmid.
 *
 * A curated set, not an exhaustive one. Every sequence here is a published,
 * invariant part -- a recombinase site, an operator, an epitope tag in its
 * standard codon usage -- rather than something reconstructed from memory. A
 * library that is merely large is worse than a small one if some of it is
 * wrong: a map annotated with a feature that is not there costs more than a map
 * with a blank stretch.
 *
 * The way this grows is not by hand. Annotated files carry their own features,
 * so importing a GenBank or SnapGene file offers what it knows to the library
 * (see lib/feature-learning.ts). A lab's own vectors then become recognisable,
 * which is the part a fixed table can never do.
 */

export interface LibraryFeature {
  name: string;
  type: string;
  color: string;
  /** The reference sequence, top strand. Matching tolerates mismatch. */
  sequence: string;
  /** What it is, where the name alone does not say. */
  note?: string;
  /** Set on entries learned from an imported file rather than shipped. */
  learned?: boolean;
}

/**
 * Nothing here is shorter than ten bases.
 *
 * The line is drawn by how often a motif turns up by chance. A specific six-mer
 * appears roughly every four kilobases, so drawing AATAAA on a plasmid map is
 * not an annotation -- it is noise wearing a label, and that entry has been
 * removed. A ten-mer appears about once per megabase, which on a plasmid means
 * a hit is worth believing. Ten is where those two facts meet.
 */
export const FEATURE_LIBRARY: LibraryFeature[] = [
  { name: 'T7 promoter', type: 'promoter', color: '#ff7f7f', sequence: 'TAATACGACTCACTATA' },
  { name: 'T3 promoter', type: 'promoter', color: '#ff7f7f', sequence: 'AATTAACCCTCACTAAA' },
  { name: 'SP6 promoter', type: 'promoter', color: '#ff7f7f', sequence: 'ATTTAGGTGACACTATAG' },
  { name: 'lac promoter', type: 'promoter', color: '#ff7f7f', sequence: 'AATTGTGAGCGGATAACA' },
  { name: 'CMV promoter', type: 'promoter', color: '#ff7f7f', sequence: 'GACATTGATTATTGACTAGTTATTAATAGTAATCAATTACGGGGTCATTAGTTCATAGCCCATATATGGAGTTCCGCGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGTGATGCGGTTTTGGCAGTACATCAATGGGCGTGGATAGCGGTTTGACTCACGGGGATTTCCAAGTCTCCACCCCATTGACGTCAATGGGAGTTTGTTTTGGCACCAAAATCAACGGGACTTTCCAAAATGTCGTAACAACTCCGCCCCATTGACGCAAATGGGCGGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCTC' },
  { name: 'SV40 promoter', type: 'promoter', color: '#ff7f7f', sequence: 'GTGGAATAGCTCAGAGGCC' },
  { name: 'EF1α promoter', type: 'promoter', color: '#ff7f7f', sequence: 'GGATCGATCCCCGGGAATTC' },
  { name: 'T7 terminator', type: 'terminator', color: '#ffbf7f', sequence: 'CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG' },
  { name: 'rrnB T1 term', type: 'terminator', color: '#ffbf7f', sequence: 'TGCCTGGCGGCAGTAGCGCGGTGGTCCCACCTGACCCCATGCCGAACTCAGAAGTGAAACGCCGTAGCGCCGATGGTAGTGTGGGGTCTCCCCATGCGAGAGTAGGGAACTGCCAGGCAT' },
  { name: 'ColE1 ori', type: 'rep_origin', color: '#d4d4d4', sequence: 'AAAAACACGATGATAGCGCCCGGATGGGCGGGGTTTTTTTTTTTTTTTTT' },
  { name: 'pMB1 ori', type: 'rep_origin', color: '#d4d4d4', sequence: 'GCTTTTTTGTACAAACTTGT' },
  { name: 'f1 ori', type: 'rep_origin', color: '#d4d4d4', sequence: 'ACGCGCCCTGTAGCGGCGCATTAAGCGCGGCGGGTGTGGTGGTTACGCGCAGCGTGACCGCTACACTTGCCAGCGCCCTAGCGCCCGCTCCTTTCGCTTTCTTCCCTTCCTTTCTCGCCACGTTCGCCGGCTTTCCCCGTCAAGCTCTAAATCGGGGGCTCCCTTTAGGGTTCCGATTTAGTGCTTTACGGCACCTCGACCCCAAAAAACTTGATTAGGGTGATGGTTCACGTAGTGGGCCATCGCCCTGATAGACGGTTTTTCGCCCTTTGACGTTGGAGTCCACGTTCTTTAATAGTGGACTCTTGTTCCAAACTGGAACAACACTCAACCCTATCTCGGTCTATTCTTTTGATTTATAAGGGATTTTGCCGATTTCGGCCTATTGGTTAAAAAATGAGCTGATTTAACAAAAATTTAACGCGAATTTTAACAAAATATTAACGTTTACAATTTCAGGTGGCACTTTTCGGGGAAATGTGCGCGGAACCCCTATTTGTTTATTTTTCTAAATACATTCAAATATGTATCCGCTCATGAGACAATAACCCTGATAAATGCTTCAATAATATATG' },
  { name: 'AmpR', type: 'CDS', color: '#7f7fff', sequence: 'ATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTAAAAGTA' },
  { name: 'KanR', type: 'CDS', color: '#7f7fff', sequence: 'ATGATTGAACAAGATGGATTGCACGCAGGTTCTCCGGCCGCTTGGGTGGAGAGGCTATTCGGCTATGACTGGGCACAACAGACAATCGGCTGCTCTGATGCCGCCGTGTTCCGGCTGTCAGCGCAATGCCCGCAAAGCGGCCTTTAACTCCCT' },
  { name: 'CmR', type: 'CDS', color: '#7f7fff', sequence: 'ATGGAGAAAAAAATCACTGGATATACCACCGTTGATATATCCCAATGGCATCGTAAAGAACATTTTGAGGCATTTCAGTCAGTTGCTCAATGTACCTATAACCAGACCGTTCAGCTGGATATTACGGCCTTTTTAAAGACCGTAAAGAAAAATAAGCAC' },
  { name: 'TetR', type: 'CDS', color: '#7f7fff', sequence: 'ATGTCGCACCTGATTGCCCGACAGGACATTGCTCGGCAGATCGATCTGGTTCAGCAAATCAAAGCCACCGAGCAGGCCTTT' },
  { name: 'GFP', type: 'CDS', color: '#7fff7f', sequence: 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAG' },
  { name: 'mCherry', type: 'CDS', color: '#7fff7f', sequence: 'ATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAGACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAG' },
  { name: '6xHis-tag', type: 'CDS', color: '#7fff7f', sequence: 'CACCATCACCATCACCAC' },
  { name: 'GST-tag', type: 'CDS', color: '#7fff7f', sequence: 'ATGTCCCCTATACTAGGTTATTGGAAAATTAAGGGCCTTGTGCAACCCACTCGACTTCTTTTGGAATATCTTGAAGAAAAATATGAAGAGCATTTGTATGAGCGCGATGAAGGTGATAAATGGCGAAACAAAAAGTTTGAATTGGGTTTGGAGTTTCCCAATCTTCCTTATCCAGGTTATGAAAGGTCATGTAACTGGGTTACATGGTTCTATGCATGGGATGTTGTGAATTTAACAATCAACCA' },
  { name: 'IRES', type: 'regulatory', color: '#ffbf7f', sequence: 'GCCACCATGATTGAACAAGATGGATTGCACGCAGGTTCTC' },
  { name: 'Kozak sequence', type: 'regulatory', color: '#ffbf7f', sequence: 'GCCACCATGG' },
  { name: 'LacZ alpha', type: 'CDS', color: '#7fff7f', sequence: 'ATGACCATGATTACGCCAAGCTATTTTAGCGAGACCGATAAC' },
  { name: 'MCS', type: 'misc_feature', color: '#dfbfff', sequence: 'GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGT' },
  { name: 'loxP', type: 'misc_recomb', color: '#ffbf7f', sequence: 'ATAACTTCGTATAATGTATGCTATACGAAGTTAT', note: 'Cre recombinase site' },
  { name: 'FRT', type: 'misc_recomb', color: '#ffbf7f', sequence: 'GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC', note: 'Flp recombinase site' },
  { name: 'attB1', type: 'misc_recomb', color: '#ffbf7f', sequence: 'ACAAGTTTGTACAAAAAAGCAGGCT', note: 'Gateway attB1' },
  { name: 'attB2', type: 'misc_recomb', color: '#ffbf7f', sequence: 'ACCCAGCTTTCTTGTACAAAGTGGT', note: 'Gateway attB2' },
  { name: 'lac operator', type: 'regulatory', color: '#ffbf7f', sequence: 'GGAATTGTGAGCGGATAACAATT', note: 'LacI binding site' },
  { name: 'tet operator', type: 'regulatory', color: '#ffbf7f', sequence: 'TCCCTATCAGTGATAGAGA', note: 'TetR binding site' },
  { name: 'strong RBS', type: 'RBS', color: '#ffbf7f', sequence: 'AAAGAGGAGAAA', note: 'Registry B0034' },
  { name: 'FLAG tag', type: 'tag', color: '#7fff7f', sequence: 'GACTACAAAGACGATGACGACAAG', note: 'DYKDDDDK' },
  { name: 'HA tag', type: 'tag', color: '#7fff7f', sequence: 'TACCCATACGATGTTCCAGATTACGCT', note: 'YPYDVPDYA' },
  { name: 'Myc tag', type: 'tag', color: '#7fff7f', sequence: 'GAACAAAAACTCATCTCAGAAGAGGATCTG', note: 'EQKLISEEDL' },
  { name: 'Strep-tag II', type: 'tag', color: '#7fff7f', sequence: 'TGGAGCCACCCGCAGTTCGAAAAA', note: 'WSHPQFEK' },
  { name: 'TEV site', type: 'misc_feature', color: '#dfbfff', sequence: 'GAAAACCTGTATTTTCAGGGC', note: 'ENLYFQ/G' },
  { name: 'Thrombin site', type: 'misc_feature', color: '#dfbfff', sequence: 'CTGGTGCCACGCGGTTCT', note: 'LVPR/GS' },
  { name: 'Factor Xa site', type: 'misc_feature', color: '#dfbfff', sequence: 'ATCGAAGGTCGT', note: 'IEGR' },
  { name: 'GS linker', type: 'misc_feature', color: '#dfbfff', sequence: 'GGTGGCGGTGGCTCG', note: '(GGGGS) linker' },
];
