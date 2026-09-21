# 實作計畫：#45 自訂特休天數上限（併同處理 #29、#30）— 修訂版

> 本版依 Reviewer 意見修訂自上一版計畫。逐項回應見「Reviewer 意見回應」一節；程式碼片段與行號已用 Explore agent 重新對照 HEAD 驗證。

## Context

「公司另有規定」的自訂規則天數，以及成長列的 `cap`，目前完全沒有上限（#45，根因）。額度可以任意大，而額度正是 `validateRecordsChain` 判斷超支的天花板，所以下游所有「天數太大」的防線都跟著失效，衍生出兩個症狀：

- **#29**：`getLeaveRecordDates` 展開日期的 `while` 迴圈沒有上限。天數極大時，`LeaveCalendar` render 期間會跑百萬圈，分頁凍結。
- **#30**：`LeaveForm` 的 `max={30}` 只是 HTML 屬性，從未被強制（送出走 `onClick`）；設定頁天數欄位的 `min`/`max` 也和 JS 驗證對不上。

本計畫由維護者與 Claude Chat 事先討論定案（決策 C1–C17），經過兩輪對照 HEAD 程式碼與一輪 Reviewer 審查修訂而成。

外部 PR #42、#44 不採用，不引用其程式碼。

---

## Reviewer 意見回應

逐項評估上一版計畫收到的 Reviewer 意見，並說明本版如何處理。

### 必須修正（已全部接受）

1. **e2e 測試 4（舊資料夾值）不能放進「特休規則設定」describe。接受。**
   用 Explore agent 重新讀了 `e2e/onboarding-and-settings.spec.js`：`特休規則設定` 的 `beforeEach`（第 35–43 行）是 `freezeTime → goto('/') → 點「前往設定」`，**不 seed 任何 localStorage**，其自身註解就寫明「一旦 onboardDate 存檔，設定頁會鎖定，所以只能在第一次存檔前編輯規則」。緊接在 `既有資料相容性（#19）` describe 前的註解（第 339–344 行）進一步明講：`特休規則設定` 的 beforeEach 已經 `goto('/')`，若在它的某個 test 裡才呼叫 `seedAppStorage`，`page.addInitScript` 會太晚生效，而且當時也不在 `/` 上讀不到 `summary-*`。`既有資料相容性（#19）` 本身是**獨立的 top-level `describe`**（第 345 行開始，`特休規則設定` 已在第 337 行結束），在單一 test 內部照 `freezeTime → seedAppStorage → goto('/')` 順序做，沒有另外的 `beforeEach`。
   → 本版把新增的 4 條測試拆開：**測試 1–3**（上限值可存、超過上限被擋、C4）仍留在 `特休規則設定` describe——它們本來就是「從空白表單填值」的互動測試，不需要預先 seed，跟該 describe 既有測試（第 176–198、253–268 行等）性質一致。**測試 4**（舊資料夾值）改成獨立的 top-level `describe`，比照 `既有資料相容性（#19）` 的寫法：單一 test 內 `freezeTime → seedAppStorage → page.goto('/')`。

2. **Commit 4 的「超過 30 天請假可新增」e2e 需要 `seedAppStorage + page.reload()` 覆蓋 `beforeEach` 已 seed 的設定。接受。**
   Explore agent 確認 `calendar-and-records.spec.js` 頂層 `beforeEach` 會用 `BASE_SETTINGS = { onboardDate: '2024-06-15', ruleType: 'labor', customRules: [], allowCarryover: false }` seed；檔案第 96–112 行的既有測試（`編輯既有記錄...`）示範了同一個模式：`seedAppStorage({ settings: BASE_SETTINGS, records: [...] })` 後接 `page.reload()`，用來覆蓋預設值。本測試需要的設定（到職日 `2000-01-01`、`allowCarryover: true`）跟 `BASE_SETTINGS` 不同，必須照這個模式重新 seed 再 reload，原計畫漏了這步，已補上。
   關於記錄日期要落在哪一期：`FIXED_TODAY`（`e2e/helpers.js:19`）為 `2025-06-15`，到職日 `2000-01-01` 到這天約 305 個完成月，落在 milestone 300（24 年整用 `getLaborLawDays` 的 288 月觸頂條件，300 個月已經觸頂），對應期間約為 `2025-01-01`–`2025-12-31`。這個期間邊界沒有寫在程式碼註解裡，是用 305 個月反推的結果，**實作時請用實際的 `computePeriodLedger`/期間清單再核對一次**，不要直接照抄這裡的日期字串。

