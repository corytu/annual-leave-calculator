# 統一 disabled 元件的 hover 游標樣式（實作計畫）

## Context

到職日儲存後（`isLocked = true`），設定頁多個 disabled 元件 hover 時游標不一致：有些正確顯示 `not-allowed`（因為個別手動加了 `disabled:cursor-not-allowed`），有些仍顯示箭頭或手指（到職日輸入框、規則列/成長列的 number 輸入框、遞延開關）。月曆的上/下月導覽按鈕在期間邊界 disabled 時 hover 仍是手指。

根因（已用 Explore agent 對照原始檔案逐行核實）：

1. Tailwind preflight 把所有 `:disabled` 重設為 `cursor: default`（specificity `(0,1,0)`，因為 preflight 的選擇器就是裸的 `:disabled`）。目前正常的元件都是各自手動補了 `disabled:cursor-not-allowed`，沒補的就壞了——這是複製貼上時的同一種遺漏，逐元件修補治標不治本。
2. 「允許遞延」開關的真正 `<input type="checkbox" role="switch">` 用 `sr-only` 隱藏（`src/components/Settings.jsx:446-453`），使用者實際 hover 的是外層 `<label className="... cursor-pointer ...">`（`Settings.jsx:445`），而 label 的 `cursor-pointer` 從不檢查 disabled 狀態。
3. 月曆導覽鈕：`.react-calendar__navigation button { cursor: pointer }`（`src/index.css:20-30`，specificity `(0,1,1)`）與新加的全域 `button:disabled` 規則（也是 `(0,1,1)`）打平，此時由**來源順序**決定，而 `.react-calendar__navigation button` 目前在檔案中排在較後面，會贏過先出現的全域規則，導致 disabled 的導覽鈕仍顯示 `pointer`。

修正原則：用全域 CSS 規則一次性解決 preflight 的問題（而不是逐元件補 class），因為逐元件補正是這次不一致的成因；月曆導覽鈕因為有專屬的、同 specificity 的既有規則，需要一條專屬的、更高 specificity 的規則來確保覆蓋順序不受檔案排序影響。

**重要技術前提（已核實）**：這個專案的 `src/index.css` 目前**完全沒有 `@layer base` 區塊**——檔案開頭三行是 `@tailwind base/components/utilities;`（`index.css:1-3`），之後全部是不帶 `@layer` 包裝的純 CSS。Tailwind 3.x 的 `@layer` 是建置期（build-time）的組織性語法，編譯後不會輸出瀏覽器原生的 CSS Cascade Layers（那是 Tailwind v4 的行為）；因此瀏覽器實際比較這些規則時，用的是一般的「specificity + 來源順序」層疊規則，不是 CSS Layers 的「後宣告層必勝、無視 specificity」規則。這正是 D2（`label:has(:disabled)` 靠 specificity `(0,1,1)` 贏過 `.cursor-pointer` 的 `(0,1,0)`）成立的前提——如果專案是 Tailwind v4、`@layer` 真的變成原生 Cascade Layers，這個推論就會失效（utilities layer 會無視 specificity 直接蓋掉 base layer）。既然已核實是 Tailwind 3.4（`package-lock.json` 鎖定 3.4.19），這個前提成立。

`playwright.config.js` 的 `webServer`（`playwright.config.js:22-28`）跑的是 `npm run build && npm run preview`，不是 dev server——所以每次跑 e2e 都已經是對 production build 的 CSS 做驗證，「build 後檢查 dist CSS」這步驟在概念計畫裡列為必要，但實質上 e2e 通過就已經間接證明了 dist CSS 含有這些規則；仍建議手動看一眼 dist CSS 確認規則存在，作為額外保險（尤其是核對規則的**內容**——e2e 只驗證 computed cursor 值，沒有告訴你規則本身寫對了沒有）。

## 實作範圍（三個獨立 commit，每個都必須單獨通過全部單元測試與 e2e）

### Commit 1：全域 disabled 游標規則 + 設定頁測試（先紅後綠）

