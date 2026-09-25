import { useCallback, useRef, useState } from 'react'
import {
  HOLIDAY_CACHE_VERSION, fetchHolidayYear, persistHolidayYear,
  hydrateHolidayCache, clearHolidayCacheFromStorage,
} from '../utils/holidayCache.js'

/**
 * Owns the in-memory + localStorage-backed national-holiday cache.
 * `available`/`unavailable` are treated as fresh and never refetched;
 * everything else (missing, `pending`, `error`) is refetched on every call.
 * A generation counter lets `clearCache()` invalidate in-flight requests
 * without needing to cancel them.
 */
export function useHolidayCache() {
  const [cache, setCache] = useState(() => hydrateHolidayCache())
  const cacheRef = useRef(cache)
  const inFlightRef = useRef(new Set())
  const generationRef = useRef(0)

  const ensureYear = useCallback((year) => {
    const current = cacheRef.current[year]
    const isFresh =
      current && current.cacheVersion === HOLIDAY_CACHE_VERSION &&
      (current.status === 'available' || current.status === 'unavailable')
    if (isFresh) return
    if (inFlightRef.current.has(year)) return

    inFlightRef.current.add(year)
    const gen = generationRef.current

    cacheRef.current = { ...cacheRef.current, [year]: { status: 'loading' } }
    setCache(cacheRef.current)

    fetchHolidayYear(year).then((result) => {
      if (gen !== generationRef.current) return
      const entry = { ...result, cacheVersion: HOLIDAY_CACHE_VERSION }
      cacheRef.current = { ...cacheRef.current, [year]: entry }
      setCache(cacheRef.current)
      inFlightRef.current.delete(year)
      if (entry.status === 'available' || entry.status === 'unavailable') {
        persistHolidayYear(year, entry)
      }
    })
  }, [])

  const clearCache = useCallback(() => {
    generationRef.current += 1
    clearHolidayCacheFromStorage()
    cacheRef.current = {}
    inFlightRef.current.clear()
    setCache({})
  }, [])

  return { cache, ensureYear, clearCache }
}
