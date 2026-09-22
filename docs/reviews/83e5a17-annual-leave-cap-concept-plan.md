# 實作計畫：#45 自訂特休天數上限（併同處理 #29、#30）

> 本計畫由 Claude Chat 與維護者討論定案，交由 Claude Code 實作。
> 開始前請先比對最新 HEAD 的 `src/utils/leaveCalculations.js`、`src/components/Settings.jsx`、`src/components/LeaveForm.jsx`、`e2e/onboarding-and-settings.spec.js`。若與本文描述的現況不符，請先回報，不要自行推測。

---

## 0. 背景與根因

- **#45（根因）**：「公司另有規定」的自訂規則天數，以及成長列的 `cap`，都沒有上限。額度可以任意大，而額度正是 `validateRecordsChain` 判斷超支的天花板，所以下游所有「天數太大」的防線都跟著失效。
- **#29（症狀）**：`getLeaveRecordDates` 的 `while` 迴圈沒有上限。天數極大時，`LeaveCalendar` render 期間會跑百萬圈，分頁凍結，ErrorBoundary 也攔不到。
- **#30（症狀）**：`LeaveForm` 的 `max={30}` 只是 HTML 屬性，從未被強制；設定頁天數欄位的 `min={0}` 也和 JS 驗證對不上。

外部 PR #42、#44 不採用，本 PR 不引用其程式碼。

---

## 1. 決策紀錄

| 代號 | 決策 |
|---|---|
| C1 | 新增並 export `MAX_ANNUAL_LEAVE_DAYS = 365`。這是**合理性上限**，只用來擋荒謬值，不是精算值；期間不一定滿 12 個月，所以 260（一年平日數）也不是物理上限。code comment 必須寫明這點。 |
| C2 | `handleSave` 驗證三個值不超過 `MAX_ANNUAL_LEAVE_DAYS`：每一列天數、`perYear`、`cap`（僅在 `perYear > 0` 時）。只要這三個值有上限，`getDaysForMilestone` 的任何回傳值都不會超過上限，不需要模擬成長過程。 |
| C3 | 驗證順序：先驗每一列天數，再驗成長列。這樣最後一列天數必定 ≤ 上限，「`cap` 不可低於最後一列」和「`cap` 不可超過上限」不會同時無解。 |
| C4 | `perYear = 0` 時完全不驗 `cap`。上限欄位此時停用，但 state 可能殘留舊值（例如 `'9000'`），仍必須能儲存，且存成 `{ perYear: 0, cap: 0 }`。 |
| C5 | 自訂規則天數補上 0.25 倍數驗證（既有 bug：364.1、1.3 目前都能存）。因為與上限改的是同一行、同一句訊息，併入本次處理。 |
| C6 | **三個天數欄位（自訂規則天數、`perYear`、`cap`）的錯誤訊息，一律合成一句，一次講完該欄位的完整合法範圍。** 只要任一條件不成立，就回傳同一句訊息，使用者一次 alert 就能看到所有規則，不會出現「改好一個條件又被另一個條件擋下」的連續 alert。三個欄位的行為因此一致。`cap` 原本「每個條件各自一句」的做法改為合成一句。**程式碼內部仍逐一判斷、分別命名每個條件**，讓未來改成 inline 列表時有清楚的拆分依據；對使用者只呈現合成訊息。既然訊息合一，條件之間的檢查順序不影響結果。 |
| C7 | 錯誤呈現沿用 `alert()` 與全形標點。改成 inline 紅字不在本次範圍（另開 issue）。 |
| C8 | 計算層也夾值：`getDaysForMilestone` 的 custom 分支，兩條回傳路徑都用 `Math.min(..., MAX_ANNUAL_LEAVE_DAYS)` 夾住，不跳 alert。比照 `normalizeCustomThresholds` 靜默濾掉超過 `MAX_MILESTONE_MONTHS` 門檻的既有模式：儲存時拒絕並提示，計算時靜默處理。目的是讓修正前已儲存、設定已鎖定的舊資料不失控。localStorage 不做遷移。 |
| C9 | CSV 備份的規則列輸出 localStorage 原始值，每期額度則是計算結果（已夾值）。舊資料可能出現「規則寫 1e23、額度顯示 365」，這是刻意的：備份就應該是原始資料。在 code comment 交代。 |
| C10 | 移除 `LeaveForm` 的 `max={30}`，不設替代值。單筆請假的真正上限是動態的（遞延帶入 + 本期 + 可預支下期），無法用固定數字表達；寫成理論極值 1095 反而會重演 #30「宣告與實際限制不符」的問題。 |
| C11 | 設定頁數字欄位的 HTML 屬性與 JS 驗證對齊（見 §5 表格）。這些屬性只影響輸入框上下箭頭的停止位置與 `:invalid` 狀態，不擋送出；但這次 JS 用的是同一個常數，所以不是裝飾。 |
| C12 | `getLeaveRecordDates` 加上 `MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS`（= 1095）。推導：超支檢查保證一期的請假總量 ≤ 遞延帶入（≤ 上期額度 ≤ 365）+ 本期額度（≤ 365）+ 可預支下期（≤ 365）；不足一天的尾數也會佔一個日期，所以合法的單筆記錄最多產生 ceil(days) ≤ 1095 個日期。這個上限永遠不會截斷合法資料。 |
| C13 | `MAX_LEAVE_RECORD_DATES` 是模組常數（export 給測試用），**不是**函式參數。函式簽名不變，呼叫端無法傳入其他值繞過防禦。 |
| C14 | `getLeaveRecordDates` 保留 `Number.isFinite` 防禦：天數不是有限數字時回傳空陣列。有了 C12 的上限後，它在安全上幾乎是多餘的（唯一行為差異：`Infinity` 從「打 1095 個點」變成「不打點」），保留的理由是意圖清楚。 |
| C15 | 上限只影響月曆上的點。首頁摘要的已休天數由 `getLeaveTakenInPeriod` 直接加總 `days`，壞資料仍會如實顯示為超支。 |
| C16 | 驗證抽成純函式，**回傳第一個錯誤**（`string \| null`），行為與現行 alert 完全一致。回傳「全部錯誤列表」牽涉檢查之間的依賴關係，屬於未來 inline UI 的設計工作，本次不預先決定。 |
| C17 | 重構只處理常數與驗證抽出。`Settings.jsx` 裡手動複製 `normalizeCustomThresholds` filter 的 `validThresholds`，只把 `1200` 換成常數，不改結構、不 export 該 helper。 |

