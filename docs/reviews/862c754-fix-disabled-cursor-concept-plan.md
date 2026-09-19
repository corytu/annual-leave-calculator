# 統一 disabled 元件的 hover 游標樣式（實作計畫）

> 交給 Claude Code 實作。本文件整合了兩份獨立分析（Claude Chat 與另一個 Claude Code session）以及使用者的最終決定。§2 記錄了每個取捨，動手前請先讀完。

## 1. 背景與根因

到職日儲存後（`isLocked = true`），設定頁多個元件被 disabled，但 hover 游標不一致：

- **顯示 `not-allowed`（正確）：**「按勞基法第38條」「公司另有規定」兩張卡片、刪除規則按鈕、「+ 新增規則」。「離職重來」在**未儲存**（disabled）時同樣正確。
- **維持箭頭或手指（不正確）：** 到職日輸入框、規則列的月數／天數輸入框、成長列的「每年增加天數」「天數上限」輸入框、「允許遞延」切換開關。
- **月曆：** 上／下月導覽按鈕在期間邊界時是 disabled，但 hover 仍顯示手指。

根因（專案是 Tailwind 3.4，lockfile 為 3.4.19）：

1. Tailwind preflight 對所有 `:disabled` 套用 `cursor: default`（specificity 0,1,0）。正常運作的元件都各自手動加了 `cursor-not-allowed`，壞掉的沒加。成長列與規則列的輸入框帶著幾乎相同的 class 字串，是複製貼上時的同一種遺漏。
2. 切換開關的真正 checkbox 用 `sr-only` 隱藏，使用者實際 hover 的是外層 `<label>`，而 label 寫死 `cursor-pointer`，從不看 disabled。
3. 月曆導覽鈕：`.react-calendar__navigation button { cursor: pointer }`（specificity 0,1,1）高於 preflight 的 `:disabled`（0,1,0）。

## 2. 決策紀錄

| # | 決定 | 理由 |
|---|---|---|
| D1 | 用**一條全域規則**（`index.css`）統一原生控制項的 disabled 游標，不逐元件補 class。 | 逐元件補 class 正是這次不一致的成因，下一個新元件也會忘。全域規則直接對準根因。 |
| D2 | 遞延開關用全域 `label:has(:disabled)` 處理，**不改 JSX**（label 保留 `cursor-pointer`）。 | `label:has(:disabled)` 的 specificity 是 (0,1,1)，高於 `.cursor-pointer`（0,1,0），不需要改 label 的 class。 |
| D3 | 月曆導覽鈕加一條專屬的 `.react-calendar__navigation button:disabled` 規則（specificity 0,2,1）。 | 全域規則是 (0,1,1)，與 `.react-calendar__navigation button` 同級，會被較晚出現的專案 CSS 蓋掉，所以必須有這條。採用另一份分析的寫法：改動比把 `cursor: pointer` 搬進 `:enabled` 更小，也不受規則順序影響。 |
| D4 | 測試沿用專案風格：在**既有測試**內補 `toHaveCSS('cursor', …)`，不新增 spec、不寫 hit-test helper。 | 這裡的 `cursor` 是靜態的（沒有 `:hover` 規則會改它），專案又只跑 Chromium，`toHaveCSS` 讀 computed style 就夠了。hit-test 掃描機制對這個 repo 過重。 |
| D5 | 測試流程**先紅後綠**，並加**反向斷言**（enabled 元件不能顯示 `not-allowed`）。 | 紅燈證明測試真的抓得到問題；反向斷言防止全域規則寫得過寬。 |
| D6 | **修正**：「離職重來」的 `not-allowed` 斷言只能放在**未儲存**的測試；鎖定後它是 enabled，游標應為 `pointer`。 | 另一份分析誤把它放進鎖定狀態的測試，會直接失敗。 |
| D7 | 移除 `Settings.jsx` 內既有的重複 cursor class，但**獨立成一個 commit**。 | 這是純清理、行為不變，與修 bug 分開。Commit 1 的測試就是清理的安全網。 |
| D8 | **不處理**月曆期間外的灰色日格：維持 `pointer-events: none`，不加游標斷言。 | 使用者決定：整片灰格都顯示禁止符號對使用者是雜訊。灰色本身已表達不可用。反悔方式見 §6。 |

## 3. 實作

三個 commit，**每個 commit 單獨都必須通過全部單元測試與 e2e**。不得留下紅燈 commit。

### Commit 1：全域規則與設定頁游標測試

**流程：先寫測試（§4.1–4.3），跑一次確認紅燈，再加 CSS。**

`src/index.css`，放在三行 `@tailwind` 之後：

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

注意事項：

- 這條規則的特性是「disabled 永遠贏」：日後若真的有元件需要例外，得用 Tailwind 的 `!` important 修飾詞。這是刻意的取捨。
- `select` 與 `textarea` 目前專案沒用到，保留是為了讓規則涵蓋所有原生表單控制項。
- 此 commit **不動 JSX**。
- 此 commit 會讓月曆的「年檢視／十年檢視」中 disabled 的月份格也顯示 `not-allowed`，見 §6。

