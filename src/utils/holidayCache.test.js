import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  HOLIDAY_CACHE_VERSION,
  fetchHolidayYear,
  persistHolidayYear,
  hydrateHolidayCache,
  clearHolidayCacheFromStorage,
} from './holidayCache.js'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function jsonResponse(json) {
  return { status: 200, ok: true, json: async () => json }
}

describe('fetchHolidayYear', () => {
  it('converts YYYYMMDD dates to YYYY-MM-DD and only keeps isHoliday entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([
      { date: '20250101', isHoliday: true },
      { date: '20250102', isHoliday: false },
      { date: '20251225', isHoliday: true },
    ]))
    const result = await fetchHolidayYear(2025, { fetchImpl, currentYear: 2025 })
    expect(result.status).toBe('available')
    expect(result.dates).toEqual(new Set(['2025-01-01', '2025-12-25']))
  })

  it('200 response -> available with a Set of holiday dates', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ date: '20250101', isHoliday: true }]))
    const result = await fetchHolidayYear(2025, { fetchImpl, currentYear: 2025 })
    expect(result).toEqual({ status: 'available', dates: new Set(['2025-01-01']) })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('404 and year >= currentYear -> pending', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404 })
    const result = await fetchHolidayYear(2026, { fetchImpl, currentYear: 2025 })
    expect(result).toEqual({ status: 'pending' })
  })

  it('404 and year < currentYear -> unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404 })
    const result = await fetchHolidayYear(2024, { fetchImpl, currentYear: 2025 })
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('3 consecutive non-404 failures -> error, retries 3 times with 2000ms/5000ms delays', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await fetchHolidayYear(2025, { fetchImpl, sleep, currentYear: 2025 })
    expect(result.status).toBe('error')
    expect(result.error).toBeInstanceOf(Error)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 2000)
    expect(sleep).toHaveBeenNthCalledWith(2, 5000)
  })

  it('succeeds on the 2nd attempt -> available, fetchImpl called only twice', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse([{ date: '20250101', isHoliday: true }]))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await fetchHolidayYear(2025, { fetchImpl, sleep, currentYear: 2025 })
    expect(result.status).toBe('available')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries and recovers using the real default sleep, under fake timers', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(jsonResponse([{ date: '20250101', isHoliday: true }]))
      const promise = fetchHolidayYear(2025, { fetchImpl, currentYear: 2025 })
      await vi.advanceTimersByTimeAsync(2000)
      const result = await promise
      expect(result.status).toBe('available')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a non-2xx, non-404 status is treated as a failure that gets retried', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 500, ok: false })
    const sleep = vi.fn().mockResolvedValue(undefined)
    const result = await fetchHolidayYear(2025, { fetchImpl, sleep, currentYear: 2025 })
    expect(result.status).toBe('error')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('persistHolidayYear', () => {
  it('writes an available entry as JSON with dates flattened to an array', () => {
    persistHolidayYear(2025, {
      cacheVersion: HOLIDAY_CACHE_VERSION,
      status: 'available',
      dates: new Set(['2025-01-01']),
    })
    const stored = JSON.parse(localStorage.getItem('leaveCalculator_holidayCache_2025'))
    expect(stored).toEqual({ cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available', dates: ['2025-01-01'] })
  })

  it('writes an unavailable entry without a dates field', () => {
    persistHolidayYear(2024, { cacheVersion: HOLIDAY_CACHE_VERSION, status: 'unavailable' })
    const stored = JSON.parse(localStorage.getItem('leaveCalculator_holidayCache_2024'))
    expect(stored).toEqual({ cacheVersion: HOLIDAY_CACHE_VERSION, status: 'unavailable' })
  })

  it('does not throw when localStorage.setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() =>
      persistHolidayYear(2025, { cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available', dates: new Set() })
    ).not.toThrow()
  })
})

describe('hydrateHolidayCache', () => {
  it('reads back available/unavailable entries, converting dates back to a Set', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available', dates: ['2025-01-01', '2025-12-25'],
    }))
    localStorage.setItem('leaveCalculator_holidayCache_2024', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'unavailable',
    }))
    const result = hydrateHolidayCache()
    expect(result[2025]).toEqual({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available', dates: new Set(['2025-01-01', '2025-12-25']),
    })
    expect(result[2024]).toEqual({ cacheVersion: HOLIDAY_CACHE_VERSION, status: 'unavailable' })
  })

  it('skips entries whose cacheVersion does not match', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION + 1, status: 'available', dates: ['2025-01-01'],
    }))
    expect(hydrateHolidayCache()).toEqual({})
  })

  it('skips entries whose status is not available/unavailable', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'pending',
    }))
    expect(hydrateHolidayCache()).toEqual({})
  })

  it('skips an available entry whose dates is missing or not an array', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available',
    }))
    localStorage.setItem('leaveCalculator_holidayCache_2024', JSON.stringify({
      cacheVersion: HOLIDAY_CACHE_VERSION, status: 'available', dates: 'not-an-array',
    }))
    expect(hydrateHolidayCache()).toEqual({})
  })

  it('skips corrupted (non-JSON) entries without throwing', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', '{not valid json')
    expect(hydrateHolidayCache()).toEqual({})
  })

  it('ignores keys outside the holiday-cache prefix', () => {
    localStorage.setItem('leaveCalculator_settings', JSON.stringify({ onboardDate: '2024-01-01' }))
    expect(hydrateHolidayCache()).toEqual({})
  })

  it('returns {} when localStorage access itself throws', () => {
    vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(hydrateHolidayCache()).toEqual({})
  })
})

describe('clearHolidayCacheFromStorage', () => {
  it('removes only keys under the holiday-cache prefix', () => {
    localStorage.setItem('leaveCalculator_holidayCache_2025', 'x')
    localStorage.setItem('leaveCalculator_holidayCache_2024', 'x')
    localStorage.setItem('leaveCalculator_settings', 'y')

    clearHolidayCacheFromStorage()

    expect(localStorage.getItem('leaveCalculator_holidayCache_2025')).toBeNull()
    expect(localStorage.getItem('leaveCalculator_holidayCache_2024')).toBeNull()
    expect(localStorage.getItem('leaveCalculator_settings')).toBe('y')
  })

  it('does not throw when localStorage access itself throws', () => {
    vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => clearHolidayCacheFromStorage()).not.toThrow()
  })
})
