import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'

test('a record above 30 days is valid when covered by the entitlement', async ({ page }) => {
  await freezeTime(page)
  await seedAppStorage(page, {
    settings: {
      onboardDate: '2024-06-15', ruleType: 'custom', allowCarryover: false,
      customRules: [{ id: 'generous', months: 6, days: 60 }],
      customGrowth: { perYear: 0, cap: 0 },
    },
    records: [],
  })
  await page.goto('/')
  await page.locator('input[type="date"]').fill('2025-06-20')
  const days = page.locator('input[type="number"]').first()
  await days.fill('60')
  expect(await days.evaluate(input => input.checkValidity())).toBe(true)
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(page.getByTestId('summary-taken')).toContainText('60')
  await expect(page.getByTestId('record-days')).toContainText('60 天')

  await page.locator('input[type="date"]').fill('2025-06-23')
  await days.fill('0.25')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(page.getByText('這筆請假超支可用額度上限，請確認天數是否正確')).toBeVisible()
  await expect(page.getByTestId('record-days')).toHaveCount(1)
})

test('custom entitlement input rejects zero but accepts a quarter day', async ({ page }) => {
  await freezeTime(page)
  await page.goto('/')
  await page.getByRole('button', { name: '前往設定' }).click()
  await page.getByRole('button', { name: '公司另有規定' }).click()
  const days = page.getByTestId('custom-rule-row').first().locator('input[step="0.25"]')
  await days.fill('0')
  expect(await days.evaluate(input => input.validity.rangeUnderflow)).toBe(true)
  await days.fill('0.25')
  expect(await days.evaluate(input => input.checkValidity())).toBe(true)
  // Zero growth remains a supported, separate setting.
  await page.getByLabel('每年增加天數').fill('0')
  expect(await page.getByLabel('每年增加天數').evaluate(input => input.checkValidity())).toBe(true)
})
