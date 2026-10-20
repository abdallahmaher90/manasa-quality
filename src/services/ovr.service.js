import { createServiceClient } from '../lib/supabase.js'
import fs from 'fs'
import path from 'path'

let cachedSummary = null
let cachedRecords = null

function getLocalSummary() {
  if (cachedSummary) return cachedSummary
  try {
    const p = path.join(process.cwd(), 'src', 'data', 'ovr_summary.json')
    if (fs.existsSync(p)) {
      cachedSummary = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return cachedSummary
    }
  } catch (e) {}
  return { total_records: 0, by_hospital: {}, by_domain: {} }
}

function getLocalRecords() {
  if (cachedRecords) return cachedRecords
  try {
    const p = path.join(process.cwd(), 'src', 'data', 'ovr_records.json')
    if (fs.existsSync(p)) {
      cachedRecords = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return cachedRecords
    }
  } catch (e) {}
  return []
}

export class OVRService {
  constructor() {
    this.supabase = createServiceClient()
  }

  // 1. Get Global Summary & By-Hospital Breakdown
  async getSummary() {
    try {
      // First try to read from Supabase settings if updated
      const { data, error } = await this.supabase
        .from('settings')
        .select('value')
        .eq('key', 'ovr_summary_index')
        .single()

      if (!error && data?.value) {
        return JSON.parse(data.value)
      }
    } catch (e) {
      // Fallback to static JSON
    }
    return getLocalSummary()
  }

  // 2. Get All Records for a Specific Hospital
  async getHospitalOVR(hospitalId) {
    if (!hospitalId) return []

    try {
      const { data, error } = await this.supabase
        .from('settings')
        .select('value')
        .eq('key', `ovr_data:${hospitalId}`)
        .single()

      if (!error && data?.value) {
        return JSON.parse(data.value)
      }
    } catch (e) {
      // Fallback
    }

    // Fallback from static records
    return getLocalRecords().filter(r => r.hospital_id === hospitalId)
  }

  // 3. Search and Filter OVR Records
  async queryOVR({ hospitalId = null, domain = null, search = '', page = 1, limit = 50 } = {}) {
    let list = getLocalRecords()

    if (hospitalId && hospitalId !== 'all') {
      list = list.filter(r => r.hospital_id === hospitalId)
    }

    if (domain && domain !== 'all') {
      list = list.filter(r => r.domain_key === domain)
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => 
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.subcategory && r.subcategory.toLowerCase().includes(q)) ||
        (r.hospital_name && r.hospital_name.toLowerCase().includes(q))
      )
    }

    const total = list.length
    const offset = (page - 1) * limit
    const paginated = list.slice(offset, offset + limit)

    return {
      records: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }
}

export const ovrService = new OVRService()
