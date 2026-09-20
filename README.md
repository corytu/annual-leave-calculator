# annual-leave-calculator

簡單的個人特休計算機，用來管理自己的休假記錄，並快速掌握剩餘可休天數。

> 本專案為原 Python CLI 工具（`calculator.py`）的全面重寫版本，以 React 靜態網頁應用程式取代，並部署於 GitHub Pages。

## 功能特色

- **週年制計算**：依據到職日，逐年計算每個週年區間的特休天數，符合《勞動基準法》第 38 條規定
- **勞基法自動套用**：預設依法定最低標準計算（6 個月、1 年、2 年、3 年、5 年、10 年以上各階段）
- **公司自訂規則**：可設定各年資門檻的特休天數，並於低於勞基法最低標準時顯示警告
- **假期遞延（Carryover）**：可選擇性開啟，逐年串接計算（chained ledger）遞延天數；每期優先扣抵上期帶入的餘額，用不完的部分視為已結清（不再繼續遞延），並顯示於首頁供對帳。系統也會檢查整條年資鏈，避免任何一期被扣到超過下一期額度的預支上限
- **請假記錄管理**：新增、編輯、刪除請假記錄，支援 0.25 天（2 小時）為最小單位
- **歷史期間瀏覽**：以頁籤切換各週年區間，可查看與編輯任一期間（不限當期）的請假記錄
- **月曆介面**：點擊日期快速新增記錄，並以圓點標示有請假記錄的日期
- **離職結清與重置**：設定頁提供「離職重來」功能，計算應結清工資天數（含遞延預支情況），並可於清空前匯出 CSV 備份，方便換工作後重新開始使用
- **本機儲存**：所有資料儲存於瀏覽器 `localStorage`，無需帳號、無後端

## 線上使用

