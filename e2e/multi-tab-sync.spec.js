import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage, mockHolidayCdn } from './helpers.js'

// onboard 2024-06-15 + frozen "today" 2025-06-15 -> current period is
// 2025-06-15 ~ 2026-06-14, entitled 7 days (same fixture as
// calendar-and-records.spec.js).
const BASE_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

// Both pages share one browser context, hence one localStorage, and a write
// in one page fires a `storage` event in the other -- exactly like two real
// tabs. Only the first page is seeded: seedAppStorage() uses addInitScript,
// which would re-run (and reset storage) on every navigation of that page,
// so assertions below read localStorage via page.evaluate instead of
// reloading.
async function openSecondTab(page) {
  const other = await page.context().newPage()
  await freezeTime(other)
  await mockHolidayCdn(other)
  await other.goto('/')
  return other
}

async function readStorage(page) {
  return page.evaluate(() => ({
    settings: window.localStorage.getItem('leaveCalculator_settings'),
    records: window.localStorage.getItem('leaveCalculator_records'),
  }))
}

async function addRecord(page, startDate, dayChip) {
  await page.locator('input[type="date"]').fill(startDate)
  await page.getByRole('button', { name: dayChip, exact: true }).click()
  await page.getByRole('button', { name: '新增', exact: true }).click()
}

test.describe('多分頁資料同步', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
  })

  test('另一分頁新增的紀錄會即時出現，且不會被這個分頁的新增覆蓋', async ({ page }) => {
    await seedAppStorage(page, { settings: BASE_SETTINGS })
    await page.goto('/')
    const other = await openSecondTab(page)

    await addRecord(other, '2025-06-20', '2天')

    // Shows up in the first tab without a reload.
    await expect(page.getByText('2025-06-20')).toBeVisible()
    await expect(page.getByTestId('summary-taken')).toContainText('2')

    await addRecord(page, '2025-07-01', '1天')
    await expect(page.getByTestId('summary-taken')).toContainText('3')

    const { records } = await readStorage(page)
    const startDates = JSON.parse(records).map(r => r.startDate).sort()
    expect(startDates).toEqual(['2025-06-20', '2025-07-01'])
  })

  test('另一分頁「清除所有本機資料」後，這個分頁回到空狀態，舊資料不會被寫回', async ({ page }) => {
    await seedAppStorage(page, { settings: BASE_SETTINGS })
    await page.goto('/')
    const other = await openSecondTab(page)

    // Give the first tab a record of its own so there is something to resurrect.
    await addRecord(page, '2025-06-20', '1天')
    await expect(other.getByText('2025-06-20')).toBeVisible()

    await other.getByRole('button', { name: '設定' }).click()
    await other.getByRole('button', { name: '清除所有本機資料' }).click()
    await other.getByRole('button', { name: '確定清空' }).click()

    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
    const stored = await readStorage(page)
    expect(stored.settings).toBeNull()
    expect(stored.records).toBeNull()
  })

  test('停在設定頁時，另一分頁儲存設定會讓這裡顯示最新且已鎖定的設定', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()
    await expect(page.locator('input[type="date"]')).toBeEnabled()

    const other = await openSecondTab(page)
    await other.getByRole('button', { name: '前往設定' }).click()
    await other.locator('input[type="date"]').fill('2024-06-15')
    await other.getByRole('button', { name: '儲存設定' }).click()

    await expect(page.locator('input[type="date"]')).toHaveValue('2024-06-15')
    await expect(page.locator('input[type="date"]')).toBeDisabled()
    await expect(page.getByRole('button', { name: '離職重來' })).toBeEnabled()
  })
})
