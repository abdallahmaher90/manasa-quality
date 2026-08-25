import Papa from 'papaparse'

/**
 * Fetches and parses a published Google Sheet CSV URL.
 * @param {string} csvUrl 
 * @returns {Promise<Array>}
 */
export async function fetchGoogleSheetData(url) {
  if (!url) return []
  
  try {
    let csvUrl = url
    // If it's a standard google sheets link, convert it to an export CSV link
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
    if (match && match[1] && !url.includes('pub?output=csv') && !url.includes('export?format=csv') && !url.includes('gviz/tq')) {
      csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&sheet=Processed_Data`
    }

    const res = await fetch(csvUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error('فشل في قراءة الرابط')
    const csvText = await res.text()

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true, // Auto convert numbers
        complete: (results) => {
          resolve(results.data)
        },
        error: (error) => {
          reject(error)
        }
      })
    })
  } catch (error) {
    console.error('Error fetching Google Sheet:', error)
    return []
  }
}