3. **C8 的 `Math.min(days, MAX_ANNUAL_LEAVE_DAYS)` 擋不住 NaN。接受。**
   Explore agent 確認 `getDaysForMilestone` 目前完全沒有 `Number(days)`/`Math.min(days, ...)` 這類防禦（`grep` 無結果）。手動編輯過的 localStorage 若缺 `days`（例如 `{ months: 12 }`），正規化階段 `Number(undefined)` 會產生 `NaN`；`Math.min(NaN, 365)` 仍是 `NaN`，`NaN` 會讓 `validateRecordsChain` 裡所有 `<`/`<=` 比較恆為 `false`，正是 C8 想關掉的破口沒關上。
   → 兩條回傳路徑都在夾值後補 `Number.isFinite` 檢查，非有限值時回傳 `0`（見下方 Commit 3 程式碼）。選 `0` 而非例如 `MAX` 的理由：這個分支處理的是「已存壞資料」，方向上應該偏向不给權益而不是給滿權益——跟 #45 想關掉的洞（額度過大導致超支防線失效）是同一個方向的錯誤，`0` 不會製造新的超支漏洞；`MAX` 則會。

4. **`exportCsv.test.js` 的「應結清工資天數反映夾值」測不出東西，且 `${1e23}` 格式化字串寫錯。接受。**
   Explore agent 確認 `buildBackupCsv(settings, records, summary)` 的 `summary` 是呼叫端傳入的參數，`exportCsv.test.js` 既有測試（第 100、128 行）都是手搓 `{ hasLeave: true, periods: [{ remaining: 0 }] }`。若照原計畫手搓 `remaining: 365`，只是斷言「輸入 365 輸出 365」，不會驗證到 `getDaysForMilestone` 的夾值邏輯——那段邏輯已經在 `leaveCalculations.test.js` 的 `calculateSummary` 測試裡驗證過了。
   → 移除「應結清工資天數反映夾值」這條 `exportCsv.test.js` 測試，只保留「規則列輸出原始值」。同時修正字串：JS 的 `${1e23}` 會被格式化成 `1e+23`（非 `1e23`），改成規則列 `12,1e+23`（假設門檻為 12 個月）。

### 建議（已接受）

5. **Commit 3 的 `calculateSummary` 單元測試（到職日 `1900-01-01`、規則天數 `1e23`）需要明確傳入固定的 `today`。接受。**
   Explore agent 確認 `calculateSummary(settings, records, today = new Date())` 的第三個參數預設 `new Date()`。原計畫沒交代這條測試要傳什麼 `today`，會變成依賴系統時鐘、每天執行結果可能不同的測試。
   → 這條測試必須明確傳入固定日期（不可省略讓它吃預設值），日期只要晚於門檻生效時間即可；實作時比照同檔案其他 `calculateSummary` 測試已經在用的固定日期慣例，不另創新格式。

### 非錯誤提醒（逐項回應）