---

## 2. 測試原則

1. **用最低成本的那一層證明行為。** 純計算與驗證邏輯（夾值、超支邊界、日期展開、各欄位邊界值）用 Vitest 單元測試；只有 UI 串接（alert 是否出現、是否真的存入、render 是否凍結）才寫 Playwright e2e。
2. **每個有上限的欄位測三種值：**

   | 值 | 證明什麼 |
   |---|---|
   | `MAX` | 剛好在上限，通過 |
   | `MAX + 0.25` | 合法步進下的最小越界，只會被上限擋下，證明上限檢查本身有效 |
   | `MAX + 0.1` | 使用者手動輸入的實際情境（同時違反上限與 0.25 倍數），一定被擋，且回傳該欄位的合成訊息（C6） |

3. **測試引用常數，不寫死數字。** 單元測試與 e2e 都 import `MAX_ANNUAL_LEAVE_DAYS`、`MAX_LEAVE_RECORD_DATES`、`MAX_MILESTONE_MONTHS`，邊界值與預期訊息都由常數推導。之後調整常數時，測試跟著走。e2e 若無法從 `src/utils/` import（例如 Playwright 設定不支援），請先回報再決定替代方案。
4. **斷言訊息時比對完整字串**，並由常數組出預期值，例如 `` `每年增加天數請填寫 0 到 ${MAX_ANNUAL_LEAVE_DAYS} 之間、且為 0.25 的倍數的數字` ``。
5. 每個 commit 結束時，`npm test` 與 e2e 都必須通過；Codecov 應涵蓋新增的分支。

---

## 3. Commit 1 — 重構：export `MAX_MILESTONE_MONTHS`（`Refs #45`）

**行為不變。**

### `src/utils/leaveCalculations.js`

