/**
 * holidayCache.js
 *
 * Fetching, persistence and classification for Taiwan national-holiday data
 * (ruyut/TaiwanCalendar via jsDelivr). See docs/reviews for the full design.
 */

export const HOLIDAY_CACHE_VERSION = 1
const KEY_PREFIX = 'leaveCalculator_holidayCache_'
const keyFor = (year) => `${KEY_PREFIX}${year}`
const RETRY_DELAYS_MS = [0, 2000, 5000]

/**
 * Fetch a year's holiday data, retrying non-404 failures up to 3 times
 * (immediately, then after 2s, then after 5s).
 *
 * Returns one of:
 *   { status: 'available', dates: Set<string> }
 *   { status: 'pending' }       -- 404, year >= currentYear (not yet published)
 *   { status: 'unavailable' }   -- 404, year < currentYear (source never had it)
 *   { status: 'error', error }  -- non-404 failure after all retries
 */
export async function fetchHolidayYear(
  year,
  { currentYear = new Date().getFullYear(), fetchImpl = fetch, sleep = defaultSleep } = {}
) {
  let lastError
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt])
    try {
      const res = await fetchImpl(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`)
      if (res.status === 404) {
        return year >= currentYear ? { status: 'pending' } : { status: 'unavailable' }
      }
      if (!res.ok) throw new Error(`Unexpected status ${res.status}`)
      const json = await res.json()
      return { status: 'available', dates: toHolidayDateSet(json) }
    } catch (err) {
      lastError = err
    }
  }
  return { status: 'error', error: lastError }
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toHolidayDateSet(json) {
  const dates = new Set()
  for (const entry of json) {
    if (!entry.isHoliday) continue
    const s = entry.date
    dates.add(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  }
  return dates
}

export function persistHolidayYear(year, entry) {
  try {
    const payload = {
      cacheVersion: entry.cacheVersion,
      status: entry.status,
      ...(entry.status === 'available' ? { dates: [...entry.dates] } : {}),
    }
    localStorage.setItem(keyFor(year), JSON.stringify(payload))
  } catch {
    // 寫入失敗:靜默降級,本次 session 仍以記憶體結果呈現
  }
}

export function hydrateHolidayCache() {
  const result = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(KEY_PREFIX)) continue
      const year = Number(key.slice(KEY_PREFIX.length))
      if (!Number.isInteger(year)) continue
      try {
        const parsed = JSON.parse(localStorage.getItem(key))
        if (parsed.cacheVersion !== HOLIDAY_CACHE_VERSION) continue
        // status 必須是 available/unavailable 之一,且 available 時 dates 必須
        // 是陣列,否則視為損毀跳過 -- 否則會被還原成空 Set 且因判定為 available
        // (fresh)永遠不會重抓,是唯一沒有自我修復路徑的壞狀態。
        if (parsed.status !== 'available' && parsed.status !== 'unavailable') continue
        if (parsed.status === 'available' && !Array.isArray(parsed.dates)) continue
        result[year] = {
          cacheVersion: parsed.cacheVersion,
          status: parsed.status,
          ...(parsed.status === 'available' ? { dates: new Set(parsed.dates) } : {}),
        }
      } catch {
        // 損毀的紀錄直接跳過
      }
    }
  } catch {
    return {}
  }
  return result
}

export function clearHolidayCacheFromStorage() {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(KEY_PREFIX)) keysToRemove.push(key)
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // localStorage 整體不可用:沒有東西好清的,靜默放棄
  }
}
