import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage, zhDayLabel } from './helpers.js'

// onboard 2024-06-15 + frozen "today" 2025-06-15 -> exactly 12 completed
// months -> current period is 2025-06-15 ~ 2026-06-14, entitled 7 days.
const BASE_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

test.describe('月曆互動與請假記錄 CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    await seedAppStorage(page, { settings: BASE_SETTINGS, records: [] })
    await page.goto('/')
  })

  test('月曆顯示週首標題列（7 欄）且區間外日期不可點擊', async ({ page }) => {
    const weekdays = page.locator('.react-calendar__month-view__weekdays__weekday')
    await expect(weekdays).toHaveCount(7)

    // June 1st 2025 is before the period start (2025-06-15) and should be
    // rendered disabled / out-of-period. Targeted by its accessible name
    // (confirmed via a real Playwright snapshot: react-calendar gives each
    // day tile an aria-label of the full "YYYY年M月D日" date), not by
    // guessing at visible text formatting.
    const juneFirst = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 1 }), exact: true })
    await expect(juneFirst).toHaveClass(/react-calendar__tile--out-of-period/)
  })

  test('點擊月曆日期會帶入表單的開始日期', async ({ page }) => {
    const day20 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 20 }), exact: true })
    await day20.click()

    await expect(page.locator('input[type="date"]')).toHaveValue('2025-06-20')
  })

  test('新增請假記錄後：清單出現、月曆綠點出現、已休天數更新', async ({ page }) => {
    // Fill the date directly rather than clicking the calendar tile here --
    // clicking the tile itself is already covered end to end by the
    // dedicated test above, so this one can focus purely on the CRUD +
    // summary-update behaviour without depending on the calendar too.
    await page.locator('input[type="date"]').fill('2025-06-20')
    await page.getByRole('button', { name: '2天', exact: true }).click()
    await page.getByRole('button', { name: '新增', exact: true }).click()

    await expect(page.getByText('2025-06-20')).toBeVisible()
    await expect(page.getByTestId('summary-taken')).toContainText('2')

    // The calendar tile for the 20th should now show the leave dot.
    const tile20 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 20 }), exact: true })
    await expect(tile20.locator('.leave-dot')).toBeVisible()
  })

  test('多天請假記錄跨越週末時：週末不標圓點，週末後的工作日仍標圓點', async ({ page }) => {
    // 2025-06-20 is a Friday. 3 days -> Fri(20), skip Sat(21)/Sun(22), Mon(23), Tue(24).
    await page.locator('input[type="date"]').fill('2025-06-20')
    await page.locator('input[type="number"]').first().fill('3')
    await page.getByRole('button', { name: '新增', exact: true }).click()

    await expect(page.getByText('2025-06-20')).toBeVisible()

    const tile20 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 20 }), exact: true })
    const tile21 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 21 }), exact: true })
    const tile22 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 22 }), exact: true })
    const tile23 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 23 }), exact: true })
    const tile24 = page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 24 }), exact: true })

    await expect(tile20.locator('.leave-dot')).toBeVisible()
    await expect(tile21.locator('.leave-dot')).toHaveCount(0)
    await expect(tile22.locator('.leave-dot')).toHaveCount(0)
    await expect(tile23.locator('.leave-dot')).toBeVisible()
    await expect(tile24.locator('.leave-dot')).toBeVisible()
  })

  test('編輯既有記錄：帶入原值、修改後清單與首頁同步更新', async ({ page }) => {
    await seedAppStorage(page, {
      settings: BASE_SETTINGS,
      records: [{ id: 'r1', startDate: '2025-06-20', days: 2 }],
    })
    await page.reload()

    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.locator('input[type="date"]')).toHaveValue('2025-06-20')
    await expect(page.locator('input[type="number"]').first()).toHaveValue('2')

    await page.locator('input[type="number"]').first().fill('3')
    await page.getByRole('button', { name: '儲存變更' }).click()

    await expect(page.getByTestId('record-days')).toContainText('3 天')
    await expect(page.getByTestId('summary-taken')).toContainText('3')
  })

  test('刪除記錄：清單移除、月曆綠點消失、天數回復', async ({ page }) => {
    await seedAppStorage(page, {
      settings: BASE_SETTINGS,
      records: [{ id: 'r1', startDate: '2025-06-20', days: 2 }],
    })
    await page.reload()

    await page.getByRole('button', { name: '刪除' }).click()

    await expect(page.getByText('本週年度尚無請假記錄')).toBeVisible()
    await expect(page.getByTestId('summary-taken')).toContainText('0')
  })

  test('日期超出當前週期範圍時顯示錯誤，不允許送出', async ({ page }) => {
    // 2025-06-01 is before periodStart (2025-06-15).
    await page.locator('input[type="date"]').fill('2025-06-01')
    await page.getByRole('button', { name: '新增', exact: true }).click()

    await expect(page.getByText('日期必須在本週年度範圍內')).toBeVisible()
    await expect(page.getByText('本週年度尚無請假記錄')).toBeVisible()
  })

  test('天數超出本期額度上限時顯示錯誤，不允許送出', async ({ page }) => {
    // Current period entitlement is 7 days (12mo milestone); allowCarryover is
    // false, so the overspend guard is exactly the period's own entitlement.
    await page.locator('input[type="date"]').fill('2025-06-20')
    await page.locator('input[type="number"]').first().fill('11')
    await page.getByRole('button', { name: '新增', exact: true }).click()

    await expect(page.getByText('這筆請假超支可用額度上限，請確認天數是否正確')).toBeVisible()
    await expect(page.getByText('本週年度尚無請假記錄')).toBeVisible()
  })

  test('天數輸入框：清空欄位不會被強制填回 0', async ({ page }) => {
    const daysInput = page.locator('input[type="number"]').first()
    await daysInput.fill('3')
    await daysInput.fill('')

    await expect(daysInput).toHaveValue('')
  })

  test('天數輸入框：可以逐字元打出完整的小數（不會在打出小數點時被吃掉）', async ({ page }) => {
    const daysInput = page.locator('input[type="number"]').first()
    await daysInput.fill('')
    await daysInput.pressSequentially('4.75')

    await expect(daysInput).toHaveValue('4.75')
  })

  test('月曆說明揭露圓點未考慮國定假日與補班日', async ({ page }) => {
    // Only match the keyword, not the full sentence, so a copy tweak doesn't
    // break this test.
    await expect(page.getByTestId('calendar-holiday-note')).toContainText('國定假日')
  })
})

test.describe('資料持久化', () => {
  test('新增記錄並重新整理頁面後，資料仍然存在', async ({ page }) => {
    await freezeTime(page)
    // Only seed settings here (not records): this init script re-fires on
    // page.reload() below, and we specifically want the record we add via
    // the UI to survive that reload untouched. See the warning in
    // seedAppStorage's doc comment.
    await seedAppStorage(page, { settings: BASE_SETTINGS })
    await page.goto('/')

    await page.locator('input[type="date"]').fill('2025-06-20')
    await page.getByRole('button', { name: '1天', exact: true }).click()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByText('2025-06-20')).toBeVisible()

    await page.reload()

    await expect(page.getByText('2025-06-20')).toBeVisible()
    await expect(page.getByTestId('summary-taken')).toContainText('1')
  })
})