`const MAX_MILESTONE_MONTHS = 1200` 改為 `export const`，既有 comment 保留。

### `src/components/Settings.jsx`

import `MAX_MILESTONE_MONTHS`，替換所有寫死的 `1200`（目前已知四處，請全檔搜尋確認）：

1. `handleSave` 門檻檢查的 `r.months > 1200`
2. 錯誤訊息，改為由常數推導：
   ```js
   `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`
   ```
   組出的字串必須與現行訊息逐字相同。
3. `validThresholds` filter 的 `m <= 1200`（C17：只換常數，不改結構）
4. 門檻輸入框的 `max={1200}`

### 測試

不新增測試，靠既有測試守住。請確認既有 e2e 是否涵蓋「門檻填 1201 被擋並顯示訊息」；若沒有，補一條，因為這個 commit 動到訊息的組成方式。

### Commit message

```
refactor: export MAX_MILESTONE_MONTHS and replace hardcoded 1200 in Settings

Settings.jsx duplicated the 1200-month ceiling in four places (save
validation, its error message, the growth-row threshold filter, and the
months input's max attribute). Import the constant instead so the two
can never drift apart. The error message is now built from the constant
and renders exactly the same text as before. No behavior change.

Refs #45
```

---

## 4. Commit 2 — 重構：抽出設定驗證純函式（`Refs #45`）

**行為不變。** 目的是讓後續的邊界組合能用單元測試覆蓋，並讓未來改成 inline 錯誤呈現時，只需替換呈現方式。

### 新檔 `src/utils/settingsValidation.js`

放在獨立檔案（而非 `leaveCalculations.js`），讓計算模組保持單純，測試檔也能各自獨立。

```js
/**
 * Validate the settings form before saving.
 *
 * Returns the message of the FIRST failing check, or null when everything
 * is valid. Check order is significant -- see the inline comments.
 *
 * Deliberately returns a single message rather than a list: collecting every
 * error would require deciding how dependent checks interact (e.g. whether
 * "cap below the last row's days" is meaningful when a row is itself
 * invalid). That belongs to a future inline-error UI, not to this refactor.
 *
 * @param {{
 *   onboardDate: string,
 *   ruleType: 'labor' | 'custom',
 *   customRules: Array<{ months: any, days: any }>,
 *   growthPerYear: string,  // raw input text
 *   growthCap: string,      // raw input text
 * }} input
 * @returns {string | null}
 */
export function validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap }) {
  // ...existing handleSave checks, moved verbatim, each `alert(msg); return`
  // becoming `return msg`
}
```

- 到職日檢查也一併移入，讓 `handleSave` 的所有驗證集中在同一處。
- 既有 comment（例如「empty-list guard 必須留在 custom 分支內」「growth row validation」）一併搬移，不要遺失。
- 內部需要的 `normalizedRules`、`sorted`、`growthPerYearNum`、`growthCapNum` 在函式內自行計算。

### `src/components/Settings.jsx`

```js
function handleSave() {
  const error = validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap })
  if (error) {
    alert(error)
    return
  }
  // ...build normalizedRules / growthPerYearNum / growthCapNum and call onSave(...) as today
}
```

`onSave` payload 的組成邏輯維持在 `handleSave`，不搬進驗證函式。

### 單元測試：新檔 `src/utils/settingsValidation.test.js`

把**現行**行為逐條寫成測試（特徵測試），證明抽出前後一致：

- 到職日為空 → `'請填寫到職日'`
- `ruleType: 'labor'` 且其他欄位全空或不合法 → `null`（custom 專屬檢查不影響 labor）
- custom、規則列表為空 → `'請至少保留一條自訂規則'`
- 門檻非整數、0、`MAX_MILESTONE_MONTHS + 1` → 門檻訊息
- 門檻重複 → 重複訊息（含月數）
- 天數為 0、負數、空字串 → 現行天數訊息
- `perYear` 空字串、負數、非 0.25 倍數 → 現行 `perYear` 訊息
- `perYear > 0` 時：`cap` 空字串 → `'天數上限請填寫數字'`；低於最後一列 → 低於訊息（含天數）；非 0.25 倍數 → 0.25 訊息
- 預設規則加上預設成長 `{ perYear: '1', cap: '30' }` → `null`

