import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage, zhDayLabel, mockHolidayCdn, buildHolidayYearBody } from './helpers.js'

// onboard 2024-06-01 + frozen "today" 2025-06-15 -> exactly 12 completed
// months -> newest/active period is 2025-06-01 ~ 2026-05-31 (7 days),
// entirely containing June 2025 -- the default visible month.
const BASE_SETTINGS = {
  onboardDate: '2024-06-01',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

test.describe('國定假日資料整合', () => {
  test('available：平日假日與週末皆暗紅、未選取 hover/focus 維持暗紅、補班週六不套用 holiday class', async ({ page }) => {
    await freezeTime(page)
    // 2025-06-18 (Wed): extra weekday holiday. 2025-06-21 (Sat): makeup
    // workday, excluded from the generated body so it stays a plain weekend.
    await mockHolidayCdn(page, (year) =>
      year === 2025
        ? { status: 200, body: buildHolidayYearBody(2025, ['2025-06-18'], ['2025-06-21']) }
        : { status: 404 }
    )
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    const weekdayHoliday = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
    await expect(weekdayHoliday).toHaveCSS('color', 'rgb(159, 18, 57)')
    await weekdayHoliday.focus()
    await expect(weekdayHoliday).toHaveCSS('color', 'rgb(159, 18, 57)')

    const weekendHoliday = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 7 }) })
    await expect(weekendHoliday).toHaveCSS('color', 'rgb(159, 18, 57)')

    const makeupSaturday = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 21 }) })
    await expect(makeupSaturday).not.toHaveClass(/react-calendar__tile--holiday/)
    await expect(makeupSaturday).toHaveCSS('color', 'rgb(107, 114, 128)')

    const note = page.getByTestId('calendar-holiday-note')
    await expect(note).toContainText('已載入')
    await expect(note).toHaveClass(/text-stone-400/)
    await expect(note).not.toHaveClass(/text-red-600/)
  })

  test('既有記錄延展：圓點正確跳過假日與週末並往後延伸', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025, ['2025-06-18']) } : { status: 404 }
    )
    // 2025-06-17 (Tue) + 2 days should land on 17th and (skipping the 18th
    // holiday) the 19th.
    await seedAppStorage(page, {
      settings: BASE_SETTINGS,
      records: [{ id: 'r1', startDate: '2025-06-17', days: 2 }],
    })
    await page.goto('/')

    const day17 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 17 }) + ' 已登記請假', exact: true })
    await expect(day17.locator('.leave-dot')).toBeVisible()
    const day18 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }), exact: true })
    await expect(day18.locator('.leave-dot')).toHaveCount(0)
    const day19 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 19 }) + ' 已登記請假', exact: true })
    await expect(day19.locator('.leave-dot')).toBeVisible()
  })

  test('選取假日日期：tile 背景暗紅、文字白色，點擊後 focus 仍維持暗紅背景', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025, ['2025-06-18']) } : { status: 404 }
    )
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    const tile = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
    await tile.click()
    await expect(tile).toHaveCSS('background-color', 'rgb(159, 18, 57)')
    await expect(tile).toHaveCSS('color', 'rgb(255, 255, 255)')
    await tile.focus()
    await expect(tile).toHaveCSS('background-color', 'rgb(159, 18, 57)')
  })

  test('mock 404 且年度為當前年度（≥currentYear）：note 顯示尚未公布', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page) // default handler: every year 404
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    const note = page.getByTestId('calendar-holiday-note')
    await expect(note).toContainText('尚未公布')
    await expect(note).toHaveClass(/text-stone-400/)
  })

  test('mock 404 且年度早於當前年度（<currentYear）：note 顯示無資料來源', async ({ page }) => {
    // onboard 2023-06-01 + frozen "today" 2025-06-15 -> three periods
    // (6~12mo, 12~24mo, 24~36mo); the middle one (2024-06-01~2025-05-31,
    // labeled "2024–25") doesn't contain "today" so its default visible
    // month falls back to its own start month, June 2024.
    await freezeTime(page)
    await mockHolidayCdn(page) // default handler: every year 404
    await seedAppStorage(page, {
      settings: { ...BASE_SETTINGS, onboardDate: '2023-06-01' },
      records: [],
    })
    await page.goto('/')

    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    const note = page.getByTestId('calendar-holiday-note')
    await expect(note).toContainText('無國定假日資料來源')
    await expect(note).toHaveClass(/text-stone-400/)
  })

  test('error 狀態：自動重試 3 次後顯示點此重試，重試成功後恢復', async ({ page }) => {
    await freezeTime(page)
    let callCountFor2025 = 0
    await mockHolidayCdn(page, (year) => {
      if (year !== 2025) return { status: 404 }
      callCountFor2025 += 1
      return 'abort'
    })
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    await expect.poll(() => callCountFor2025).toBe(1)
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('載入中')

    await page.clock.runFor(2000)
    await expect.poll(() => callCountFor2025).toBe(2)

    await page.clock.runFor(5000)
    await expect.poll(() => callCountFor2025).toBe(3)

    const note = page.getByTestId('calendar-holiday-note')
    await expect(note).toContainText('載入失敗')
    await expect(note).toHaveClass(/text-red-600/)
    const retryButton = page.getByRole('button', { name: '點此重試' })
    await expect(retryButton).toBeVisible()

    // Flip the handler to succeed, then use the retry button.
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025) } : { status: 404 }
    )
    await retryButton.click()
    await expect(note).toContainText('已載入')
  })

  test('minDetail="month"：導覽列標籤停用，無法鑽到年/年代檢視', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    await expect(page.locator('.react-calendar__month-view')).toBeVisible()
    // react-calendar disables the navigation label itself once there's
    // nowhere above "month" to drill up to (minDetail="month" === the
    // default maxDetail), so there is no click path into a year/decade view.
    await expect(page.locator('.react-calendar__navigation__label')).toBeDisabled()
    await expect(page.locator('.react-calendar__year-view')).toHaveCount(0)
    await expect(page.locator('.react-calendar__decade-view')).toHaveCount(0)
  })

  test('切換月份跨到另一狀態不同的 mock 年度時，note 文案正確切換', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025) } : { status: 404 }
    )
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')

    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')

    // Period runs through 2026-05-31, so 7 clicks (Jun -> Jan) crosses into
    // the 2026 mock year, which 404s (pending, since 2026 >= currentYear).
    const nextButton = page.locator('.react-calendar__navigation__next-button')
    for (let i = 0; i < 7; i++) await nextButton.click()

    await expect(page.locator('.react-calendar__navigation__label')).toContainText('2026')
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('尚未公布')
  })

  test.describe('Settings：清除國定假日快取', () => {
    test('清除後回首頁才重新觸發抓取，單純重新掛載不會', async ({ page }) => {
      await freezeTime(page)
      let callCountFor2025 = 0
      let resolveSecondRequest
      await mockHolidayCdn(page, (year) => {
        if (year !== 2025) return { status: 404 }
        callCountFor2025 += 1
        if (callCountFor2025 === 1) return { status: 200, body: buildHolidayYearBody(2025) }
        return new Promise((resolve) => { resolveSecondRequest = resolve })
      })
      await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
      await page.goto('/')
      await expect.poll(() => callCountFor2025).toBe(1)

      // Negative control: a plain 設定 -> 首頁 round trip (no clear) must not
      // trigger a 2nd request -- 2025 is already `available` and fresh.
      await page.getByRole('button', { name: '設定' }).click()
      await page.getByRole('button', { name: '首頁' }).click()
      await page.waitForTimeout(300)
      expect(callCountFor2025).toBe(1)

      await page.getByRole('button', { name: '設定' }).click()
      await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeEnabled()
      await page.getByRole('button', { name: '清除國定假日快取' }).click()
      await expect(page.getByText('將清除國定假日快取，未來使用時將觸發重新下載')).toBeVisible()
      await page.getByRole('button', { name: '確定清空' }).click()

      // Stays on Settings; the holiday-only button is immediately disabled,
      // the all-data button stays enabled (settings/records untouched).
      await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
      await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeEnabled()

      await page.getByRole('button', { name: '首頁' }).click()
      await expect.poll(() => callCountFor2025).toBe(2)
      await expect(page.getByTestId('calendar-holiday-note')).toContainText('載入中')

      resolveSecondRequest({ status: 200, body: buildHolidayYearBody(2025) })
    })
  })

  test.describe('Settings：清除所有本機資料', () => {
    test('情境 A：完全未設定到職日時，兩顆清除按鈕皆 disabled', async ({ page }) => {
      await freezeTime(page)
      await mockHolidayCdn(page)
      await page.goto('/')
      await page.getByRole('button', { name: '前往設定' }).click()

      await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeDisabled()
    })

    test('情境 B：清除所有本機資料後導回首頁並顯示 EmptyState', async ({ page }) => {
      await freezeTime(page)
      await mockHolidayCdn(page)
      await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
      await page.goto('/')

      await page.getByRole('button', { name: '設定' }).click()
      await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeEnabled()
      await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeEnabled()

      await page.getByRole('button', { name: '清除所有本機資料' }).click()
      await expect(page.getByText('將清空所有資料，請自行備份重要資訊')).toBeVisible()
      await page.getByRole('button', { name: '確定清空' }).click()

      await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
    })

    test('情境 C：離職後假日快取仍 enabled，清除假日快取後兩顆才一起變 disabled', async ({ page }) => {
      await freezeTime(page)
      await mockHolidayCdn(page)
      await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
      await page.goto('/')

      await page.getByRole('button', { name: '設定' }).click()
      await page.getByRole('button', { name: '離職重來' }).click()
      await page.getByRole('button', { name: '確定' }).click()
      await page.getByRole('button', { name: '確定清空' }).click()

      await page.getByRole('button', { name: '前往設定' }).click()
      // hasAnyAppData() is now false (settings/records cleared by resign),
      // but the holiday cache -- untouched by resign -- still has entries.
      await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeEnabled()

      await page.getByRole('button', { name: '清除國定假日快取' }).click()
      await page.getByRole('button', { name: '確定清空' }).click()

      await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeDisabled()
    })
  })

  test('離職彈窗顯示國定假日快取不受影響的說明；離職後 localStorage 中的假日快取仍存在', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025) } : { status: 404 }
    )
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')

    await page.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()

    await expect(
      page.getByText('（不含瀏覽器暫存的國定假日資料；如需一併清除請至設定頁「清除所有本機資料」）')
    ).toBeVisible()

    await page.getByRole('button', { name: '確定清空' }).click()
    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()

    const holidayKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith('leaveCalculator_holidayCache_'))
    )
    expect(holidayKeys.length).toBeGreaterThan(0)
  })

  test('loading 狀態下圓點暫時只跳過週末，fetch 成功後 note 與圓點自動更新', async ({ page }) => {
    await freezeTime(page)
    let resolveYear2025
    const deferred2025 = new Promise((resolve) => { resolveYear2025 = resolve })
    await mockHolidayCdn(page, (year) => (year === 2025 ? deferred2025 : { status: 404 }))
    // 2025-06-17 (Tue) + 2 days: once 2025-06-18 is known to be a holiday it
    // should extend onto the 19th; until then (fallback) it stays on the 18th.
    await seedAppStorage(page, {
      settings: BASE_SETTINGS,
      records: [{ id: 'r1', startDate: '2025-06-17', days: 2 }],
    })
    await page.goto('/')

    await expect(page.getByTestId('calendar-holiday-note')).toContainText('載入中')
    const day18Loading = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) + ' 已登記請假', exact: true })
    await expect(day18Loading.locator('.leave-dot')).toBeVisible()

    const staleResponse = page.waitForResponse((res) => /2025\.json/.test(res.url()))
    resolveYear2025({ status: 200, body: buildHolidayYearBody(2025, ['2025-06-18']) })
    const resp = await staleResponse
    await resp.finished()

    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')
    const day19 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 19 }) + ' 已登記請假', exact: true })
    await expect(day19.locator('.leave-dot')).toBeVisible()
    const day18 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }), exact: true })
    await expect(day18.locator('.leave-dot')).toHaveCount(0)
  })

  test('期間外的日期（含週末與假日）一律顯示淡灰，不受假日或週末樣式影響', async ({ page }) => {
    // onboardDate on the 15th (not the 1st) -> the newest period starts
    // exactly on FIXED_TODAY (2025-06-15), so June 1st~14th 2025 render as
    // out-of-period tiles in the same visible month.
    await freezeTime(page)
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025, ['2025-06-04']) } : { status: 404 }
    )
    await seedAppStorage(page, {
      settings: { ...BASE_SETTINGS, onboardDate: '2024-06-15' },
      records: [],
    })
    await page.goto('/')

    // 2025-06-04 (Wed, out-of-period, marked isHoliday in the mock) and
    // 2025-06-07 (Sat, out-of-period, auto-covered by buildHolidayYearBody)
    // must both show the paler out-of-period gray, not holiday dark-red or
    // plain weekend gray.
    const outOfPeriodHoliday = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 4 }) })
    await expect(outOfPeriodHoliday).toHaveCSS('color', 'rgb(209, 213, 219)')

    const outOfPeriodWeekend = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 7 }) })
    await expect(outOfPeriodWeekend).toHaveCSS('color', 'rgb(209, 213, 219)')
  })

  test('清除所有本機資料時仍在飛行中的舊 fetch，resolve 後不會復活快取或讓按鈕誤判為 enabled', async ({ page }) => {
    await freezeTime(page)
    let resolveYear2025
    const deferred2025 = new Promise((resolve) => { resolveYear2025 = resolve })
    let callCountFor2025 = 0
    await mockHolidayCdn(page, (year) => {
      if (year !== 2025) return { status: 404 }
      callCountFor2025 += 1
      return deferred2025
    })
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')
    await expect.poll(() => callCountFor2025).toBe(1)

    await page.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: '清除所有本機資料' }).click()
    await page.getByRole('button', { name: '確定清空' }).click()
    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()

    const staleResponse = page.waitForResponse((res) => /2025\.json/.test(res.url()))
    resolveYear2025({ status: 200, body: buildHolidayYearBody(2025, ['2025-01-01']) })
    const resp = await staleResponse
    await resp.finished()
    await page.waitForTimeout(200)

    await page.getByRole('button', { name: '前往設定' }).click()
    await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeDisabled()
    await expect
      .poll(() => page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('leaveCalculator_holidayCache_'))
      ))
      .toEqual([])
  })

  test('清除國定假日快取後立刻觸發新請求，過期的舊請求不會誤判 in-flight guard 或覆蓋新結果', async ({ page }) => {
    await freezeTime(page)
    let resolveA, resolveB
    const deferredA = new Promise((r) => { resolveA = r })
    const deferredB = new Promise((r) => { resolveB = r })
    let callCountFor2025 = 0
    await mockHolidayCdn(page, (year) => {
      if (year !== 2025) return { status: 404 }
      callCountFor2025 += 1
      return callCountFor2025 === 1 ? deferredA : deferredB
    })
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')
    await expect.poll(() => callCountFor2025).toBe(1)

    await page.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: '清除國定假日快取' }).click()
    await page.getByRole('button', { name: '確定清空' }).click()

    await page.getByRole('button', { name: '首頁' }).click()
    await expect.poll(() => callCountFor2025).toBe(2)

    const responseA = page.waitForResponse((res) => /2025\.json/.test(res.url()))
    resolveA({ status: 200, body: buildHolidayYearBody(2025, ['2025-06-18']) }) // X 日
    const respA = await responseA
    await respA.finished()
    await page.waitForTimeout(200)
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('載入中')
    await expect(
      page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
    ).not.toHaveClass(/react-calendar__tile--holiday/)

    await page.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: '首頁' }).click()
    await page.waitForTimeout(200)
    expect(callCountFor2025).toBe(2)

    const responseB = page.waitForResponse((res) => /2025\.json/.test(res.url()))
    resolveB({ status: 200, body: buildHolidayYearBody(2025, ['2025-06-19']) }) // Y 日
    const respB = await responseB
    await respB.finished()
    await page.waitForTimeout(200)
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')
    await expect(
      page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 19 }) })
    ).toHaveClass(/react-calendar__tile--holiday/)
    await expect(
      page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
    ).not.toHaveClass(/react-calendar__tile--holiday/)

    expect(callCountFor2025).toBe(2)
  })

  test('跨年午夜：視覺月份不受影響，note 反映凍結後的 visibleMonth 而非 fallback 誤判', async ({ page }) => {
    // onboard 2020-07-01 + frozen "today" 2025-12-31 23:59:30 -> newest
    // period is 2025-07-01~2026-06-30, containing "today" -> default visible
    // month is December 2025. Crossing midnight must not change which month
    // the calendar shows, nor which year's holiday status the note reads.
    const MIDNIGHT_SETTINGS = { onboardDate: '2020-07-01', ruleType: 'labor', customRules: [], allowCarryover: false }
    await freezeTime(page, '2025-12-31T23:59:30')
    await mockHolidayCdn(page, (year) =>
      year === 2025 ? { status: 200, body: buildHolidayYearBody(2025) } : { status: 404 }
    )
    await seedAppStorage(page, { settings: MIDNIGHT_SETTINGS, records: [] })
    await page.goto('/')

    await expect(page.locator('.react-calendar__navigation__label')).toContainText('2025')
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')

    // Past midnight and past useToday's 60s poll interval.
    await page.clock.runFor(90_000)

    await expect(page.locator('.react-calendar__navigation__label')).toContainText('2025')
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')
  })
})