👉 [https://corytu.github.io/annual-leave-calculator/](https://corytu.github.io/annual-leave-calculator/)

> 建議使用 Chrome 瀏覽器以獲得最佳體驗。

## 本地端開發

### 使用 Dev Container（建議）

最快的方式是使用 VS Code Dev Container，環境會自動安裝好 Node.js、npm 相依套件與 Playwright 瀏覽器。

**前置需求：**

- 已安裝 Docker（Docker Desktop 或相容的容器執行環境）
- VS Code，並安裝 [Dev Containers 擴充套件](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

**使用方式：**

1. 以 VS Code 開啟本專案
2. 執行指令面板的 `Dev Containers: Reopen in Container`（或依 VS Code 彈出的提示點擊）
3. 容器建立完成後，會自動執行 `npm ci` 與安裝 Playwright（含 Chromium）。啟動開發伺服器時請加上 `--host`，讓容器對外監聽，VS Code 才能將連接埠轉發到主機：

   ```shell
   npm run dev -- --host
   ```

> 此 Dev Container 內建 [Claude Code](https://claude.com/claude-code) CLI 工具，方便搭配 AI 輔助開發（例如下方「開發輔助工具」一節提到的 `agent-loop.sh`）。若要在容器內使用 `claude` 指令，需先在**主機**環境設定 `CLAUDE_CODE_OAUTH_TOKEN` 環境變數，容器會自動帶入；若只是開發計算機本身的功能，則不需要這個變數。

### 手動安裝

不使用 Dev Container 時，可依下列方式手動建置環境：

#### 環境需求

- Node.js 22.12+（建議 24，見 [.nvmrc](.nvmrc)）
- npm

#### 安裝與啟動

```shell
npm ci
npm run dev
```

開啟瀏覽器至 `http://localhost:5173/annual-leave-calculator/` 即可使用。

### 建置

```shell
npm run build
```

建置結果輸出至 `dist/` 目錄。

### 測試

```shell
npm run test          # 單元測試（Vitest）
npm run test:watch    # 單元測試（watch 模式）
npm run test:coverage # 單元測試涵蓋率報告
npm run test:e2e      # 端對端測試（Playwright）
```

執行 `test:e2e` 前，需先安裝 Playwright 瀏覽器（僅需執行一次）：

```shell
npx playwright install --with-deps chromium
```

## 部署與 CI

本專案使用 GitHub Actions 進行持續整合與部署：

- **PR 檢查**：每次對 `master` 分支發出 Pull Request 時，CI 會安裝相依套件並依序執行單元測試（Vitest）與端對端測試（Playwright），並將涵蓋率報告上傳至 [Codecov](https://about.codecov.io/) 供 PR 顯示涵蓋率變化。詳見 [`.github/workflows/pr-checks.yml`](.github/workflows/pr-checks.yml)。
- **自動部署**：每次推送至 `master` 分支時，CI 流程會：

  1. 安裝相依套件
  2. 注入建置日期（`VITE_BUILD_DATE`）至 `.env.production`
  3. 執行 `npm run build`
  4. 將 `dist/` 目錄上傳為 Pages 構件（`actions/upload-pages-artifact`）
  5. 透過 `actions/deploy-pages` 直接部署至 GitHub Pages（無需再推送至 `gh-pages` 分支）

  詳見 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。

## 技術架構

| 層面 | 技術 |
|------|------|
| 框架 | React 18 + Vite |
| 樣式 | Tailwind CSS |
| 日曆元件 | react-calendar |
| 資料持久化 | localStorage |
| 部署 | GitHub Pages（GitHub Actions） |

## 使用說明

1. 前往「設定」頁面，填寫**到職日**
2. 選擇適用的特休規則（勞基法或公司自訂）
3. 視需要開啟**假期遞延**選項
4. 儲存設定後回到首頁，即可查看本年度特休概況
5. 點擊月曆日期或使用表單新增請假記錄
6. 可透過首頁的期間頁籤切換查看或編輯歷史年資區間的請假記錄
7. 若離職或更換工作，可於「設定」頁使用「離職重來」功能結清並清空資料（建議先匯出 CSV 備份保存紀錄）

## 開發輔助工具

專案根目錄的 [`agent-loop.sh`](agent-loop.sh) 是這輪開發過程中用來自動化「Coder ⇄ Reviewer」多輪審查流程的輔助腳本，透過 Claude Code CLI 分別呼叫不同角色互相審查實作計畫與程式碼變更。它與特休計算機本身的功能沒有直接關聯，附在此處是為了讓有興趣的開發者檢閱這輪開發的協作方式，詳見 [docs/README-agent-loop.md](docs/README-agent-loop.md)。

## 貢獻

歡迎回報問題或提出 Pull Request。`master` 分支設有分支保護規則，PR 需符合以下條件才能合併：

- 至少 1 位審查者核准；核准後若再推送新的 commit，先前的核准會被撤銷，須重新取得核准
- PR 中所有審查討論串（conversation thread）皆已標示為已解決
- 狀態檢查全數通過：`unit-and-e2e-test`（單元測試 + 端對端測試）、`Analyze (javascript-typescript)`、`Analyze (actions)`（CodeQL 程式碼掃描）、`codecov/patch`（[Codecov](https://about.codecov.io/) 涵蓋率檢查），且分支需與 `master` 保持同步（strict 檢查）
- PR 修改行的程式碼涵蓋率（範圍限 `src/utils/**`）須達 90%，可容忍下降 3 個百分點，由 Codecov 的 `codecov/patch` 檢查把關
- 允許 Merge commit、Rebase 或 Squash 方式合併

詳細的開發流程與規範請參考 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

本專案以 [MIT 授權](LICENSE.txt) 釋出。

---

## AI 免責聲明

本專案在 2026 年的重寫過程中使用了 AI 輔助工具（包含 Claude、Gemini 等）協助撰寫程式碼、產生文件草稿與除錯建議。

### 使用範疇

AI 工具主要用於以下用途：

- 架構與程式碼的生成
- 程式碼與實作計畫的審查（獨立 AI 審查）
- 文件的起草與潤稿
- Issue 與 Pull Request 內容的起草、潤稿、或生成
- Commit message 的撰寫（會標上 "Co-Authored-By: ..."）

絕大部分程式碼由 AI 產生。作者負責需求與行為驗證，並以測試、CodeQL 掃描與獨立 AI 審查把關，但並未逐行審閱全部程式碼。

### 注意事項

使用本專案前，請知悉以下風險：

- **準確性**：AI 生成的程式碼可能含有邏輯錯誤或過時的 API 用法，使用前請自行驗證。
- **資訊安全**：AI 工具可能無意間建議含有安全漏洞的寫法（如硬寫憑證、不安全的輸入處理等）。本專案已盡力排除已知風險，但不保證程式碼完全符合資安最佳實踐，請勿直接用於生產環境而不進行安全審查。
- **勞動法規**：假期計算結果僅供參考，請以公司規定與主管機關解釋為準。
- **智慧財產權**：AI 模型生成內容的著作權歸屬目前仍存在法律上的不確定性。本專案程式碼絕大部分由 AI 生成，作者負責需求、行為驗證與最終取捨。
- **「現況」提供（法律免責）**：就法律層面而言，本專案依「現況（as-is）」提供，不附帶任何明示或暗示之擔保，包括但不限於對特定用途之適用性、正確性或不侵權之保證。因使用本軟體所產生的任何損失，作者不負賠償責任。
