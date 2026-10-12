import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  ShadingType,
  BorderStyle,
  VerticalAlign
} from 'docx'

/**
 * Generates an official Egyptian Ministry of Health Inspection Report DOCX matching the exact format of:
 * "مستشفي فوه (2).docx"
 *
 * @param {Object} data
 * @param {string} data.hospital_name
 * @param {string} data.governorate
 * @param {string} data.inspection_date
 * @param {string} data.inspector_name
 * @param {Array} data.departments
 * @returns {Promise<Blob>}
 */
export async function generateReportDocxBlob(data) {
  const hospitalName = data.hospital_name || 'مستشفى'
  const governorate = data.governorate || 'كفر الشيخ'
  const inspectionDate = data.inspection_date || '-'
  const inspectorName = data.inspector_name || '-'
  const departments = data.departments || []

  const tableRows = []

  // Table Header Row
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 12, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'مدة التنفيذ', bold: true, size: 22, font: 'Arial' })]
            })
          ]
        }),
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'المسئول عنة', bold: true, size: 22, font: 'Arial' })]
            })
          ]
        }),
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'الاجراء التصحيحي', bold: true, size: 22, font: 'Arial' })]
            })
          ]
        }),
        new TableCell({
          width: { size: 33, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'بيان عدم التطابق', bold: true, size: 22, font: 'Arial' })]
            })
          ]
        }),
        new TableCell({
          width: { size: 5, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: true,
              children: [new TextRun({ text: 'م', bold: true, size: 22, font: 'Arial' })]
            })
          ]
        })
      ]
    })
  )

  let globalSerial = 1

  // Loop through departments
  departments.forEach((dept) => {
    // Merged Department Header Row (colSpan: 5)
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 5,
            shading: { fill: 'E2E8F0', type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                bidirectional: true,
                children: [
                  new TextRun({
                    text: dept.name || 'القسم',
                    bold: true,
                    size: 24,
                    font: 'Arial'
                  })
                ]
              })
            ]
          })
        ]
      })
    )

    // Findings under this department
    const findings = dept.findings || []
    findings.forEach((f) => {
      tableRows.push(
        new TableRow({
          children: [
            // مدة التنفيذ
            new TableCell({
              width: { size: 12, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: true,
                  children: [new TextRun({ text: f.deadline || 'يوم', bold: true, size: 20, font: 'Arial' })]
                })
              ]
            }),
            // المسئول عنه
            new TableCell({
              width: { size: 18, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: true,
                  children: [new TextRun({ text: f.responsible || 'الفريق الطبي', bold: true, size: 20, font: 'Arial' })]
                })
              ]
            }),
            // الاجراء التصحيحي
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  bidirectional: true,
                  children: [new TextRun({ text: f.corrective_action || '-', bold: true, size: 20, font: 'Arial' })]
                })
              ]
            }),
            // بيان عدم التطابق
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  bidirectional: true,
                  children: [new TextRun({ text: f.defect || '-', bold: true, size: 20, font: 'Arial' })]
                })
              ]
            }),
            // م
            new TableCell({
              width: { size: 5, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: true,
                  children: [new TextRun({ text: String(globalSerial++), bold: true, size: 20, font: 'Arial' })]
                })
              ]
            })
          ]
        })
      )
    })
  })

  // Assemble full Document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 }
          }
        },
        children: [
          // Header Row 1: Governorate & Hospital Name
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `محافظة :- ${governorate}                                                                اسم المنشأة :- ${hospitalName}`,
                bold: true,
                size: 24,
                font: 'Arial'
              })
            ]
          }),
          // Header Row 2: Inspector & Inspection Date
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: `القائم بالمرور  : ${inspectorName}                                                التاريخ : ${inspectionDate}`,
                bold: true,
                size: 24,
                font: 'Arial'
              })
            ]
          }),
          // Findings Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            visuallyRightToLeft: true,
            rows: tableRows
          }),
          // Space before Footer
          new Paragraph({
            spacing: { before: 300, after: 100 },
            children: []
          }),
          // Signatures Title Row
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: 'مدير ادارة سلامة المرضى                                                                           وكيل الوزارة',
                bold: true,
                size: 24,
                font: 'Arial'
              })
            ]
          }),
          // Signatures Name Row
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            bidirectional: true,
            children: [
              new TextRun({
                text: '      د\\ هدير محمد شلبي                                                                                      د\\ محمد ابوالسعد',
                bold: true,
                size: 24,
                font: 'Arial'
              })
            ]
          })
        ]
      }
    ]
  })

  return await Packer.toBlob(doc)
}
