import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType, HeadingLevel, ShadingType } from 'docx'
import { saveAs } from 'file-saver'

// Helper to create a styled table cell
const createCell = (text, isHeader = false, width = null) => {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: text || '',
            bold: isHeader,
            size: isHeader ? 28 : 24, // 14pt or 12pt
            font: 'Arial',
            rightToLeft: true,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
    shading: isHeader ? { fill: 'D9D9D9', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
    }
  })
}

// Helper to create a table for findings
const createFindingsTable = (findings, includeDept = true) => {
  if (!findings || findings.length === 0) {
    return new Paragraph({
      children: [
        new TextRun({
          text: 'لا يوجد',
          font: 'Arial',
          size: 24,
          rightToLeft: true,
        }),
      ],
      alignment: AlignmentType.RIGHT,
    })
  }

  const rows = [
    new TableRow({
      children: [
        createCell('م', true, 10),
        ...(includeDept ? [createCell('القسم', true, 20)] : []),
        createCell('السلبية', true, includeDept ? 70 : 90),
      ],
    }),
  ]

  findings.forEach((f, idx) => {
    const text = f.canonical_text || f.original_text || f.text || ''
    const dept = f.departments?.name || f.department_name || 'عام'
    
    rows.push(
      new TableRow({
        children: [
          createCell((idx + 1).toString(), false, 10),
          ...(includeDept ? [createCell(dept, false, 20)] : []),
          createCell(text, false, includeDept ? 70 : 90),
        ],
      })
    )
  })

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { left: 0, right: 0 },
    alignment: AlignmentType.CENTER
  })
}

// Helper to create section header
const createSectionHeader = (title) => {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 400, after: 200 },
    bidirectional: true,
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 32,
        font: 'Arial',
        color: '000000',
        rightToLeft: true,
      })
    ]
  })
}

export const generateVisitReport = async ({ hospitalName, resolvedFindings, unresolvedFindings, newFindings, departments }) => {
  
  const today = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  const deptsString = departments && departments.length > 0 ? departments.join(' - ') : 'غير محدد'

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }
          }
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            bidirectional: true,
            children: [
              new TextRun({
                text: `تقرير مرور - ${hospitalName}`,
                bold: true,
                size: 40,
                font: 'Arial',
                rightToLeft: true,
              }),
            ],
          }),
          
          // Meta Info
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 400 },
            bidirectional: true,
            children: [
              new TextRun({
                text: `التاريخ: ${today}`,
                size: 28,
                font: 'Arial',
                rightToLeft: true,
              }),
              new TextRun({ break: 1 }),
              new TextRun({
                text: `الأقسام التي تم المرور عليها: ${deptsString}`,
                size: 28,
                font: 'Arial',
                rightToLeft: true,
              }),
            ],
          }),

          // Section 1: Resolved Findings
          createSectionHeader('أولاً: سلبيات تم الإفادة بحلها مؤخراً (خلال آخر 48 ساعة)'),
          createFindingsTable(resolvedFindings),

          // Section 2: New Findings
          createSectionHeader('ثانياً: سلبيات جديدة تم رصدها خلال المرور الحالي'),
          createFindingsTable(newFindings),

          // Section 3: Unresolved Previous Findings
          createSectionHeader('ثالثاً: سلبيات من مرورات سابقة لم يتم تلافيها'),
          createFindingsTable(unresolvedFindings),
          
          // Signatures space
          new Paragraph({
            spacing: { before: 800 },
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({
                text: 'توقيع الفريق الزائر: .......................................',
                size: 28,
                font: 'Arial',
                rightToLeft: true,
              }),
            ]
          }),
          new Paragraph({
            spacing: { before: 400 },
            alignment: AlignmentType.BOTH,
            children: [
              new TextRun({
                text: 'توقيع مدير المستشفى: .......................................',
                size: 28,
                font: 'Arial',
                rightToLeft: true,
              }),
            ]
          }),
        ],
      },
    ],
  })

  // Generate buffer and save
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `تقرير_مرور_${hospitalName.replace(/\s+/g, '_')}_${new Date().getTime()}.docx`)
}