### Commit message

```
refactor: extract settings validation into a pure function

Move every check from Settings.handleSave into validateSettingsInput()
in src/utils/settingsValidation.js, returning the first failing message
(or null) instead of calling alert() directly. handleSave now just
alerts whatever it returns. Validation order and messages are unchanged.

This lets boundary cases be covered by fast unit tests instead of
Playwright, and keeps a later switch to inline error messages limited
to the presentation layer.

Adds characterization tests pinning the current behavior.

Refs #45
```

---

## 5. Commit 3 — #45 本體：額度上限（`Refs #45`）

### `src/utils/leaveCalculations.js`

**新增常數**（放在 `MAX_MILESTONE_MONTHS` 旁邊）：

```js
// Sanity ceiling for any entitlement value -- a single custom rule's days,
// the growth row's perYear and its cap. It only rejects absurd input (e.g.
// more leave days than there are days in a year); it is NOT a precise
// physical limit. A period can be shorter than 12 months (the first 6-month
// period, sub-year remainders between custom thresholds), so even 260
// weekdays would not be exact. 365 was chosen because it makes the error
// message self-explanatory. Please don't "correct" it to 260 (#45).
//
// Enforced in two places: validateSettingsInput() rejects new input with a
// message, and getDaysForMilestone() silently clamps values saved before
// this limit existed.
export const MAX_ANNUAL_LEAVE_DAYS = 365;
```

**`getDaysForMilestone` custom 分支夾值（C8）**，兩條回傳路徑都要夾：

```js
    if (perYear > 0 && milestoneMonths > lastRule.months) {
      const k = Math.floor((milestoneMonths - lastRule.months) / 12);
      return Math.min(
        lastRule.days + perYear * k,
        Math.max(cap, lastRule.days),
        MAX_ANNUAL_LEAVE_DAYS,
      );
    }
    return Math.min(days, MAX_ANNUAL_LEAVE_DAYS);
```

在夾值處加上 comment：

```js
// Clamp to MAX_ANNUAL_LEAVE_DAYS as defense in depth. New input can no
// longer exceed it (validateSettingsInput rejects it), but settings saved
// before #45 may hold absurd values and are locked, so the user cannot fix
// them. Clamping here keeps the summary, period tabs and the overspend
// guard in validateRecordsChain bounded for them. localStorage itself is
// left untouched (no migration).
```

注意 `validRules.length === 0` 時回傳的 `days` 是 0，夾值不影響；勞基法分支最多 30 天，不需要動。

### `src/utils/settingsValidation.js`

import `MAX_ANNUAL_LEAVE_DAYS`。

三個欄位採同一種寫法（C6）：每個條件各自算成一個具名的布林值，任一不成立就回傳該欄位的合成訊息。

在三段檢查的最上方加上 comment：

```js
// Each field's conditions are evaluated as separately named booleans, but
// any failure returns ONE message stating the field's full valid range.
// With alert() as the only feedback, per-condition messages made users fix
// one rule only to be stopped by the next (e.g. 9000.1 -> "<= 365" -> 363.7
// -> "multiple of 0.25"). The named conditions are kept so a future
// inline-error UI can report each one individually.
```

**自訂規則天數（C5）**，取代現行的天數檢查：

```js
const daysIsNumber = Number.isFinite(r.days)
const daysIsPositive = daysIsNumber && r.days > 0
const daysWithinMax = daysIsNumber && r.days <= MAX_ANNUAL_LEAVE_DAYS
const daysIsQuarterStep = daysIsNumber && (r.days * 4) % 1 === 0
if (!(daysIsPositive && daysWithinMax && daysIsQuarterStep)) {
  return `特休天數請填寫大於 0、不超過 ${MAX_ANNUAL_LEAVE_DAYS}、且為 0.25 的倍數的數字`
}
```

**`perYear`**，改寫成同樣的結構並加上上限：