**檔案：`src/index.css`**，在第 3 行（`@tailwind utilities;`）之後插入新區塊：

```css
@layer base {
  /* Tailwind's preflight resets :disabled to `cursor: default`. Restore the
     "not allowed" cursor for every disabled control in one place instead of
     repeating disabled:cursor-not-allowed per element. Specificity (0,1,1)
     is deliberate: it beats preflight and utilities like cursor-pointer, so
     "disabled" always wins. */
  button:disabled,
  input:disabled,
  select:disabled,
  textarea:disabled {
    cursor: not-allowed;
  }

  /* Separate rule on purpose: a selector list is dropped entirely if any one
     selector is unsupported, and :has() is the newest of these. Covers the
     carry-over switch, whose real <input> is visually hidden so the user
     actually hovers the wrapping <label>. */
  label:has(:disabled) {
    cursor: not-allowed;
  }
}
```

- 這個檔案目前沒有任何 `@layer base` 區塊，此區塊是全新插入，不是併入既有內容。
- `select`、`textarea` 目前專案沒用到對應元素，保留是為了涵蓋所有原生表單控制項，屬防禦性設計，不算過度工程（成本趨近於零，換來規則的完整性）。
- 此 commit 不動任何 JSX。
- 已知副作用：月曆年/十年檢視中 disabled 的月份格會從手指變成 `not-allowed`（因為沒有 `pointer-events: none` 擋著）。數量少、與本次修正邏輯一致，**預設接受**，在 PR 描述記錄一筆觀察即可，不另外處理。

**流程：先寫測試、跑一次確認紅燈、再加上面的 CSS、再跑一次確認轉綠。**

**測試檔案 1：`e2e/resignation.spec.js`**

- 測試 `'未儲存設定時「離職重來」為 disabled'`（現況：第 62-67 行，只有 `await expect(page.getByRole('button', { name: '離職重來' })).toBeDisabled()`）。在既有斷言之後加：
  ```js
  await expect(page.getByRole('button', { name: '離職重來' })).toHaveCSS('cursor', 'not-allowed')
  // reverse assertion: enabled controls must not show the forbidden cursor
  await expect(page.getByRole('button', { name: '儲存設定' })).toHaveCSS('cursor', 'pointer')
  await expect(page.locator('input[type="date"]')).not.toHaveCSS('cursor', 'not-allowed')
  ```
  這個測試點的是「前往設定」（首次進入、尚未儲存過任何設定的畫面），此時 Settings.jsx 以 `isLocked=false` 渲染，到職日輸入框與「儲存設定」按鈕都在畫面上且是 enabled 狀態，可以直接斷言。不對 enabled 輸入框斷言具體 cursor 值（只用 `not.toHaveCSS('cursor', 'not-allowed')`），避免綁死瀏覽器對 `input[type=date]` 的預設游標（不同瀏覽器/OS 可能是 `text` 或 `auto`）。

