import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType,
  BorderStyle, PageBreak, ShadingType,
} from 'docx';
import { requireApiUser } from '@/lib/auth-guard';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if ('response' in auth) return auth.response;
  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      project: { include: { tasks: { include: { steps: true, procedure: true } } } },
      createdBy: true,
      sections:  { orderBy: [{ order: 'asc' } as any, { sectionKey: 'asc' }] },
      figures:   { orderBy: { order: 'asc' } },
      tables:    { orderBy: { order: 'asc' } },
      taskLinks: { include: { task: { include: { steps: true, procedure: true } } } },
    },
  });

  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sectionMap = Object.fromEntries(report.sections.map(s => [s.sectionKey, s.content]));

  const children: any[] = [];

  // ── Title Page ────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      text: report.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Author: ${report.createdBy.name}`, size: 24 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Project: ${report.project.name}`, size: 24 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${new Date(report.updatedAt).toLocaleDateString()}`, size: 24 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Status: ${report.status}`, size: 22, color: '888888' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Abstract ──────────────────────────────────────────────────────────────
  if (report.abstract) {
    children.push(
      new Paragraph({ text: 'Abstract', heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }),
      ...textToParas(report.abstract),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }

  // ── Numbered Sections ──────────────────────────────────────────────────────
  const orderedKeys = [
    ['project_info',     '1. Project Information'],
    ['gene_info',        '2. Gene Information'],
    ['gene_map',         '3. Gene Map'],
    ['plasmid_map',      '4. Plasmid Map'],
    ['expected_results', '5. Expected Results'],
    ['obtained_results', '6. Obtained Results'],
    ['procedures',       '7. Materials & Methods'],
    ['findings',         '8. Findings & Observations'],
    ['discussion',       '9. Discussion'],
    ['conclusion',       '10. Conclusion'],
  ];

  for (const [key, heading] of orderedKeys) {
    let content = sectionMap[key] ?? '';

    // Auto-fill project info
    if (key === 'project_info' && !content.trim()) {
      content = `Project: ${report.project.name}\nAuthor: ${report.createdBy.name}\nDate: ${new Date(report.createdAt).toLocaleDateString()}\n${report.project.description ? '\n' + report.project.description : ''}`.trim();
    }

    // Auto-fill procedures from linked tasks
    if (key === 'procedures' && !content.trim()) {
      const procs = [...new Set(
        report.taskLinks
          .map(l => l.task.procedure)
          .filter(Boolean)
          .map(p => `• ${p!.name} (${p!.procedureId})`)
      )];
      if (procs.length) content = procs.join('\n');
    }

    if (!content.trim()) continue;

    children.push(
      new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
      ...textToParas(content),
    );
  }

  // ── Figures ────────────────────────────────────────────────────────────────
  if (report.figures.length > 0) {
    children.push(
      new Paragraph({ text: 'Figures', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
    );
    report.figures.forEach((fig, i) => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Figure ${i + 1}${fig.title ? ': ' + fig.title : ''}`, bold: true, size: 24 })],
          spacing: { before: 300, after: 100 },
        }),
      );
      if (fig.imageUrl) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `[Image: ${fig.imageUrl}]`, italics: true, color: '888888', size: 20 })],
        }));
      }
      if (fig.legend) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `Legend: ${fig.legend}`, italics: true, size: 20 })],
          spacing: { after: 200 },
        }));
      }
    });
  }

  // ── Tables ─────────────────────────────────────────────────────────────────
  if (report.tables.length > 0) {
    children.push(
      new Paragraph({ text: 'Tables', heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
    );
    report.tables.forEach((tbl, i) => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Table ${i + 1}${tbl.title ? ': ' + tbl.title : ''}`, bold: true, size: 24 })],
          spacing: { before: 300, after: 100 },
        }),
      );
      const rows: string[][] = JSON.parse(tbl.tableData || '[]');
      if (rows.length > 0 && rows[0].length > 0) {
        const docxTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((row, ri) =>
            new TableRow({
              children: row.map(cell =>
                new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({ text: cell, bold: ri === 0, size: 20 })],
                  })],
                  shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'E8F0FE' } : undefined,
                  borders: {
                    top:    { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                    left:   { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                    right:  { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
                  },
                }),
              ),
            }),
          ),
        });
        children.push(docxTable);
      }
      if (tbl.legend) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `Legend: ${tbl.legend}`, italics: true, size: 20 })],
          spacing: { after: 200 },
        }));
      }
    });
  }

  // ── Build doc ─────────────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 24 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  const uint8 = new Uint8Array(buffer);

  const filename = report.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}_report.docx"`,
    },
  });
}

function textToParas(text: string): Paragraph[] {
  return text.split('\n').map(line =>
    new Paragraph({
      children: [new TextRun({ text: line, size: 24 })],
      spacing: { after: 120 },
    })
  );
}