- **e2e 若無法 `import src/utils` 需先回報**：原計畫已直接假設可行但未先驗證一條。這點合理，補進 §測試原則：寫 4 條新 e2e 前，先讓其中一條 import 常數並跑過，確認 Playwright 設定支援 ESM `import`，再繼續寫其餘的。
- **設定頁合規警告（`checkLaborLawCompliance`）也會吃到夾值，計畫未提及**：**不接受，這點提醒本身不成立。** 另外派了一個 Explore agent 讀 `Settings.jsx:50–59` 與 `checkLaborLawCompliance`（`leaveCalculations.js:548` 起）：這個警告只在 `custom < legal`（規則天數低於勞基法**最低**標準）時才會推入 `warnings`，UI 文案也明講「以下年資區間的天數**低於**勞基法最低標準」。`MAX_ANNUAL_LEAVE_DAYS` 的夾值只影響「大於 365」的值，而勞基法最低天數最高只到 30，一個原本 9000（夾值後 365）的規則永遠是 `custom > legal`，夾不夾都不會觸發這個警告、也不會改變它顯示的數字。這條連帶影響不存在，計畫不需要為此新增任何內容。
- **`leaveCalculations.test.js:803` 可順手把字面 `1200` 換成常數**：Explore agent 確認第 803 行是另一條測試（`clamps the horizon at MAX_MILESTONE_MONTHS instead of hanging when perYear is vanishingly small`）裡 `expect(w.fromMonths).toBeLessThanOrEqual(1200)` 的斷言，测试名稱本身就指向 `MAX_MILESTONE_MONTHS`，兩者很可能是同一個视界上限。**採納，但加一道保險**：Commit 1 換掉 `Settings.jsx` 的 4 處字面 `1200` 時，一併確認 `checkLaborLawCompliance` 內部限制这个视界的常数是否就是 `MAX_MILESTONE_MONTHS`——若是，把這行測試也换成常數；若視界上限其實是另一個巧合等於 1200 的獨立邏輯，則保留字面值並加一行註解說明二者無關，避免誤導未來調整 `MAX_MILESTONE_MONTHS` 的人以為這條測試也會跟著變。

---

## 決策紀錄摘要（完整理由見附錄，逐條保留原文）

| 代號 | 決策重點 |
|---|---|
| C1 | 新增 `export const MAX_ANNUAL_LEAVE_DAYS = 365`，合理性上限非精算值 |
| C2 | `handleSave`／新驗證函式檢查三個值：每列天數、`perYear`、`cap`（僅 `perYear > 0` 時） |
| C3 | 先驗每列天數再驗成長列，避免「`cap` 不可低於最後一列」與「`cap` 不可超過上限」同時無解 |
| C4 | `perYear = 0` 時完全不驗 `cap`，但仍要能存成 `{ perYear: 0, cap: 0 }` |
| C5 | 自訂規則天數補 0.25 倍數驗證（現況缺漏，364.1、1.3 目前能存） |
| C6 | 三個天數欄位的錯誤訊息各自合成一句，一次講完合法範圍；內部仍分別具名判斷 |
| C7 | 錯誤呈現沿用 `alert()`，inline 紅字不在本次範圍 |
| C8 | `getDaysForMilestone` custom 分支兩條 return 都夾 `MAX_ANNUAL_LEAVE_DAYS`，並加 `Number.isFinite` 防止 NaN 繞過（本版新增） |
| C9 | CSV 備份規則列與成長設定輸出原始值，應結清工資天數才是夾值後的計算結果（測試範圍已收斂） |
| C10 | `LeaveForm` 移除 `max={30}`，不設替代值（真正上限是動態的） |
| C11 | 設定頁數字欄位 HTML 屬性與 JS 驗證對齊 |
| C12 | `getLeaveRecordDates` 加 `MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS`（=1095），推導自超支檢查的三期額度上限 |
| C13 | `MAX_LEAVE_RECORD_DATES` 是模組常數，不是函式參數，呼叫端無法繞過 |
| C14 | 新增 `Number.isFinite` 防禦（現況完全沒有此檢查與 `Number()` 轉型，是新增程式碼） |
| C15 | 上限只影響月曆打點，首頁摘要仍如實加總 `days` |
| C16 | 驗證抽成純函式，回傳第一個錯誤字串或 `null` |
| C17 | 重構只處理常數與驗證抽出，`Settings.jsx` 的 `validThresholds` filter 只換常數不改結構 |

---

## 測試原則

1. 用最低成本的那一層證明行為：純計算與驗證邏輯用 Vitest 單元測試；只有 UI 串接（alert 是否出現、是否真的存入、render 是否凍結）才寫 Playwright e2e。
2. 每個有上限的欄位測三種值：`MAX`（剛好在上限，通過）、`MAX + 0.25`（合法步進下的最小越界，只測上限本身）、`MAX + 0.1`（同時違反上限與 0.25 倍數，證明合成訊息）。
3. 測試引用常數，不寫死數字；斷言訊息時比對完整字串。
4. **寫 e2e 前先驗證 import 可行**：4 條新增的 e2e 測試都需要 `import { MAX_ANNUAL_LEAVE_DAYS } from '../src/utils/leaveCalculations.js'` 之類的寫法。先讓其中一條這樣 import 並跑過，確認 Playwright 設定支援後，再繼續寫其餘測試；若不支援，回報後再決定替代方案。
5. 每個 commit 結束時，`npm test` 與 e2e 都必須通過。

