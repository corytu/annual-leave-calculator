import { test, expect } from '@playwright/test'
import { freezeTime } from './helpers.js'

test.describe('首次使用與設定流程', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
  })

  test('首次進入（無資料）顯示尚未設定到職日的空狀態', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
    await expect(page.getByText('請先在設定頁填寫您的到職日與特休規則。')).toBeVisible()
    await expect(page.getByRole('button', { name: '前往設定' })).toBeVisible()
  })

  test('透過空狀態按鈕前往設定頁，用月曆選取到職日並儲存後導回首頁', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()

    // Open the onboard-date picker and select 2023-06-15 (exactly 24 completed
    // months before the frozen "today" of 2025-06-15 -> milestone 24, 10 days).
    await page.locator('input[type="date"]').fill('2023-06-15')
    await expect(page.locator('input[type="date"]')).toHaveValue('2023-06-15')

    await page.getByRole('button', { name: '儲存設定' }).click()

    // Back on the main page.
    await expect(page.getByText('到職日：')).toBeVisible()
    await expect(page.getByText('本年度週年制區間：')).toBeVisible()
    await expect(page.getByTestId('summary-entitled')).toContainText('10')
  })
})

test.describe('特休規則設定', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    // No seeded settings: once onboardDate is saved, the settings page locks
    // and the rule editor becomes read-only (see resignation.spec.js), so the
    // only place left to exercise rule-editing is before the first save.
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()
  })

  test('預設顯示勞基法對照表', async ({ page }) => {
    await expect(page.getByText('滿 6 月未滿 12 月')).toBeVisible()
    await expect(page.getByText('滿 12 月未滿 24 月')).toBeVisible()
  })

  test('切換到公司另有規定顯示自訂規則編輯區', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '新增規則' })).toBeVisible()
    await expect(page.getByText('滿幾個月後')).toBeVisible()
  })

  test('自訂天數低於勞基法最低標準時顯示警告', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // The 12-month row defaults to 7 days (matching labor law). Lower it to 5.
    const row = page.locator('table tbody tr').filter({ has: page.locator('input[value="12"]') })
    await row.locator('input[step="0.25"]').fill('5')

    await expect(page.getByText('以下規則低於勞基法最低標準')).toBeVisible()
    await expect(page.getByText('滿 12 個月：您設定 5 天，勞基法最低 7 天')).toBeVisible()
  })

  test('刪除自訂規則後列表更新', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()
    const rows = page.locator('table tbody tr')
    const before = await rows.count()

    await rows.first().getByRole('button', { name: '刪除此規則' }).click()

    await expect(rows).toHaveCount(before - 1)
  })

  test('儲存自訂規則後首頁天數依自訂規則顯示', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Bump the 12-month row's days from 7 to 20 so we can assert the exact
    // custom value (rather than a value that happens to match labor law).
    const row = page.locator('table tbody tr').filter({ has: page.locator('input[value="12"]') })
    await row.locator('input[step="0.25"]').fill('20')

    // Filling the onboard date is only a necessary precondition for the save
    // to go through (settings are unlocked here, before any first save) --
    // this test's only assertion focus stays on the custom rule taking effect.
    await page.locator('input[type="date"]').fill('2024-06-15') // 12 months before frozen "today"
    await page.getByRole('button', { name: '儲存設定' }).click()

    await expect(page.getByTestId('summary-entitled')).toContainText('20')
  })
})