### Commit 2：移除重複的 cursor class（純清理，行為不變）

`src/components/Settings.jsx`，**只刪 cursor 相關 class**，其他（`opacity-*`、`disabled:hover:*`、disabled 底色等）原封不動：

1. 「+ 新增規則」按鈕：刪掉 `disabled:cursor-not-allowed`。
2. 刪除規則按鈕：刪掉 `disabled:cursor-not-allowed`。
3. 「離職重來」按鈕：刪掉 `disabled:cursor-not-allowed`。
4. `RuleTypeCard`（約 587 行）：`'opacity-60 cursor-not-allowed hover:border-stone-200'` 改成 `'opacity-60 hover:border-stone-200'`。

不需新增測試。安全網是 Commit 1 的斷言，這個 commit 之後必須維持全綠。

### Commit 3：月曆導覽鈕

**流程：先寫 §4.4 的斷言，確認紅燈，再改 CSS。**

`src/index.css`，在既有的 `.react-calendar__navigation button:enabled:hover / :focus` 規則之後新增：

```css
/* Same specificity as `.react-calendar__navigation button { cursor: pointer }`
   would tie with the global button:disabled rule and lose on source order, so
   the disabled state needs its own, higher-specificity rule (0,2,1). */
.react-calendar__navigation button:disabled {
  cursor: not-allowed;
}
```

`LeaveCalendar.jsx` 不需改動（`minDate` / `maxDate` 已讓 react-calendar 對邊界按鈕加上原生 `disabled`）。

同一個 commit 內，在 `.react-calendar__tile--out-of-period` 規則旁加一段**註解**（不改樣式）：

```css
/* pointer-events: none is intentional: out-of-period day tiles are native
   disabled buttons, so the global disabled rule computes cursor: not-allowed
   for them, but with pointer-events: none that cursor is never shown. Removing
   this line would make every grey tile show the forbidden cursor. */
```

## 4. 測試（Playwright e2e）

原則：`toHaveCSS('cursor', …)` 讀的是 computed style，不需要真的 `hover()`。測試名稱與行號以 repo 實際為準（以下是另一個 session 讀到的位置）。

### 4.1 `e2e/resignation.spec.js` — `'儲存後欄位變唯讀，「離職重來」變 enabled'`（約 69–90 行）

對照每個既有的 `toBeDisabled()` 斷言，用**同一個 locator**補上 `toHaveCSS('cursor', 'not-allowed')`。`disabled` 與 `cursor` 各自獨立 `expect()`，方便判斷是哪個面向壞了。涵蓋：

- 到職日輸入框
- 兩張規則類型卡片
- 規則列的月數輸入框、天數輸入框（既有測試取 `first()` 與 `nth(1)`）
- 每個刪除按鈕（在既有迴圈內一併補）
- 「每年增加天數」「天數上限」
- 「+ 新增規則」按鈕（`getByRole('button', { name: '新增規則' })`，它的 `+` 是 svg，名稱只有文字）
- **遞延開關：斷言對象是外層 label，不是 checkbox 本身。** 用 `page.getByRole('switch').locator('..')`。

```js
const carryoverLabel = page.getByRole('switch').locator('..')
await expect(carryoverLabel).toHaveCSS('cursor', 'not-allowed')
```

**反向斷言：** 鎖定後「離職重來」是 enabled，游標應為手指。

```js
await expect(page.getByRole('button', { name: '離職重來' })).toHaveCSS('cursor', 'pointer')
```

### 4.2 `e2e/resignation.spec.js` — `'未儲存設定時「離職重來」為 disabled'`

```js
await expect(page.getByRole('button', { name: '離職重來' })).toHaveCSS('cursor', 'not-allowed')
// reverse assertions: enabled controls must not show the forbidden cursor
await expect(page.getByRole('button', { name: '儲存設定' })).toHaveCSS('cursor', 'pointer')
await expect(page.locator('input[type="date"]')).not.toHaveCSS('cursor', 'not-allowed')
```

（不對 enabled 輸入框斷言具體值，避免綁死瀏覽器預設的 text／auto。）

### 4.3 `e2e/onboarding-and-settings.spec.js` — 「每年增加天數為 0 時上限欄位停用」（約 243–249 行）

這條路徑走的是 `growthPerYear === 0`，獨立於 `isLocked`，補上成對的斷言：

```js
await expect(page.getByLabel('天數上限')).toHaveCSS('cursor', 'not-allowed')
await expect(page.getByLabel('每年增加天數')).not.toHaveCSS('cursor', 'not-allowed')
```

### 4.4 `e2e/calendar-and-records.spec.js` — `'月曆顯示週首標題列（7 欄）且區間外日期不可點擊'`（約 20–31 行，Commit 3）

該測試的 `BASE_SETTINGS`（到職日 2024-06-15，凍結時間 2025-06-15）在預設月曆下，上一頁按鈕本來就是 disabled，不需要新 fixture。

```js
await expect(page.locator('.react-calendar__navigation__prev-button')).toHaveCSS('cursor', 'not-allowed')
// reverse assertion: the next button is still enabled at this point
await expect(page.locator('.react-calendar__navigation__next-button')).toHaveCSS('cursor', 'pointer')
```