---

## Commit 1 — 重構：export `MAX_MILESTONE_MONTHS`（`Refs #45`）

**行為不變。**

### `src/utils/leaveCalculations.js`（第 117–120 行）
```js
// Sanity ceiling for any month-threshold value. ...
export const MAX_MILESTONE_MONTHS = 1200; // 100 年
```
只加 `export`，comment 原樣保留。

### `src/components/Settings.jsx`
全檔 4 處寫死 `1200`：
1. 第 120 行：`if (!Number.isInteger(r.months) || r.months < 1 || r.months > 1200)`
2. 第 121 行訊息：`alert('年資門檻請填寫 1200 個月（100 年）以內的正整數')` → 改為由常數組出：
   ```js
   `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`
   ```
   組出字串須與現行逐字相同。
3. 第 202 行：`validThresholds` 的 `.filter(m => Number.isInteger(m) && m >= 1 && m <= 1200)` → 換成常數（C17：不改結構）。
4. 第 336 行：月數 input 的 `max={1200}` → `max={MAX_MILESTONE_MONTHS}`。

import 處（第 3 行）加入 `MAX_MILESTONE_MONTHS`。

### `src/utils/leaveCalculations.test.js`
第 803 行 `expect(w.fromMonths).toBeLessThanOrEqual(1200)`：先確認 `checkLaborLawCompliance` 內部限制這個視界的常數是否就是 `MAX_MILESTONE_MONTHS`。若是，換成常數；若不是，保留字面值並加註解說明兩者無關。

不新增其他測試。跑一次既有 e2e（`年資門檻超過安全上限時無法儲存`，第 146–163 行，填 `1201` 斷言訊息）確認訊息組成方式沒有 regress。

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

## Commit 2 — 重構：抽出設定驗證純函式（`Refs #45`）

**行為不變。**

### 新檔 `src/utils/settingsValidation.js`

把 `Settings.jsx` 現行 `handleSave`（第 84–172 行）裡「到職日檢查 → custom 規則列表為空 → 逐列門檻/重複/天數 → perYear → cap」的完整驗證邏輯搬進 `validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap })`，每個 `alert(msg); return` 改成 `return msg`，全部通過後 `return null`。

- `normalizedRules`（第 91–95 行）、`sorted`（第 111 行）、`growthPerYearNum`/`growthCapNum`（第 100–101 行）在函式內部自行計算。
- `lastDays`（第 143–145 行）也搬進來，需要在新檔 import `getDaysForMilestone`。
- JSDoc 說明為何回傳單一訊息而非清單——收集所有錯誤需要決定檢查之間的依賴關係，屬於未來 inline 錯誤 UI 的設計工作，不在本次重構範圍內。

### `src/components/Settings.jsx`

```js
function handleSave() {
  const error = validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap })
  if (error) {
    alert(error)
    return
  }
  // 沿用現行第 91–101、161–171 行：組 normalizedRules / growthPerYearNum / growthCapNum，呼叫 onSave(...)
}
```
`onSave` payload 組成邏輯留在 `handleSave`，不搬進驗證函式。

### 單元測試：新檔 `src/utils/settingsValidation.test.js`

把現行行為逐條寫成特徵測試：

