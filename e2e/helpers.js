/**
 * e2e/helpers.js
 *
 * Shared helpers for the Playwright suite.
 *
 * Two ways of getting the app into a given state are used across the specs:
 *
 * 1. Driving the actual UI (react-calendar's date picker) — used once, in
 *    onboarding-and-settings.spec.js, to prove the real "click through the
 *    calendar and save" flow works end to end.
 * 2. Seeding localStorage directly before navigating — used everywhere else
 *    that needs a specific onboardDate/records combination (e.g. carryover
 *    scenarios). This keeps those tests fast and avoids re-testing the same
 *    calendar-navigation mechanics repeatedly; the storage keys/shape mirror
 *    src/utils/storage.js exactly, so a shape mismatch there would still be
 *    caught by the unit tests.
 */

export const FIXED_TODAY = '2025-06-15T03:00:00' // 2025-06-15 local time

/** Freeze the browser clock so all "today"-based calculations are deterministic. */
export async function freezeTime(page, iso = FIXED_TODAY) {
  await page.clock.install({ time: new Date(iso) })
}

/**
 * Build the zh-TW accessible name react-calendar gives a month-view day tile,
 * e.g. zhDayLabel({year: 2025, month: 6, day: 20}) -> "2025年6月20日".
 * Confirmed directly from a Playwright accessibility snapshot (not guessed):
 * `button "2025年6月1日" [disabled]: 1日`. Used with getByRole for exact,
 * unambiguous day-tile targeting instead of matching on visible text/class.
 */
export function zhDayLabel({ year, month, day }) {
  return `${year}年${month}月${day}日`
}

/**
 * Seed settings and/or records directly into localStorage before first
 * navigation. Mirrors the shape of DEFAULT_SETTINGS / records in
 * src/utils/storage.js.
 *
 * IMPORTANT: this uses page.addInitScript(), which re-runs on *every*
 * navigation in the page's lifetime -- including page.reload(). Only pass
 * the fields you want forcibly reset on every future navigation too. In
 * particular, don't pass `records` in a test that adds records via the real
 * UI and then reloads to check persistence -- doing so will silently wipe
 * whatever was added, since this same script fires again on that reload.
 * Omit a field entirely (rather than passing `[]` / `{}`) to leave it alone.
 */
export async function seedAppStorage(page, { settings, records } = {}) {
  await page.addInitScript(
    ([settingsJson, recordsJson]) => {
      if (settingsJson !== null) window.localStorage.setItem('leaveCalculator_settings', settingsJson)
      if (recordsJson !== null) window.localStorage.setItem('leaveCalculator_records', recordsJson)
    },
    [
      settings !== undefined ? JSON.stringify(settings) : null,
      records !== undefined ? JSON.stringify(records) : null,
    ]
  )
}

const HOLIDAY_CDN_PATTERN = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/*.json'

/**
 * Intercept every TaiwanCalendar CDN request for the test's lifetime. Call
 * BEFORE page.goto() (right after freezeTime()).
 *
 * `handler` may be async / return a Promise that resolves late, enabling
 * delayed-response tests. It may also be a stateful closure (call counter,
 * or an outer `let` the test flips) to simulate "fails then succeeds on
 * retry" or "first vs. second request for the same year returns different
 * bodies".
 * Default (handler omitted): every year -> 404, classifying as
 * pending/unavailable -- the quietest baseline for specs that don't care
 * about holidays. Deliberately NOT route.abort() by default, which would
 * classify as error (red note text) instead.
 *
 * Not an auto fixture -- every future spec that renders MainPage must call
 * this itself, right after freezeTime(), or it will hit the real CDN. There
 * is no autouse fixture wiring this in; if a new spec forgets, its test will
 * make a live network request in CI.
 */
export async function mockHolidayCdn(page, handler = () => ({ status: 404 })) {
  await page.route(HOLIDAY_CDN_PATTERN, async (route) => {
    const year = Number(new URL(route.request().url()).pathname.match(/(\d{4})\.json$/)?.[1])
    const result = await handler(year)
    if (result === 'abort') {
      await route.abort()
    } else if (result.status === 200) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result.body) })
    } else {
      await route.fulfill({ status: result.status ?? 404, body: '' })
    }
  })
}

/**
 * Build a realistic TaiwanCalendar year body: every Saturday/Sunday in
 * `year` marked isHoliday, plus any extra ISO dates (weekday national
 * holidays / makeup workdays) layered on top. Real API data marks isHoliday
 * on weekends too (see §2.1) -- tests that only listed one weekday date were
 * silently missing this and could get wrong dot-extension results whenever a
 * leave record crossed a real weekend.
 *
 * `excludeIsoDates`: weekends to OMIT from the generated body (e.g. a
 * makeup workday Saturday, 補班). The real API represents a makeup workday
 * as that date simply not being isHoliday; since toHolidayDateSet() only
 * reads entries where isHoliday is true, omitting the entry has the same
 * parsed effect as an explicit isHoliday:false entry, so this stays a plain
 * omission rather than pushing a redundant entry.
 */
export function buildHolidayYearBody(year, extraHolidayIsoDates = [], excludeIsoDates = []) {
  const excluded = new Set(excludeIsoDates)
  const entries = []
  const cursor = new Date(year, 0, 1)
  while (cursor.getFullYear() === year) {
    if (cursor.getDay() === 0 || cursor.getDay() === 6) {
      const iso = toISODateStringLocal(cursor)
      if (!excluded.has(iso)) entries.push({ date: toYYYYMMDD(cursor), isHoliday: true })
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  extraHolidayIsoDates.forEach((iso) => {
    entries.push({ date: iso.replaceAll('-', ''), isHoliday: true })
  })
  return entries
}

function toYYYYMMDD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function toISODateStringLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
