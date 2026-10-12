import mammoth from 'mammoth'

function parseDocxHtml(html) {
  if (!html) return null
  // Clean slashes, hyphens or weird separators between Arabic characters (e.g. المر/كزي -> المركزي)
  let cleanHtml = html.replace(/([\u0600-\u06FF])[\/\-_]([\u0600-\u06FF])/g, '$1$2')
  
  const tableMatches = cleanHtml.match(/<table[^>]*>[\s\S]*?<\/table>/gi)
  if (!tableMatches || tableMatches.length === 0) return null

  let result = ''
  const parts = cleanHtml.split(/<table[^>]*>/i)

  // Header paragraphs before first table
  const headerHtml = parts[0] || ''
  const headerLines = headerHtml
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  result += headerLines.join('\n') + '\n\n'

  for (let i = 1; i < parts.length; i++) {
    const tablePart = parts[i].split(/<\/table>/i)[0]
    const rows = tablePart.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []

    let currentDept = 'عام'
    let headers = []

    rows.forEach((r, rowIdx) => {
      const isColspan = /colspan=["']?[2-9]/i.test(r)
      const cells = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(c => c.length > 0)

      if ((isColspan && cells.length === 1) || cells.length === 1) {
        currentDept = cells[0]
        result += '\n### قسم: ' + currentDept + '\n'
      } else if (cells.length > 1) {
        const isHeaderRow = cells.some(c => c.includes('تطابق') || c.includes('سلبي') || c.includes('الاجراء') || c.includes('المسئول'))
        if (isHeaderRow) {
          headers = cells
        } else {
          let defect = '', action = '', responsible = '', deadline = ''
          const defectIdx = headers.findIndex(h => h.includes('تطابق') || h.includes('سلبي') || h.includes('قصور'))
          const actionIdx = headers.findIndex(h => h.includes('تصحيح') || h.includes('اجراء'))
          const respIdx = headers.findIndex(h => h.includes('مسئول') || h.includes('مسؤول'))
          const deadIdx = headers.findIndex(h => h.includes('مدة') || h.includes('مهلة') || h.includes('تنفيذ'))

          if (defectIdx !== -1 && cells[defectIdx]) defect = cells[defectIdx]
          if (actionIdx !== -1 && cells[actionIdx]) action = cells[actionIdx]
          if (respIdx !== -1 && cells[respIdx]) responsible = cells[respIdx]
          if (deadIdx !== -1 && cells[deadIdx]) deadline = cells[deadIdx]

          // Fallback if headers didn't match exact column count
          if (!defect && cells.length >= 3) {
            defect = cells.find(c => c.length > 15) || cells[cells.length - 2] || cells[0]
          }

          if (defect) {
            result += '- السلبية: ' + defect + '\n'
            if (action) result += '  الإجراء التصحيحي: ' + action + '\n'
            if (responsible) result += '  المسؤول عنه: ' + responsible + '\n'
            if (deadline) result += '  مدة التنفيذ: ' + deadline + '\n'
          }
        }
      }
    })

    const afterTable = parts[i].split(/<\/table>/i)[1] || ''
    const footerLines = afterTable
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (footerLines.length > 0) {
      result += '\n' + footerLines.join('\n') + '\n'
    }
  }

  return result
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file) {
      return Response.json({ error: 'لم يتم رفع أي ملف' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const ext = file.name.split('.').pop().toLowerCase()

    let text = ''

    if (ext === 'docx') {
      try {
        const htmlResult = await mammoth.convertToHtml({ buffer })
        const structured = parseDocxHtml(htmlResult.value)
        if (structured && structured.trim().length > 50) {
          text = structured
        } else {
          const rawResult = await mammoth.extractRawText({ buffer })
          text = (rawResult.value || '').replace(/([\u0600-\u06FF])[\/\-_]([\u0600-\u06FF])/g, '$1$2')
        }
      } catch (err) {
        console.warn('Structured docx extraction fallback to raw text:', err)
        const rawResult = await mammoth.extractRawText({ buffer })
        text = (rawResult.value || '').replace(/([\u0600-\u06FF])[\/\-_]([\u0600-\u06FF])/g, '$1$2')
      }
    } else if (ext === 'pdf') {
      // Dynamic import to avoid Next.js bundler issues with pdf-parse
      const pdfParse = (await import('pdf-parse')).default
      const data = await pdfParse(buffer)
      text = data.text
    } else if (ext === 'txt') {
      text = buffer.toString('utf-8')
    } else {
      return Response.json({ error: 'نوع الملف غير مدعوم. يرجى رفع ملف Word أو PDF أو TXT.' }, { status: 400 })
    }

    if (!text || text.trim().length === 0) {
      return Response.json({ error: 'الملف لا يحتوي على نصوص قابلة للقراءة. (إذا كان الملف عبارة عن صور Scan، يرجى كتابة/نسخ التقرير يدوياً).' }, { status: 400 })
    }

    return Response.json({ text })
  } catch (error) {
    console.error('Extract text error:', error)
    return Response.json({ error: 'فشل في قراءة الملف: ' + error.message }, { status: 500 })
  }
}