- 到職日為空 → `'請填寫到職日'`
- `ruleType: 'labor'`、其他欄位空/不合法 → `null`
- custom、規則列表為空 → `'請至少保留一條自訂規則'`
- 門檻非整數 / `< 1` / `> 1200` → `'年資門檻請填寫 1200 個月（100 年）以內的正整數'`
- 門檻重複 → `` `年資門檻「${months} 個月」重複，請合併或刪除其中一列` ``
- 天數為 0、負數、空字串 → `'特休天數請填寫大於 0 的數字'`（此 commit 尚未加 0.25 檢查，留到 Commit 3）
- `perYear` 空字串、負數、非 0.25 倍數 → `'每年增加天數請填寫大於等於 0、且為 0.25 的倍數的數字'`
- `perYear > 0` 時：`cap` 空字串 → `'天數上限請填寫數字'`；低於最後一列 → `` `天數上限不可低於最後一列的天數（${lastDays} 天）` ``；非 0.25 倍數 → `'天數上限請填寫 0.25 的倍數'`
- 預設規則（12mo/10 天、24mo/14 天）加 `{ perYear: '1', cap: '30' }` → `null`

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

## Commit 3 — #45 本體：額度上限（`Refs #45`）

### `src/utils/leaveCalculations.js`

在 `MAX_MILESTONE_MONTHS` 旁新增：
```js
// Sanity ceiling for any entitlement value -- a single custom rule's days,
// the growth row's perYear and its cap. Rejects absurd input only; NOT a
// precise physical limit (a period can be shorter than 12 months, so even
// 260 weekdays isn't exact either). 365 makes the error message
// self-explanatory. Don't "correct" it to 260 (#45).
//
// Enforced in two places: validateSettingsInput() rejects new input with a
// message, and getDaysForMilestone() silently clamps values saved before
// this limit existed.
export const MAX_ANNUAL_LEAVE_DAYS = 365;
```

`getDaysForMilestone` custom 分支（現行第 191–201 行）**替換為**（新增 `Number.isFinite` 防護）：
```js
    const lastRule = validRules[validRules.length - 1];
    const { perYear, cap } = normalizeCustomGrowth(customGrowth);
    if (perYear > 0 && milestoneMonths > lastRule.months) {
      const k = Math.floor((milestoneMonths - lastRule.months) / 12);
      const grown = Math.min(
        lastRule.days + perYear * k,
        Math.max(cap, lastRule.days),
        MAX_ANNUAL_LEAVE_DAYS,
      );
      // NaN poisons every Math.min/Math.max comparison (all comparisons
      // involving NaN are false), so corrupt stored data -- e.g. a rule
      // missing `days`, normalized to Number(undefined) = NaN -- would
      // otherwise slip through unclamped instead of being caught here.
      // Falling back to 0 keeps the safe direction: an entitlement of 0
      // cannot cause the overspend hole #45 closes, while falling back to
      // MAX_ANNUAL_LEAVE_DAYS would just recreate a smaller version of it.
      return Number.isFinite(grown) ? grown : 0;
    }
    const clamped = Math.min(days, MAX_ANNUAL_LEAVE_DAYS);
    return Number.isFinite(clamped) ? clamped : 0;
```
`validRules.length === 0` 時回傳的 `days` 是初始值 `0`（不受影響）；勞基法分支（`getLaborLawDays`，最高 30 天）不需要動。

### `src/utils/settingsValidation.js`

import `MAX_ANNUAL_LEAVE_DAYS`。三個欄位改寫成具名布林 + 合成訊息（C6），三段檢查最上方加註解說明為何合成一句：
```js
// Each field's conditions are evaluated as separately named booleans, but
// any failure returns ONE message stating the field's full valid range.
// With alert() as the only feedback, per-condition messages made users fix
// one rule only to be stopped by the next. The named conditions are kept so
// a future inline-error UI can report each one individually.
```

自訂規則天數：
```js
const daysIsNumber = Number.isFinite(r.days)
const daysIsPositive = daysIsNumber && r.days > 0
const daysWithinMax = daysIsNumber && r.days <= MAX_ANNUAL_LEAVE_DAYS
const daysIsQuarterStep = daysIsNumber && (r.days * 4) % 1 === 0
if (!(daysIsPositive && daysWithinMax && daysIsQuarterStep)) {
  return `特休天數請填寫大於 0、不超過 ${MAX_ANNUAL_LEAVE_DAYS}、且為 0.25 的倍數的數字`
}
```

