import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage, mockHolidayCdn } from './helpers.js'

test.describe('頁尾', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
  })

  test('顯示最後更新日、免責聲明與 GitHub 連結', async ({ page }) => {
    // The footer is rendered at the App level regardless of page state, so
    // no settings need to be seeded for this one.
    await page.goto('/')

    // VITE_BUILD_DATE is injected at build time by playwright.config.js's
    // webServer.env, fixed to 2025-06-15 for this test suite.
    await expect(page.getByText('最後更新：2025-06-15')).toBeVisible()
    await expect(
      page.getByText('本網頁依據最後更新日當時最新的中華民國勞動基準法設計')
    ).toBeVisible()

    const githubLink = page.getByRole('link', { name: 'GitHub' })
    await expect(githubLink).toBeVisible()
    await expect(githubLink).toHaveAttribute('href', 'https://github.com/corytu/annual-leave-calculator')
  })

  test('本年度週年制區間文字存在且日期正確', async ({ page }) => {
    // onboard 2024-06-15 + frozen "today" 2025-06-15 -> current period
    // 2025-06-15 ~ 2026-06-14.
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2024-06-15',
        ruleType: 'labor',
        customRules: [],
        allowCarryover: false,
      },
    })
    await page.goto('/')

    await expect(page.getByText('本年度週年制區間：')).toBeVisible()
    await expect(page.getByText('2025-06-15', { exact: true })).toBeVisible()
    await expect(page.getByText('2026-06-14', { exact: true })).toBeVisible()
  })
})
