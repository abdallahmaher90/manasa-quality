import Papa from 'papaparse'

// In-memory cache for parsed Google Sheet data to prevent re-downloading & re-parsing ~8,000 rows on every request
const sheetCache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export function invalidateGoogleSheetCache(url = null) {
  if (url) {
    sheetCache.delete(url)
  } else {
    sheetCache.clear()
  }
}

/**
 * Fetches and parses a published Google Sheet CSV URL with memory caching.
 * @param {string} url 
 * @param {boolean} forceRefresh
 * @returns {Promise<Array>}
 */
export async function fetchGoogleSheetData(url, forceRefresh = false) {
  if (!url) return []
  
  const now = Date.now()
  if (!forceRefresh && sheetCache.has(url)) {
    const cached = sheetCache.get(url)
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data
    }
  }

  try {
    let csvUrl = url
    // If it's a standard google sheets link, convert it to an export CSV link
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
    if (match && match[1] && !url.includes('pub?output=csv') && !url.includes('export?format=csv') && !url.includes('gviz/tq')) {
      csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&sheet=Processed_Data`
    }

    const res = await fetch(csvUrl)
    if (!res.ok) throw new Error('فشل في قراءة الرابط')
    const csvText = await res.text()

    const parsedData = await new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true, // Auto convert numbers
        complete: (results) => {
          resolve(results.data || [])
        },
        error: (error) => {
          reject(error)
        }
      })
    })

    sheetCache.set(url, { timestamp: now, data: parsedData })
    return parsedData
  } catch (error) {
    console.error('Error fetching Google Sheet:', error)
    if (sheetCache.has(url)) {
      return sheetCache.get(url).data // Fallback to stale cache if network fails
    }
    return []
  }
}