`perYear`：
```js
const perYearIsNumber = growthPerYear !== '' && Number.isFinite(growthPerYearNum)
const perYearIsNonNegative = perYearIsNumber && growthPerYearNum >= 0
const perYearWithinMax = perYearIsNumber && growthPerYearNum <= MAX_ANNUAL_LEAVE_DAYS
const perYearIsQuarterStep = perYearIsNumber && (growthPerYearNum * 4) % 1 === 0
if (!(perYearIsNonNegative && perYearWithinMax && perYearIsQuarterStep)) {
  return `每年增加天數請填寫 0 到 ${MAX_ANNUAL_LEAVE_DAYS} 之間、且為 0.25 的倍數的數字`
}
```

`cap`（僅 `growthPerYearNum > 0` 分支內，加註解說明為何 `cap` 一定要留在此分支）：
```js
// Every cap check must stay inside this branch. When perYear is 0 the cap
// input is disabled but its state may still hold a stale value (e.g. '9000'
// typed before perYear was set to 0); validating it here would block the
// save on a field the user cannot edit. The saved cap is 0 in that case.
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

在規則迴圈上方補順序說明：
```js
// Rows are validated before the growth row so the last row's days is
// guaranteed to be <= MAX_ANNUAL_LEAVE_DAYS by the time the cap is checked;
// otherwise "cap >= last row" and "cap <= MAX" could both be unsatisfiable.
```

### `src/utils/exportCsv.js`

在 `settlementDays` 計算處加註解，不改邏輯：
```js
// Rule rows and the growth settings below export the raw stored values.
// settlementDays is the one derived value here -- it comes from
// calculateSummary's result, which clamps entitledDays to
// MAX_ANNUAL_LEAVE_DAYS. Settings saved before #45 may therefore show e.g.
// a raw 1e23-day rule next to a settlement figure capped at 365. That is
// intentional: a backup should reflect the raw data, while the settlement
// amount reflects what the app would actually pay out.
```

### 單元測試

**`leaveCalculations.test.js`**
- `getDaysForMilestone`：門檻路徑 `[{months:12, days:500}]` 於 12 個月回傳 `MAX_ANNUAL_LEAVE_DAYS`；成長路徑用預設規則加 `{perYear:400, cap:9000}` 於 132 個月回傳 `MAX_ANNUAL_LEAVE_DAYS`；剛好等於上限的值原樣回傳；**新增**：`{ months: 12 }` 缺 `days`（正規化後為 `NaN`）回傳 `0`，不是 `NaN`。
- `calculateSummary`：到職日 `1900-01-01`、規則天數 `1e23`，**明確傳入固定的第三參數 `today`**（不可省略，比照同檔案其他 `calculateSummary` 測試已用的固定日期慣例），本期 `entitledDays` 為 `MAX_ANNUAL_LEAVE_DAYS`。
- `validateRecordsChain`：沿用既有測試模式（第 445–459 行的三期額度組合），改用荒謬設定（如 `[{months:12, days:1e6}]`）驗證 `MAX` 天有效、`MAX + 0.25` 天無效，證明超支檢查用的是夾過的值。

**`settingsValidation.test.js`**：commit 2 的特徵測試改成新合成訊息，並依 §測試原則的三值表逐欄位新增邊界測試，加上：
- C4：`perYear:'0'`、`cap:'9000'` → `null`；`perYear:'0'`、`cap:''` → `null`
- C3：某列天數 `MAX+0.25` 且 `cap:'MAX+0.25'` → 回傳天數訊息（不是上限訊息）
- 上限訊息用預設規則（最後一列 16 天）驗證訊息含 `16`

**`exportCsv.test.js`**（範圍已收斂）：規則天數 `1e23` 的設定，規則列輸出原始值，斷言字串為 `` `12,1e+23` ``（`1e23` 轉字串是 `1e+23`）。**不新增**「應結清工資天數反映夾值」的測試——測不出東西，已由 `calculateSummary` 測試覆蓋。

### e2e：`e2e/onboarding-and-settings.spec.js`

**更新既有斷言**：
1. 第 176–198 行（天數欄位打 `-`），斷言在第 195 行 → 新合成訊息
2. 第 253–268 行（`perYear` 留空），斷言在第 266 行 → 新合成訊息
3. 第 270–286 行（`cap` 低於最後一列），斷言在第 284 行 → 新合成訊息
4. 第 288–303 行（`cap` 非 0.25 倍數），斷言在第 301 行 → 新合成訊息

**新增測試 1–3，加進「特休規則設定」describe**（不需 seed）：上限值可存、超過上限被擋、C4（perYear 改 0 後 cap 一併存為 0）。

**新增測試 4，獨立成 top-level describe**（不放進「特休規則設定」）：比照「既有資料相容性（#19）」的寫法，單一 test 內 `freezeTime → seedAppStorage → page.goto('/')`，寫入荒謬規則天數，斷言首頁額度顯示 `MAX_ANNUAL_LEAVE_DAYS`。

---

## Commit 4 — #30：數字欄位屬性對齊（`Fixes #30`）