```js
const perYearIsNumber = growthPerYear !== '' && Number.isFinite(growthPerYearNum)
const perYearIsNonNegative = perYearIsNumber && growthPerYearNum >= 0
const perYearWithinMax = perYearIsNumber && growthPerYearNum <= MAX_ANNUAL_LEAVE_DAYS
const perYearIsQuarterStep = perYearIsNumber && (growthPerYearNum * 4) % 1 === 0
if (!(perYearIsNonNegative && perYearWithinMax && perYearIsQuarterStep)) {
  return `每年增加天數請填寫 0 到 ${MAX_ANNUAL_LEAVE_DAYS} 之間、且為 0.25 的倍數的數字`
}
```

**`cap`**，只在 `growthPerYearNum > 0` 的分支內（C4）。原本的三句獨立訊息（「天數上限請填寫數字」「天數上限不可低於最後一列的天數（X 天）」「天數上限請填寫 0.25 的倍數」）合併成一句：

```js
if (growthPerYearNum > 0) {
  // ...lastDays as today
  const capIsNumber = growthCap !== '' && Number.isFinite(growthCapNum)
  const capAtLeastLastRow = capIsNumber && growthCapNum >= lastDays
  const capWithinMax = capIsNumber && growthCapNum <= MAX_ANNUAL_LEAVE_DAYS
  const capIsQuarterStep = capIsNumber && (growthCapNum * 4) % 1 === 0
  if (!(capAtLeastLastRow && capWithinMax && capIsQuarterStep)) {
    return `天數上限請填寫不低於 ${lastDays}（最後一列的天數）、不超過 ${MAX_ANNUAL_LEAVE_DAYS}、且為 0.25 的倍數的數字`
  }
}
```

在 `if (growthPerYearNum > 0)` 前加上 comment：

```js
// Every cap check must stay inside this branch. When perYear is 0 the cap
// input is disabled but its state may still hold a stale value (e.g. '9000'
// typed before perYear was set to 0); validating it here would block the
// save on a field the user cannot edit. The saved cap is 0 in that case.
```

在規則迴圈上方補一句順序說明：

```js
// Rows are validated before the growth row so the last row's days is
// guaranteed to be <= MAX_ANNUAL_LEAVE_DAYS by the time the cap is checked;
// otherwise "cap >= last row" and "cap <= MAX" could both be unsatisfiable.
```

### `src/utils/exportCsv.js`

在輸出規則列的地方加 comment（C9），不改邏輯：

```js
// Rule rows export the raw stored values, while per-period entitlements come
// from the calculated summary (clamped to MAX_ANNUAL_LEAVE_DAYS). Settings
// saved before #45 may therefore show e.g. a 1e23-day rule next to a 365-day
// entitlement. That is intentional: a backup should reflect the raw data.
```

### 單元測試

**`leaveCalculations.test.js`**

- `describe('getDaysForMilestone')`：
  - 門檻路徑：`[{ months: 12, days: 500 }]` 在 12 個月回傳 `MAX_ANNUAL_LEAVE_DAYS`。
  - 成長路徑：預設規則加 `{ perYear: 400, cap: 9000 }`，在 132 個月回傳 `MAX_ANNUAL_LEAVE_DAYS`。
  - 剛好等於上限的值原樣回傳（不被多夾）。
- `describe('calculateSummary')`：用 #45 的重現設定（到職日 `1900-01-01`、規則天數 `1e23`），本期 `entitledDays` 為 `MAX_ANNUAL_LEAVE_DAYS`。
- `describe('validateRecordsChain')`：舊的荒謬設定（例如 `[{ months: 12, days: 1e6 }]`、關閉遞延、到職日 `2020-01-01`、asOf 在 milestone 12 期間內），請 `MAX` 天有效、`MAX + 0.25` 天無效。這證明超支檢查用的是夾過的值。

**`settingsValidation.test.js`**，commit 2 的特徵測試中，天數、`perYear` 與 `cap` 的預期訊息都改成新的合成訊息（`cap` 原本的三句獨立訊息全部改為同一句），並新增：