**不要對區間外的日格加任何游標斷言**（見 D8）。

### 4.5 紅燈預期

修正前預期失敗的項目：

- **Commit 1：** 到職日輸入框（`default`）、規則列與成長列的輸入框（`default`）、遞延開關 label（`pointer`）。
- **Commit 3：** 上一頁導覽鈕（`pointer`）。

Playwright 預設在第一個失敗的 `expect` 就停。若要一次看到全部未通過項目，紅燈階段可暫時把新增的斷言改成 `expect.soft`，確認後改回 `expect` 再 commit。請把實際的紅燈輸出貼進 PR 描述。若與上述預期不符，以實測為準，並回頭檢查 §1 的根因判斷。

## 5. 驗證

**自動：**

- `npm test`
- `npm run test:e2e`（或至少 `resignation`、`onboarding-and-settings`、`calendar-and-records` 三個 spec）
- `npm run build`，然後在 `dist` 的 CSS 中確認 `input:disabled` 與 `label:has(:disabled)` 這兩條規則確實存在。先看 `playwright.config` 的 `webServer` 跑的是 dev server 還是 preview：若是 dev server，e2e 抓不到 build 階段的問題，這一步就不能省。

**手動（Chrome，儲存到職日之後）：** 依序 hover 並確認都顯示禁止符號。

1. 到職日輸入框：欄位本體，以及右側的日曆圖示。
2. 規則列與成長列的 number 輸入框：欄位本體，以及右側的上下箭頭。
3. 允許遞延開關（軌道與圓點）。
4. 月曆上一頁按鈕（切到期間邊界的月份）。
5. 灰色日格：**確認維持原狀**（預設箭頭，不顯示禁止符號）。

第 1、2 項的圖示與上下箭頭屬於瀏覽器內部零件，`toHaveCSS` 讀不到。若發現不是禁止符號，在同一個 `@layer base` 補一條**獨立**規則（不要併進上面的選擇器清單）：

```css
input:disabled::-webkit-calendar-picker-indicator,
input:disabled::-webkit-inner-spin-button {
  cursor: not-allowed;
}
```

並在測試檔註解標明這塊無法自動化。手動檢查結果請記在 PR 描述。

## 6. 已知副作用與限制

- **年／十年檢視的月份格（Commit 1 就會出現）：** 點月曆標題可進入年檢視，期間外的月份格是 disabled 且沒有 `pointer-events: none`。修正前它們顯示手指，修正後顯示禁止符號。這與本計畫的原則一致，數量也少，**預設接受**。請在手動檢查時實際看一次，並在 PR 描述回報觀察。若使用者覺得雜訊，另開後續處理，不屬於本計畫。
- **反悔灰色日格（D8）：** 只需移除 `.react-calendar__tile--out-of-period` 的 `pointer-events: none`，並補一組日格的 `toHaveCSS('cursor', 'not-allowed')` 斷言。因為全域規則已讓這些日格的 computed cursor 是 `not-allowed`，只是目前被 `pointer-events: none` 擋住而不顯示。
- **`:has()` 支援度：** 遞延開關的游標依賴 `label:has(:disabled)`。不支援 `:has()` 的舊瀏覽器（Firefox 121 以前）會忽略這條規則，開關的游標退回手指。這是可接受的降級，且因為是獨立規則，不會連帶讓其他規則失效。
- **`toHaveCSS` 的限制：** 它讀元素自己的 computed style，不驗證「指標下方實際是哪個元素」。所以遞延開關必須斷言 label（真正被 hover 的元素），而不是隱藏的 checkbox。

## 7. 本計畫不做的事

- 月曆期間外的灰色日格（D8）。
- 修改 `LeaveCalendar.jsx`。
- 新增 e2e spec 或 hit-test helper（`elementFromPoint` 掃描）。
- 修改 disabled 元件的其他樣式（opacity、底色、`disabled:hover:*`）。
- 年／十年檢視月份格的游標微調（§6）。

## 8. 驗收清單

- [ ] 三個 commit 依序完成，每個 commit 單獨都通過全部單元測試與 e2e。
- [ ] Commit 1 與 Commit 3 都有紅燈輸出貼在 PR 描述。
- [ ] 鎖定後，設定頁所有 disabled 元件（含到職日、規則列與成長列輸入框、遞延開關）hover 時顯示 `not-allowed`。
- [ ] 「離職重來」：未鎖定時為 `not-allowed`，鎖定後為 `pointer`（D6）。
- [ ] 月曆上一頁按鈕在期間邊界顯示 `not-allowed`，可點的下一頁按鈕仍為 `pointer`。
- [ ] 灰色日格的行為與修正前完全相同。
- [ ] `Settings.jsx` 不再有任何 `cursor-not-allowed` 或 `disabled:cursor-not-allowed`。
- [ ] production build 的 CSS 含有全域規則。
- [ ] 手動檢查結果（含原生圖示／上下箭頭，以及年檢視月份格）已記在 PR 描述。
