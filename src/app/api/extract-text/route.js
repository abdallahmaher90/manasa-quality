import mammoth from 'mammoth'

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
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
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