| 欄位 | `MAX` | `MAX + 0.25` | `MAX + 0.1` | 其他 |
|---|---|---|---|---|
| 自訂規則天數 | `null` | 天數訊息 | 天數訊息 | `MAX - 0.9`（例如 364.1）→ 天數訊息，證明 0.25 檢查獨立生效；`1e23`、`Infinity`、空字串、0 → 天數訊息 |
| 每年增加天數 | `null` | `perYear` 訊息 | `perYear` 訊息 | `1e23`、空字串、負數、`1.1` → `perYear` 訊息 |
| 天數上限（`perYear > 0`） | `null` | 上限訊息 | 上限訊息 | `9000.1`、空字串、`'abc'`、低於最後一列、`16.1` → 上限訊息；剛好等於最後一列天數 → `null` |

再加：

- **C4**：`perYear: '0'`、`cap: '9000'` → `null`；`perYear: '0'`、`cap: ''` → `null`。
- **C3**：某列天數 `MAX + 0.25`，且 `cap: 'MAX + 0.25'` → 回傳天數訊息（不是上限訊息），證明規則列先於成長列檢查。
- 上限訊息中的最後一列天數由實際規則帶入：用預設規則（最後一列 16 天）時，訊息應含 `16`。

表格中的「天數訊息」「`perYear` 訊息」「上限訊息」分別指上方程式碼中三個欄位各自的合成訊息，測試裡以常數組出完整字串比對。

**`exportCsv.test.js`**：規則天數 `1e23` 的設定，規則列輸出原始值。用來把 C9 的決定鎖進測試。

### e2e：`e2e/onboarding-and-settings.spec.js`

**更新既有測試的預期訊息**：目前至少有兩條斷言現行的天數訊息（`'特休天數請填寫大於 0 的數字'`，輸入 `-` 那條）與 `perYear` 訊息（`'每年增加天數請填寫大於等於 0、且為 0.25 的倍數的數字'`，留空那條），改成由常數組出的新字串。成長列上限的既有測試（例如「天數上限低於最後一列天數時無法儲存並顯示錯誤」，以及留空、非 0.25 倍數的測試若存在）也都改為斷言新的上限合成訊息。請全檔搜尋所有 alert 訊息斷言，確認沒有遺漏。

**新增**（邊界組合已由單元測試覆蓋，e2e 只證明串接）：

1. **上限值可以儲存**：自訂規則最後一列天數、每年增加天數、天數上限都填 `MAX`，儲存成功並回到首頁。
2. **超過上限被擋**：自訂規則某列天數填 `MAX + 0.1`，比照既有 `page.once('dialog', …)` 寫法，斷言 alert 訊息，且仍停在設定頁。
3. **C4**：每年增加天數先填 1、天數上限填 9000，再把每年增加天數改成 0，按儲存。斷言沒有 alert、儲存成功，且 localStorage 的 `customGrowth` 為 `{ perYear: 0, cap: 0 }`。
4. **舊資料夾值**：用 `page.addInitScript` 預先寫入荒謬設定（`ruleType: 'custom'`、規則天數 `1e23`、已過第一個門檻的到職日），首頁 `summary-entitled` 顯示 `MAX_ANNUAL_LEAVE_DAYS`。寫入 localStorage 的方式比照既有 `LOCKED_SETTINGS` fixture。

### Commit message

```
fix: cap custom entitlement days at MAX_ANNUAL_LEAVE_DAYS (365)

Custom rule days and the growth row's cap had no upper bound, so the
entitlement -- the ceiling validateRecordsChain uses for overspend --
could be arbitrarily large, disabling every downstream "too many days"
guard.

- Add exported MAX_ANNUAL_LEAVE_DAYS = 365, a sanity ceiling rather
  than a precise limit.
- Reject custom rule days, perYear, and cap (when perYear > 0) above
  it. Rows are checked before the growth row.
- Each of the three fields now reports one message stating its full
  valid range, so a single alert shows every rule. The cap previously
  used a separate message per condition; conditions are still
  evaluated as named checks internally for a future inline-error UI.
- Custom rule days must now also be a multiple of 0.25, matching
  perYear and cap (previously values like 364.1 were accepted).
- Clamp getDaysForMilestone's custom results to the ceiling so settings
  saved before this change stay bounded. Stored data is not migrated.

Refs #45
```

---

## 6. Commit 4 — #30：數字欄位屬性對齊（`Fixes #30`）

### 屬性最終狀態

