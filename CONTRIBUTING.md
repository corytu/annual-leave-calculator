# 貢獻指南

感謝你願意為 annual-leave-calculator 貢獻！本文件說明回報問題、開發環境設定，以及提交 Pull Request 的流程與規範。

## 回報問題與提出建議

發現 bug 或有功能建議，歡迎直接開一個 Issue 描述問題或需求。

## 開發環境設定

詳細環境設定（含 Dev Container）請參考 README 的[本地端開發](README.md#本地端開發)一節。若已具備 Node.js 22.12+（建議 24，見 [`.nvmrc`](.nvmrc)）與 npm，最快的方式：

```shell
npm ci
npm run dev
```

## 開發流程

1. Fork 本專案，並從 `master` 建立新分支進行修改
2. Commit 訊息採祈使句、簡短描述變更即可（例如 `Fix growth-row threshold consistency`），不需要 Conventional Commits 前綴
   - 若變更與某個 Issue 有關，但該 commit 本身不會解決它，可在訊息中加註 `Refs #X`
   - 若變更會解決該 Issue，改用 closing keyword（如 `Fixes #X`），PR 合併後會自動關閉對應 Issue；同時對應多個 Issue 時，需重複 closing keyword，例如 `Fixes #X; fixes #Y`
   - Issue reference 建議放在 commit 訊息最後一行，訊息主體仍優先描述「做了什麼變更」
3. 推送分支並開啟 Pull Request，目標分支為 `master`

## 測試

送出 PR 前，請確保下列測試皆能通過：

```shell
npm run test:coverage   # 單元測試 + 涵蓋率報告
npx playwright install --with-deps chromium  # 首次執行 e2e 前需安裝瀏覽器
npm run test:e2e        # 端對端測試
```

這兩項測試對應 CI 中的 `unit-and-e2e-test` 檢查(見 [`.github/workflows/pr-checks.yml`](.github/workflows/pr-checks.yml))，是合併前必要的狀態檢查之一。CI 還會將 `test:coverage` 產生的 `coverage/cobertura-coverage.xml` 上傳至 [Codecov](https://about.codecov.io/)，PR 會有 Codecov 留言顯示涵蓋率變化，且 `codecov/patch` 檢查也是合併前必要的狀態檢查（見下方「Pull Request 合併規範」）。

單元測試涵蓋範圍僅限 `src/utils/**`（純邏輯層，見 [`vitest.config.js`](vitest.config.js)）；若新增或修改此目錄下的邏輯，請一併補上對應測試。

## Pull Request 合併規範

`master` 分支設有分支保護規則，PR 需符合下列條件才能合併：

- **審查核准**：至少需要 1 位審查者核准。核准後若再推送新的 commit，先前的核准會自動被撤銷，需重新取得核准
- **討論串需全部解決**：PR 中所有審查留言的討論串都必須標示為已解決
- **狀態檢查需全部通過，且分支需與 `master` 同步**：
  - `unit-and-e2e-test`（Vitest 單元測試 + Playwright 端對端測試）
  - `Analyze (javascript-typescript)`、`Analyze (actions)`（GitHub CodeQL 程式碼掃描，自動執行，無需額外設定）
  - `codecov/patch`（[Codecov](https://about.codecov.io/) 涵蓋率檢查，見下方「程式碼涵蓋率門檻」）
  - 上述檢查採 strict 模式，若 `master` 有新進度，可能需要先合併或 rebase 最新的 `master`
- **程式碼掃描門檻**：CodeQL 掃描出 high 以上等級的安全性警示，或 error 等級的一般性警示，皆會擋下合併
- **程式碼涵蓋率門檻**：由 Codecov 的 `codecov/patch` 檢查把關，針對 PR 修改行（範圍限 `src/utils/**`）的涵蓋率須達 90%，可容忍下降 3 個百分點（設定見 [`.github/codecov.yml`](.github/codecov.yml)）
- **合併方式**：允許 Merge commit、Rebase 或 Squash merge
- `master` 分支本身禁止刪除，也不允許 force-push

以上規則主要由 CI 與 GitHub 分支保護規則自動把關，一般貢獻者只需確保測試通過、回覆並解決審查討論串，並等待審查核准即可。

## 程式碼風格

目前專案未設定 ESLint／Prettier 等自動化工具，請盡量遵循現有程式碼的風格與慣例（既有的元件與 utils 結構）撰寫程式碼。

## 國定假日資料維護

國定假日資料取自 [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar)，已抓取成功的年度會永久快取在使用者的瀏覽器中，不會自動重新下載。若政府修改已公布年度的辦公日曆表（例如修法新增國定假日），或資料源的既有檔案有誤並已修正，請將 `src/utils/holidayCache.js` 的 `HOLIDAY_CACHE_VERSION` 加一並重新部署，所有使用者下次開啟網站時會自動重新下載。

## 授權

提交至本專案的貢獻，將以與本專案相同的 [MIT 授權](LICENSE.txt) 釋出。

## AI 輔助開發

本專案開發過程中有使用 AI 工具輔助（詳見 README 的 [AI 免責聲明](README.md#ai-免責聲明)）。若你的貢獻也使用 AI 工具協助撰寫，請在提交前自行審閱、測試程式碼正確性，並確保沒有引入授權或資安疑慮；PR 中無需特別聲明，但仍需對變更內容負完整責任。