- 測試 `'儲存後欄位變唯讀，「離職重來」變 enabled'`（現況：第 69-90 行）。對照表：

  | 行號 | Locator | 補充的 `toHaveCSS('cursor', 'not-allowed')` |
  |---|---|---|
  | 74 | `page.locator('input[type="date"]')` | 到職日輸入框 |
  | 75 | `page.getByRole('button', { name: '按勞基法第38條' })` | 規則卡片 1 |
  | 76 | `page.getByRole('button', { name: '公司另有規定' })` | 規則卡片 2 |
  | 77 | `page.locator('table tbody tr input[type="number"]').first()` | 規則列 number input |
  | 78 | `page.locator('table tbody tr input[type="number"]').nth(1)` | 規則列 number input |
  | 79-83 | `deleteButtons`（迴圈內） | 每個刪除規則按鈕，在既有 for-loop 內對同一個 `btn` 多加一行斷言 |
  | 84 | `page.getByLabel('每年增加天數')` | 成長列輸入框 |
  | 85 | `page.getByLabel('天數上限')` | 成長列輸入框 |
  | 86 | `page.getByRole('switch')` | （不用這個斷 cursor，見下） |

  `disabled` 與 `cursor` 各自獨立 `expect()`，緊接在對應的 `toBeDisabled()` 之後，方便未來判斷是哪個面向壞了。

  另外兩項是**新增**斷言，現況測試裡沒有對應項目：
  1. 「+ 新增規則」按鈕：現況完全沒被斷言過。補上一對：
     ```js
     await expect(page.getByRole('button', { name: '新增規則' })).toBeDisabled()
     await expect(page.getByRole('button', { name: '新增規則' })).toHaveCSS('cursor', 'not-allowed')
     ```
     （`+` 是 svg icon，accessible name 只有文字「新增規則」。）
  2. 遞延開關：現況第 86 行斷的是 `page.getByRole('switch')` 本身（隱藏的 checkbox），但 `toHaveCSS` 讀的是元素自己的 computed style，不代表「hover 時實際顯示的游標」——真正被 hover 的是外層 label。所以額外加：
     ```js
     const carryoverLabel = page.getByRole('switch').locator('..')
     await expect(carryoverLabel).toHaveCSS('cursor', 'not-allowed')
     ```

  最後在測試尾端（第 89 行「離職重來」`toBeEnabled()` 之後）加反向斷言：
  ```js
  await expect(page.getByRole('button', { name: '離職重來' })).toHaveCSS('cursor', 'pointer')
  ```
  這是修正點：「離職重來」鎖定後是 enabled，游標必須是 `pointer`，不能沿用未鎖定狀態時的 `not-allowed` 斷言。

**測試檔案 2：`e2e/onboarding-and-settings.spec.js`**

- 測試 `'每年增加天數為 0 時，上限欄位停用'`（現況：第 243-249 行，路徑是 `growthPerYear === 0`，與 `isLocked` 無關，是獨立的 disabled 來源）。在既有 `toBeDisabled()` 之後加：
  ```js
  await expect(page.getByLabel('天數上限')).toHaveCSS('cursor', 'not-allowed')
  await expect(page.getByLabel('每年增加天數')).not.toHaveCSS('cursor', 'not-allowed')
  ```

**紅燈預期（Commit 1）**：到職日輸入框、規則列/成長列輸入框顯示 `default`；遞延開關 label 顯示 `pointer`（因為目前只有 checkbox 本身變 disabled，label 的 `cursor-pointer` 不受影響）。「按勞基法第38條」「公司另有規定」卡片、刪除按鈕、「+新增規則」、「離職重來」（未鎖定時）目前應該**已經是綠燈**，因為 `Settings.jsx` 裡它們已手動加了 `disabled:cursor-not-allowed`（見 Commit 2 說明）——這幾個斷言是回歸測試，不是紅燈項目。若跑起來發現這些也是紅燈，代表根因判斷有誤，要回頭重新檢查。

若要一次看到全部未通過項目而不是卡在第一個失敗就停，紅燈階段可暫時把新加的斷言改成 `expect.soft(...)`，確認完整清單後改回 `expect` 再進行下一步。

### Commit 2：移除 `Settings.jsx` 內重複的 cursor class（純清理，行為不變，獨立 commit）

**檔案：`src/components/Settings.jsx`**，只刪 cursor 相關 class，其餘 class（`opacity-*`、`disabled:hover:*`、disabled 底色等）不動：

1. 「+ 新增規則」按鈕（現況第 425-436 行，`disabled:cursor-not-allowed` 在第 430 行）：刪除該 class。
2. 刪除規則按鈕（現況第 369-380 行，`disabled:cursor-not-allowed` 在第 374 行）：刪除該 class。
3. 「離職重來」按鈕（現況第 499-508 行，`disabled:cursor-not-allowed` 在第 505 行）：刪除該 class。
4. `RuleTypeCard` 元件（函式定義於第 577 行，目標字串在第 587 行）：
   ```js
   // 587 行現況
   ${disabled ? 'opacity-60 cursor-not-allowed hover:border-stone-200' : ''}
   // 改成
   ${disabled ? 'opacity-60 hover:border-stone-200' : ''}
   ```
   「按勞基法第38條」「公司另有規定」兩張卡片（第 238-251 行）是呼叫 `<RuleTypeCard disabled={isLocked} ... />`，實際 class 來自這個函式本體，改這裡就同時涵蓋兩張卡片。