| 欄位 | 檔案 | `min` | `max` |
|---|---|---|---|
| 請假天數 | `LeaveForm.jsx` | `0.25`（不變） | 移除 `30`（C10） |
| 自訂規則天數 | `Settings.jsx` | `0` → `0.25` | 新增 `MAX_ANNUAL_LEAVE_DAYS` |
| 每年增加天數 | `Settings.jsx` | `0`（不變，0 合法） | 新增 `MAX_ANNUAL_LEAVE_DAYS` |
| 天數上限 | `Settings.jsx` | `0`（不變；真正下限是最後一列天數，屬動態值） | 新增 `MAX_ANNUAL_LEAVE_DAYS` |

在 `LeaveForm.jsx` 的天數輸入框加 comment：

```jsx
{/* No `max` on purpose: the real per-record ceiling is dynamic (carry-in +
    this period's entitlement + the next period's advance) and is enforced
    by validateRecordsChain in validate(). A fixed max here would only
    mislead (#30). */}
```

`LeaveForm` 的錯誤訊息維持現狀（`'這筆請假超支可用額度上限，請確認天數是否正確'`）。

### 單元測試：`leaveCalculations.test.js`，`describe('validateRecordsChain')`

證明單筆請假的真正上限是額度，而且可以超過 30 天：

- 情境：勞基法、到職日 `2000-01-01`、開啟遞延、前期完全沒請假、asOf 在 milestone 300 期間內。
- 額度在年資滿 24 年後固定為 30，所以遞延帶入 30、本期 30、可預支下期 30。
- 本期請 90 天有效，90.25 天無效。
- 測試 comment 列出算式：`availableTotal = carryIn 30 + entitled 30 - taken`，必須 ≥ `-nextEntitled 30`，所以 `taken ≤ 90`。

### e2e

- **超過 30 天的請假可以新增**：設定勞基法、到職日 `2000-01-01`、開啟遞延，新增一筆 45 天的請假，斷言新增成功。e2e 的「今天」是凍結的（目前為 `2025-06-15`，請以 HEAD 為準），此到職日下額度已固定為 30，不受日期影響。
- **屬性斷言**，併入既有相關 test，不另開：請假天數輸入框 `not.toHaveAttribute('max')`；設定頁三個欄位的 `min`、`max` 符合上表。

### Commit message

```
fix: align number input attributes with real validation

- LeaveForm: drop max={30}. It was never enforced (submit goes through
  onClick), and a legitimate record can exceed 30 days, e.g. with
  carryover after 10+ years of tenure. The real ceiling is the dynamic
  overspend allowance checked by validateRecordsChain.
- Settings: custom rule days min 0 -> 0.25 to match "must be > 0", and
  add max={MAX_ANNUAL_LEAVE_DAYS} to rule days, perYear and cap. These
  now mirror checks that validateSettingsInput actually enforces.

Fixes #30
Refs #45
```

---

## 7. Commit 5 — #29：日期展開加上上限（`Fixes #29`）

### `src/utils/leaveCalculations.js`

在 `getLeaveRecordDates` 上方新增常數（C12、C13）：

```js
// Upper bound on how many dates one leave record can expand to on the
// calendar. The overspend guard caps a single period's total leave at
// carry-in (<= the previous period's entitlement) + this period's
// entitlement + the next period's advance, each <= MAX_ANNUAL_LEAVE_DAYS.
// A fractional trailing day still occupies a date, so a valid record yields
// at most ceil(days) <= 3 * MAX_ANNUAL_LEAVE_DAYS dates and is never
// truncated. Anything longer is corrupt data (e.g. hand-edited localStorage,
// or records saved before #45), and without this bound the loop below would
// freeze the tab during LeaveCalendar's render (#29).
//
// A module constant rather than a function parameter, so no caller can
// pass a larger value and bypass the guard. Exported for tests only.
export const MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS;
```

函式本體：

```js
export function getLeaveRecordDates(startDate, days) {
  const start = typeof startDate === 'string' ? parseLocalDate(startDate) : startDate;
  const cursor = new Date(start);
  const dates = [];
  let remaining = Number(days);
  // A non-finite day count (NaN, Infinity) means the record is corrupt, so
  // mark nothing rather than guess. The bound below would already stop the
  // loop; this check exists to make that intent explicit.
  if (!Number.isFinite(remaining)) return dates;
  while (remaining > 0 && dates.length < MAX_LEAVE_RECORD_DATES) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(toISODateString(cursor));
      remaining -= 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
```

