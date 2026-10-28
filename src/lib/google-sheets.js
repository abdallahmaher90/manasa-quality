import Papa from 'papaparse'

// In-memory cache for parsed Google Sheet data to prevent re-downloading & re-parsing ~8,000 rows on every request
const sheetCache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export function invalidateGoogleSheetCache(url = null, sheetName = null) {
  if (url && sheetName) {
    sheetCache.delete(`${url}:::${sheetName}`)
  } else if (url) {
    for (const key of sheetCache.keys()) {
      if (key.startsWith(url)) {
        sheetCache.delete(key)
      }
    }
  } else {
    sheetCache.clear()
  }
}

/**
 * Fetches and parses a published Google Sheet CSV URL with memory caching.
 * @param {string} url 
 * @param {boolean} forceRefresh
 * @param {string} sheetName (default 'Processed_Data')
 * @returns {Promise<Array>}
 */
export async function fetchGoogleSheetData(url, forceRefresh = false, sheetName = 'Processed_Data') {
  if (!url) return []
  
  const cacheKey = `${url}:::${sheetName || 'Processed_Data'}`
  const now = Date.now()
  if (!forceRefresh && sheetCache.has(cacheKey)) {
    const cached = sheetCache.get(cacheKey)
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data
    }
  }

  try {
    let csvUrl = url
    // If it's a standard google sheets link, convert it to an export CSV link
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
    if (match && match[1]) {
      if (!url.includes('pub?output=csv') && !url.includes('export?format=csv')) {
        csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName || 'Processed_Data')}`
      }
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

    sheetCache.set(cacheKey, { timestamp: now, data: parsedData })
    return parsedData
  } catch (error) {
    console.error('Error fetching Google Sheet:', error)
    if (sheetCache.has(cacheKey)) {
      return sheetCache.get(cacheKey).data // Fallback to stale cache if network fails
    }
    return []
  }
}
