import { NextResponse } from 'next/server'
import { ovrService } from '@/services/ovr.service'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const hospitalId = searchParams.get('hospitalId')
    const domain = searchParams.get('domain')
    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const mode = searchParams.get('mode') // 'summary' or 'records'

    if (mode === 'summary') {
      const summary = await ovrService.getSummary()
      return NextResponse.json(summary)
    }

    const result = await ovrService.queryOVR({
      hospitalId,
      domain,
      search,
      page,
      limit
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in /api/ovr:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