不需新增測試。安全網是 Commit 1 剛加的 `toHaveCSS('cursor', 'not-allowed')` 斷言——這個 commit 完成後這些斷言必須維持全綠（因為全域規則已經接管，移除逐元件的 class 不該改變任何 computed cursor 值）。

### Commit 3：月曆導覽鈕（先紅後綠）

**檔案：`src/index.css`**，在既有的 `.react-calendar__navigation button:enabled:hover, :focus` 規則（現況第 32-36 行）之後新增：

```css
/* Same specificity as `.react-calendar__navigation button { cursor: pointer }`
   would tie with the global button:disabled rule and lose on source order, so
   the disabled state needs its own, higher-specificity rule (0,2,1). */
.react-calendar__navigation button:disabled {
  cursor: not-allowed;
}
```

同一個 commit，在 `.react-calendar__tile--out-of-period` 規則（現況第 96-100 行，只有 `color` 與 `pointer-events: none`，沒有 `cursor` 屬性）旁加一段**純註解**，不改樣式：

```css
/* pointer-events: none is intentional: out-of-period day tiles are native
   disabled buttons, so the global disabled rule computes cursor: not-allowed
   for them, but with pointer-events: none that cursor is never shown. Removing
   this line would make every grey tile show the forbidden cursor. */
```

`src/components/LeaveCalendar.jsx` 不需改動——`minDate`/`maxDate`（現況第 61-62 行）已經讓 react-calendar 對邊界按鈕加上原生 `disabled` 屬性。

**測試檔案：`e2e/calendar-and-records.spec.js`**

⚠️ 與概念計畫描述不同之處（已用 Explore agent 核實）：現況測試 `'月曆顯示週首標題列（7 欄）且區間外日期不可點擊'`（第 20-31 行）**完全沒有**任何導覽按鈕（`prev-button`/`next-button`）的既有斷言——全 repo grep 這兩個 class 名稱都沒有結果。所以下面是在既有測試裡**新增**兩筆全新斷言，不是「補齊既有斷言」。

該測試的 `beforeEach`（第 14-18 行）用的 `BASE_SETTINGS`（第 6-11 行：`onboardDate: '2024-06-15'`）搭配 `freezeTime(page)` 預設凍結時間（同檔註解推算為 2025-06-15），使當期為 2025-06-15～2026-06-14。月曆預設顯示當月（2025-06），上一頁會導向 2025-05（早於 `minDate=periodStart`），因此上一頁按鈕在預設畫面下就是原生 disabled，不需要新 fixture、也不需要先手動切換月份。在第 31 行（既有 out-of-period 斷言）之後加：

```js
await expect(page.locator('.react-calendar__navigation__prev-button')).toHaveCSS('cursor', 'not-allowed')
// reverse assertion: the next button is still enabled at this point
await expect(page.locator('.react-calendar__navigation__next-button')).toHaveCSS('cursor', 'pointer')
```

**不要**對區間外的日格（`react-calendar__tile--out-of-period`）加任何游標斷言——維持 `pointer-events: none` 現狀，灰色本身已表達不可用，這是刻意排除的範圍（若日後要反悔，只需移除 `pointer-events: none` 這行 CSS 並補一組日格斷言，因為全域規則已經讓這些日格的 computed cursor 是 `not-allowed`，只是被 `pointer-events: none` 擋住沒顯示）。

**紅燈預期（Commit 3）**：上一頁導覽鈕顯示 `pointer`（因為 `.react-calendar__navigation button { cursor: pointer }` 在來源順序上贏過 Commit 1 的全域規則）。

