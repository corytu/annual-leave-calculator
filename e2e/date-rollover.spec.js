import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'

const settings = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

test('an open tab gains the new anniversary period after midnight', async ({ page }) => {
  await freezeTime(page, '2025-06-14T23:59:30')
  await seedAppStorage(page, { settings, records: [] })
  await page.goto('/')
  const tabs = page.getByTestId('period-tabs').getByRole('button')
  await expect(tabs).toHaveCount(1)

  await page.clock.runFor(60_000)
  await expect(tabs).toHaveCount(2)
  await page.getByTestId('period-tabs').getByRole('button', { name: '2025–26', exact: true }).click()
  await expect(page.getByTestId('summary-entitled')).toContainText('7')

  // Validation must agree with the newly displayed period without a reload.
  await page.locator('input[type="date"]').fill('2025-06-15')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(page.getByTestId('summary-taken')).toContainText('1')
})

test('reaching the first entitlement while the tab stays open leaves the empty state', async ({ page }) => {
  await freezeTime(page, '2024-12-14T23:59:30')
  await seedAppStorage(page, { settings, records: [] })
  await page.goto('/')
  await expect(page.getByTestId('summary-entitled')).toHaveCount(0)

  await page.clock.runFor(60_000)
  await expect(page.getByTestId('summary-entitled')).toContainText('3')
})