| 欄位 | 檔案 | 現況 | 改為 |
|---|---|---|---|
| 請假天數 | `LeaveForm.jsx` | `min={0.25}` `max={30}` | 移除 `max` |
| 自訂規則天數 | `Settings.jsx` | `min={0}`，無 `max` | `min={0.25}`，`max={MAX_ANNUAL_LEAVE_DAYS}` |
| 每年增加天數 | `Settings.jsx` | `min={0}`，無 `max` | `max={MAX_ANNUAL_LEAVE_DAYS}` |
| 天數上限 | `Settings.jsx` | `min={0}`，無 `max` | `max={MAX_ANNUAL_LEAVE_DAYS}` |

`LeaveForm.jsx` 天數輸入框加註解說明真正上限是動態的超支額度。

### 單元測試
`validateRecordsChain`：勞基法、到職日 `2000-01-01`、開啟遞延、前期無請假、`asOf` 落在 milestone 300（三期額度皆 30），本期請 90 天有效、90.25 天無效。

### e2e
**超過 30 天請假可新增**：`calendar-and-records.spec.js` 新增測試，**必須**呼叫 `seedAppStorage({ settings: {...BASE_SETTINGS, onboardDate: '2000-01-01', allowCarryover: true}, records: [...] })` 後接 `page.reload()`（比照該檔第 96–112 行既有模式）覆蓋 `beforeEach` 已 seed 的 `BASE_SETTINGS`。記錄開始日須落在 milestone-300 對應當期（實作前用實際期間計算重新確認邊界），天數填 45，斷言新增成功。屬性斷言併入既有測試。

---

## Commit 5 — #29：日期展開加上上限（`Fixes #29`）

### `src/utils/leaveCalculations.js`

新增常數：
```js
export const MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS;
```

**替換整個函式體**：
```js
export function getLeaveRecordDates(startDate, days) {
  const start = typeof startDate === 'string' ? parseLocalDate(startDate) : startDate;
  const cursor = new Date(start);
  const dates = [];
  let remaining = Number(days);
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

### 單元測試
新增：`1e6`（長度等於上限）、剛好等於上限（不截斷）、`上限 - 0.5`（仍等於上限）、`Infinity`/`NaN`/`'abc'`/`undefined`（皆為 `[]`）、字串 `'5'` 與數字 `5` 一致。

### e2e
**壞資料不凍結分頁**：`calendar-and-records.spec.js` 新增 describe「壞資料健壯性 (#29)」，seed 一筆 `days: 1e6` 的記錄，斷言首頁月曆能在預設 timeout 內渲染完成且摘要顯示超支。

---

## PR 描述、驗證方式、不在本次範圍

與上一版相同，僅 PR 描述補一句「計算層另外夾值並以 `Number.isFinite` 擋掉 NaN」；驗證方式新增一條：Commit 4 實作前先用實際期間計算核對記錄日期邊界，不要直接照抄推算值。

---

**摘要**：Reviewer 的 5 項意見（3 項必須、2 項建議）全部接受並已修改進計畫；3 項「非錯誤提醒」中，e2e import 驗證與 `leaveCalculations.test.js:803` 兩項採納，「合規警告連帶受影響」一項經查證後判定不成立、予以否決（理由已寫入上方「Reviewer 意見回應」段落）。完整計畫已寫入 `/home/node/.claude/plans/workspaces-annual-leave-calculator-agen-effervescent-puzzle.md`。