## 驗證

**自動：**
- `npm test`
- `npm run test:e2e`，至少涵蓋 `resignation`、`onboarding-and-settings`、`calendar-and-records` 三個 spec；三個 commit 分別都要跑過
- `npm run build` 後看一眼 `dist` 內編譯出的 CSS，確認 `button:disabled`/`input:disabled` 與 `label:has(:disabled)` 這兩條規則確實存在且內容正確（e2e 用的 `webServer` 本來就是 `build && preview`，所以 e2e 綠燈已經間接證明這點，此步驟是額外的人工保險，非必要但建議做）

**手動（Chrome，儲存到職日之後逐一 hover 確認顯示禁止符號）：**
1. 到職日輸入框：欄位本體，以及右側的日曆圖示（瀏覽器內部零件，`toHaveCSS` 讀不到，需肉眼確認）
2. 規則列與成長列的 number 輸入框：欄位本體，以及右側的上下箭頭（同上，內部零件）
3. 允許遞延開關（軌道與圓點）
4. 月曆上一頁按鈕（切到期間邊界的月份）
5. 灰色日格：確認維持原狀（預設箭頭，不顯示禁止符號）
6. 月曆年/十年檢視中 disabled 的月份格：確認會變成 `not-allowed`（這是已知、接受的副作用，記錄觀察即可）

若第 1、2 項的原生零件（日曆圖示、上下箭頭）hover 後不是禁止符號，在 `@layer base` 內**另外**補一條獨立規則（不要併入既有選擇器清單，因為 `::-webkit-*` 偽元素若被不支援的瀏覽器解析整條選擇器清單會直接失效）：
```css
input:disabled::-webkit-calendar-picker-indicator,
input:disabled::-webkit-inner-spin-button {
  cursor: not-allowed;
}
```
並在測試檔加註解標明這塊無法自動化。手動檢查結果（含此項）記在 PR 描述。

## 已知限制（不在本次修正範圍內，PR 描述需提及）

- 月曆年/十年檢視 disabled 月份格游標變化（見上）。
- `label:has(:disabled)` 在不支援 `:has()` 的瀏覽器（Firefox 121 之前）會整條規則被忽略，遞延開關的游標退回 `pointer`——可接受的降級，且因為是獨立規則（不與 `button:disabled` 等寫在同個選擇器清單），不會連帶讓其他規則失效。
- 灰色日格（out-of-period tiles）刻意不處理，維持 `pointer-events: none`。

## 本計畫明確不做的事

- 不改 `LeaveCalendar.jsx`。
- 不新增 e2e spec 檔案或 hit-test helper（`elementFromPoint` 掃描）；沿用專案既有測試風格，在既有測試裡補斷言。
- 不修改 disabled 元件的其他樣式（`opacity-*`、`disabled:hover:*`、disabled 底色）。
- 不處理月曆年/十年檢視月份格的游標（列為已知限制，非本次範圍）。

## 驗收清單

- [ ] 三個 commit 依序完成，每個 commit 單獨都通過 `npm test` 與相關 e2e spec。
- [ ] Commit 1 與 Commit 3 的紅燈輸出貼在 PR 描述。
- [ ] 鎖定後，設定頁所有 disabled 元件（到職日、規則列/成長列輸入框、遞延開關 label）hover 時 `toHaveCSS('cursor', 'not-allowed')`。
- [ ] 「離職重來」：未鎖定時 `not-allowed`，鎖定後 `pointer`。
- [ ] 月曆上一頁按鈕在期間邊界 `not-allowed`，下一頁按鈕仍 `pointer`。
- [ ] 灰色日格行為與修正前完全相同（無新增斷言）。
- [ ] `Settings.jsx` 不再有任何 `cursor-not-allowed` 或 `disabled:cursor-not-allowed`。
- [ ] production build 的 CSS 含有兩條全域規則。
- [ ] 手動檢查結果（含原生圖示/上下箭頭、年檢視月份格觀察）記在 PR 描述。