JSDoc 補一句：上限只影響月曆打點；已休天數由 `getLeaveTakenInPeriod` 直接加總 `days`，壞資料仍會在摘要上如實顯示為超支（C15）。

### 單元測試：`describe('getLeaveRecordDates')`

- `1e6` → 長度為 `MAX_LEAVE_RECORD_DATES`，而且函式能結束（Vitest 預設 timeout 兜底）。
- 剛好 `MAX_LEAVE_RECORD_DATES` → 回傳同樣數量的日期，沒被截斷。
- `MAX_LEAVE_RECORD_DATES - 0.5` → 仍回傳 `MAX_LEAVE_RECORD_DATES` 個日期，證明尾數佔一個日期的推導成立。
- `Infinity`、`NaN`、`'abc'`、`undefined` → `[]`。
- 字串 `'5'` → 與數字 `5` 結果相同。
- 既有三條測試不需修改，應照常通過。

### e2e

**壞資料不凍結分頁**：用 `page.addInitScript` 寫入合法設定，加上一筆 `days: 1e6`、開始日在本期內的記錄。斷言首頁月曆在預設 timeout 內渲染出來（至少有一個請假點），且摘要顯示超支（剩餘天數為負）。若防禦失效，分頁會凍結，這條測試會 timeout 失敗；這是唯一能在 CI 裡端到端證明 #29 修好的方法。

放在最貼近的既有 spec，或新增 `e2e/data-robustness.spec.js`，由實作時依既有結構判斷。

### Commit message

```
fix: bound calendar date expansion in getLeaveRecordDates

The weekday-walking loop had no upper bound, so a record with an absurd
day count (hand-edited localStorage, or saved before #45 capped
entitlements) could spin millions of times inside LeaveCalendar's render
and freeze the tab, out of reach of ErrorBoundary.

Stop after MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS dates, the
most a valid record can produce under the overspend guard, so valid
data is never truncated. Non-finite day counts now mark no dates. Only
calendar dots are affected; the summary still reports the raw total.

Fixes #29
Refs #45
```

---

## 8. PR 描述草稿

```
Closes #45

## 根因（#45）
自訂規則天數與成長列上限沒有上限，額度可以任意大，下游所有「天數太大」
的防線都跟著失效。新增 MAX_ANNUAL_LEAVE_DAYS = 365 作為合理性上限：
儲存時驗證（自訂規則天數、每年增加天數、天數上限），計算層另外夾值，
讓修正前已儲存的設定也不失控。localStorage 不做遷移。
順帶修正：自訂規則天數現在也要求 0.25 的倍數。

## #30 如何處理
請假天數的 max={30} 從未生效，且合法情境下單筆可超過 30 天，因此移除；
真正的上限是超支可用額度。設定頁三個天數欄位的 min/max 改為與實際驗證
一致。

## #29 如何處理
getLeaveRecordDates 最多展開 3 × MAX_ANNUAL_LEAVE_DAYS 個日期，這是
合法記錄的理論最大值，不會截斷合法資料；只防止壞資料凍結分頁。

## Commits
1. refactor: export MAX_MILESTONE_MONTHS（行為不變）
2. refactor: 設定驗證抽成純函式（行為不變，附特徵測試）
3. fix: 額度上限（#45 本體）
4. fix: 數字欄位屬性對齊（Fixes #30）
5. fix: 日期展開上限（Fixes #29）

## 不在本次範圍
- 設定頁錯誤改為 inline 紅字、一次列出所有未滿足條件（另開 issue）
```

---

## 9. 不在本次範圍

- 設定頁錯誤改成 inline 紅字、一次列出所有未滿足的條件（C7、C16，另開 issue）。
- 抽出或 export `normalizeCustomThresholds`，取代 `Settings.jsx` 的 `validThresholds`（C17）。
- 跨期請假的天數歸屬與月曆打點（#23）。
- 修正前已儲存資料的遷移（C8）。
