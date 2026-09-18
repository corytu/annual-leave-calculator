# annual-leave-calculator 修正實作計畫

依據：審閱報告 `882e0e7-review-report.md`（審閱版本 commit 882e0e7）與後續討論結論
範圍：P0-1、P0-2、P0-3、P1-1、P2-3、P2-8，以及合規檢查缺口（#35）
對應 issue：#19、#20、#21、#22、#28、#33、#35

---

## 0. 給 Claude Code 的工作守則

1. **一個 PR、八個 commit，依本文順序進行。** 每個 commit 都要做到：
   - 先寫（或改）測試，跑一次確認它**因為預期的原因**失敗；
   - 再修改程式；
   - 最後跑完整的單元測試與 e2e（用 `package.json` 既有的 scripts），全部通過才進下一個 commit。
2. **Commit message 附 issue 關鍵字，並用英文撰寫。** 格式見各 commit 標題，例如 `Fixes #19`、`Refs #35`。
   - 第一行為英文簡述（最多 72 字元），後跟 issue 關鍵字；
   - 若需詳細說明，空一行後用英文撰寫，不用中文。
3. **不做重構。** 「不做的事」清單見第 10 節。碰到清單上的東西，即使順手也不要改。
4. **命名慣例。**
   - 單元測試標題沿用現有的**英文**寫法，e2e 標題沿用現有的**中文**寫法。
   - 新的程式註解沿用現有風格：英文為主，說明「為什麼」。
   - e2e 註解沿用現有做法，把每個期望數字的來源算給讀者看。
5. **錯誤回饋沿用 `alert()`。** Settings 的驗證錯誤一律用 `alert()`，e2e 沿用 `page.once('dialog', …)` 攔截，不要改成行內錯誤訊息。
6. **沿用字串綁定。** 新增的數字輸入框沿用「state 存原始字串、用到時才 `Number()`」的寫法（先前修掉數字輸入框歸零 bug 時採用的模式），不要綁數值 state。

---

## 1. 已定案的設計決定（實作時不要更動）

| # | 決定 | 理由 |
|---|---|---|
| D1 | 自訂門檻之間的切點採**往前補**：從每個門檻起每 12 個月切一期，不足一年的零頭放在下一個門檻之前。 | 與「最後一個門檻之後逐年延伸」的既有邏輯一致；也符合「達到門檻即開始完整一年」的欄位語意。報告範例程式是往回補，而且註解與程式碼互相矛盾，**不要照抄**。 |
| D2 | 門檻重複、門檻清單為空的驗證沿用 `alert()`。報告驗證範例中的「天數須為 0.25 倍數」「不可超過 365 天」**不納入**。 | 那兩條屬於 P2-5，不在本輪範圍。 |
| D3 | `calculateSummary` 遇到「自訂規則但沒有任何有效門檻」時，回傳 `hasLeave: false` 並附明確訊息。 | 修正前已存進 localStorage 的空規則資料，因設定鎖定而無法從 UI 修改。 |
| D4 | P1-1、P2-3 都用 `key={activePeriod.milestoneMonths}` 讓元件重建（報告的修法 A），不採用受控 `activeStartDate` 的修法 B。 | 這是 React 慣用的狀態重置方式，改動最小。前提是 `milestoneMonths` 唯一，由 commit 1 的去重保證。 |
| D5 | 點擊「目前已選取的分頁」時什麼都不做（`handleSelectPeriod` 開頭直接 return）。 | 修掉報告未提到的 bug：編輯中點目前分頁會讓表單退回新增模式但保留舊值，再按「新增」會產生重複記錄。 |
| D6 | P2-8 揭露文案為「**圓點只跳過週六日，未考慮國定假日與補班日**」。 | 補班日是「該標卻沒標」，不是「該扣卻沒扣」。 |
| D7 | 新增「成長列」：固定顯示在自訂規則表最下方。左欄唯讀，顯示「滿 {最後門檻+12} 個月起」；右欄為「每年加 X 天，上限 Y 天」。資料存成設定層級的 `customGrowth: { perYear, cap }`，**不放進** `customRules` 陣列。 | 讓照勞基法逐年遞增的公司不必手打十幾列；也讓預設自訂規則在合規檢查修正後不會一打開就出現警告。 |
| D8 | `customGrowth` 的預設值分兩種：**新使用者**在 Settings 預填 `{ perYear: 1, cap: 30 }`；**既有資料**（localStorage 沒有此欄位）載入時補成 `{ perYear: 0, cap: 0 }`，代表「不再增加」。 | 不默默改變既有使用者的天數。 |
| D9 | `perYear` 為 0 時，上限欄位停用，儲存時 `cap` 一律存成 0。 | `cap` 在不增加時沒有意義。 |
| D10 | `perYear` 須為 ≥ 0、且為 0.25 倍數的數字，不可留空；`perYear > 0` 時，`cap` 不可低於最後一列的天數。 | 0.25 倍數用浮點數表示沒有誤差，也與請假單位一致。 |
| D11 | 合規檢查改為在「勞基法切點 ∪ 自訂切點」的每一點比較天數，檢查範圍到兩邊天數都不再變化為止；連續不足的點**合併成一個區間**顯示。 | 兩邊的天數都只在各自的切點上改變，所以檢查聯集等於檢查所有時間點。這樣也能抓到「第一個門檻晚於 6 個月」的缺口。 |
| D12 | 成長參數用**尾端可省略參數**（預設為 `NO_CUSTOM_GROWTH`）逐層傳遞，不改成傳入整個設定物件。 | 既有呼叫與測試不需修改；避免變成報告 R5 那種結構重構。 |
| D13 | 勞基法天數上限在滿 **288 個月**（24 年）才達到 30 天，不是報告附錄所寫的 240 個月。 | 以 `getLaborLawDays` 現有實作為準：120 個月為 16 天，之後每年加 1 天。 |

---

## 2. Commit 1 — 自訂門檻正規化與年度切點補齊（`Fixes #19`, `Fixes #20`）

### 網頁程式碼：`src/utils/leaveCalculations.js`

**新增私有 helper `normalizeCustomThresholds(customRules)`（不 export）。** 它把門檻清成「數字、正整數、去重、遞增」：

```js
/**
 * Clean user-entered thresholds into sorted, de-duplicated positive integers.
 * Duplicates must be removed here: getPeriodInfo() looks up the next
 * milestone by position, so a repeated value would make a period end
 * before it starts (#20).
 */
function normalizeCustomThresholds(customRules) {
  return [...new Set(
    (customRules ?? [])
      .map(r => Number(r?.months))
      .filter(m => Number.isInteger(m) && m >= 1)
  )].sort((a, b) => a - b);
}
```

**改寫 `getMilestones()` 的自訂規則分支（D1）。** 勞基法分支不動。示意如下：

```js
export function getMilestones(ruleType, customRules, upToMonths = 360) {
  if (ruleType !== 'custom') return buildLaborLawMilestones(upToMonths);

  const thresholds = normalizeCustomThresholds(customRules);
  // Kept as a last-resort fallback; calculateSummary() short-circuits
  // before this is reached for a real "no valid thresholds" settings object.
  if (thresholds.length === 0) return [6];

  const milestones = [];
  thresholds.forEach((current, i) => {
    const next = thresholds[i + 1];
    if (next === undefined) {
      milestones.push(current);
      for (let m = current + 12; m <= upToMonths + 12; m += 12) milestones.push(m);
    } else {
      // Cut a new period every 12 months counting forward from this
      // threshold, so no period between two thresholds exceeds a year (#19).
      // Any sub-year remainder therefore sits just before `next`.
      for (let m = current; m < next; m += 12) milestones.push(m);
    }
  });
  return milestones;
}
```

**更新 `getMilestones` 的 JSDoc**，說明三件事：
- 自訂規則的期間永遠不超過 12 個月；
- 採往前補，零頭放在下一個門檻之前；
- 門檻會先去重。

`getDaysForMilestone`、`getPeriodInfo` 在這個 commit **不改**。原本「取 ≤ milestone 的最高門檻」的邏輯，會讓補進來的切點自動沿用下層門檻的天數。

### 單元測試：`src/utils/leaveCalculations.test.js`

在 `describe('getMilestones …')` 附近新增 `describe('getMilestones (custom rules yearly grid)')`。下列測試會用到「與 `Settings.jsx` 的 `DEFAULT_CUSTOM_RULES` 相同的門檻與天數」這組資料，請在測試檔宣告成常數，並加註解說明它對應 `Settings.jsx`（`[6:3, 12:7, 24:10, 36:14, 60:15, 120:16]`）。

- `produces the same milestones as labor law for the default custom thresholds`
  - 斷言 `getMilestones('custom', defaults, 200)` 等於 `getMilestones('labor', [], 200)`。
- `fills yearly cut points forward from each threshold, leaving any short remainder just before the next threshold`
  - 門檻 `[6, 12, 30]`，斷言結果開頭為 `[6, 12, 24, 30, 42]`。
- `never produces a gap longer than 12 months between consecutive milestones`
  - 用數組門檻（含 `[6, 12, 30]`、`[3, 40]`、預設值）逐一斷言相鄰差值 ≤ 12。
- `deduplicates repeated thresholds`
  - 門檻 `[12, 12, 24]`，結果不含重複值。
- `ignores thresholds that are not positive integers`
  - 門檻含 `0`、`-6`、`1.5`、`NaN`、`12`，結果以 12 開頭。
- 既有的 `returns [6] fallback for empty custom rules` 與 `extends custom rules annually past the last defined rule` **保持不變**，而且必須繼續通過。

在 `describe('getDaysForMilestone')` 新增：

- `gives a gap-filled milestone the days of the highest threshold at or below it`
  - 用預設值，斷言 48 個月為 14 天、72 個月為 15 天。

在 `describe('getPeriodInfo')` 新增：

- `spans exactly 12 months at milestone 36 under the default custom thresholds`
  - 到職日 2020-01-01，斷言期間為 2023-01-01 ~ 2023-12-31。
- `never ends before it starts when custom thresholds are duplicated`
  - 門檻 `[{12, 7}, {12, 9}]`，斷言 `periodEnd > periodStart`。

在 `describe('calculateSummary')` 新增：

- `starts a new 12-month period every year under the default custom thresholds`
  - 到職日 2020-01-01、today 2024-01-01。
  - 斷言共 5 期，最新一期的 `milestoneMonths` 為 48，期間為 2024-01-01 ~ 2024-12-31，`entitledDays` 為 14。
  - 這是報告的重現案例；修正前，最新一期是跨兩年的 2023-01-01 ~ 2024-12-31。

### 網頁程式碼：`src/components/MainPage.jsx`（僅為測試新增選擇器）

在「本年度週年制區間」那個 `div` 加上 `data-testid="period-range"`。

### e2e：`e2e/onboarding-and-settings.spec.js`，`describe('特休規則設定')` 內新增

- `公司另有規定使用預設門檻時，滿 4 年後仍是 12 個月一期`
  - **為什麼走 UI 而不 seed 資料：** 預設門檻定義在 `Settings.jsx`，seed 等於把它抄一份進測試，日後改預設值時守不到。這點要寫成註解。
  - **步驟：** 點「公司另有規定」，不改任何規則；到職日填 `2021-06-15`（凍結的 today 為 2025-06-15，年資正好 48 個月）；儲存。
  - **斷言：**
    - `period-range` 包含 `2025-06-15` 與 `2026-06-14`；
    - `summary-entitled` 為 14；
    - 期別分頁共 5 個，第一個是 `2025–26`。
  - 註解寫明：修正前會落在 milestone 36，期間是 2024-06-15 ~ 2026-06-14，橫跨兩年。

---

## 3. Commit 2 — 無有效門檻時的首頁防線（`Refs #21`）

### 網頁程式碼：`src/utils/leaveCalculations.js`

在 `calculateSummary()` 的「未填到職日」檢查之後、計算帳本之前加入：

```js
// Settings saved before #21 was fixed can hold a custom rule set with no
// usable thresholds. The settings page is locked by then, so explain the
// only way out instead of showing a frozen 0-day period.
if (ruleType === 'custom' && normalizeCustomThresholds(customRules).length === 0) {
  return {
    hasLeave: false,
    message: '自訂規則沒有任何有效的年資門檻，無法計算特休。請至設定頁使用「離職重來」重新設定。',
    periods: [],
  };
}
```

`MainPage` 本來就有顯示 `!summary.hasLeave` 訊息的分支，不需要修改。

### 單元測試

在 `describe('calculateSummary')` 新增：

- `reports hasLeave: false with a reset hint when custom rules have no valid thresholds`
  - `customRules: []`，斷言 `hasLeave` 為 false、`periods` 為空、`message` 包含「離職重來」。
- `treats custom rules whose thresholds are all invalid the same as an empty rule set`
  - 門檻全為 `0`、`NaN` 等無效值，斷言結果同上。

### e2e：`e2e/resignation.spec.js`

這個檔案已有 `NO_LEAVE_YET` 類的首頁訊息情境，所以放在這裡。新增：

- `自訂規則為空的舊資料：首頁提示改用離職重來`
  - seed `{ onboardDate: '2023-06-15', ruleType: 'custom', customRules: [], allowCarryover: false }`。
  - 斷言首頁出現「離職重來」提示文字，且 `period-tabs` 不存在。

---

## 4. Commit 3 — Settings 輸入驗證與刪除下限（`Fixes #20`, `Fixes #21`）

### 網頁程式碼：`src/components/Settings.jsx`

**`handleSave()` 的自訂規則驗證：**

1. **先擋空清單：** 迴圈前若 `normalizedRules.length === 0`，執行 `alert('請至少保留一條自訂規則')` 後 return。UI 已經擋住刪到零的情況，這裡是第二層防線，要加註解說明。
2. **再擋重複門檻：** 在既有迴圈中，「月數為正整數」檢查之後、「天數 > 0」檢查之前，用 `Set` 檢查是否重複。訊息為 `` `年資門檻「${r.months} 個月」重複，請合併或刪除其中一列` ``。

**刪除按鈕：**
- 改為 `disabled={isLocked || customRules.length <= 1}`；
- 至少只剩一列時，加上 `title="至少需保留一條規則"`（e2e 不要依賴這個 title）。

**表格列：** 自訂規則的 `<tr>` 加上 `data-testid="custom-rule-row"`。

**警告清單的 `key`：** 這個 commit **不動**，commit 8 會整段改寫。

### e2e：`e2e/onboarding-and-settings.spec.js`，`describe('特休規則設定')` 內

**既有測試 `刪除自訂規則後列表更新`：** 列數計算改用 `getByTestId('custom-rule-row')`，因為 commit 7 之後表格會多一個成長列。

**新增：**

- `自訂門檻重複時無法儲存並顯示明確錯誤`
  - 把 24 個月那一列的月數改成 `12`，填到職日，按儲存。
  - 斷言 alert 訊息為 `年資門檻「12 個月」重複，請合併或刪除其中一列`，且仍停留在設定頁。
- `自訂規則只剩一列時刪除按鈕為 disabled`
  - 連續刪除到只剩一列 `custom-rule-row`，斷言該列的「刪除此規則」按鈕為 disabled。

### e2e：`e2e/resignation.spec.js`

**調整 fixture：** `LOCKED_SETTINGS.customRules` 改成兩列，例如 `[{ id: 'c1', months: 12, days: 10 }, { id: 'c2', months: 24, days: 12 }]`。註解補一句：只剩一列時，刪除鈕無論鎖定與否都是 disabled，測試就分不出原因，所以至少要兩列。

**調整 `儲存後欄位變唯讀，「離職重來」變 enabled`：** 刪除按鈕現在有兩個，`getByRole` 會觸發 strict mode 錯誤。改成逐一斷言所有「刪除此規則」按鈕都是 disabled，例如先取 `count()` 再用迴圈。

---

## 5. Commit 4 — 切換期別分頁時重置月曆與表單（`Fixes #22`, `Fixes #28`）

### 網頁程式碼：`src/components/MainPage.jsx`

**`handleSelectPeriod()` 開頭加上早退（D5）：**

```js
// Re-selecting the current tab must be a no-op. Clearing editingRecord
// here without remounting LeaveForm would leave the old values in an
// "add" form, and submitting it would duplicate the record.
if (milestoneMonths === activePeriod.milestoneMonths) return
```

**`LeaveCalendar` 與 `LeaveForm` 都加上 `key={activePeriod.milestoneMonths}`（D4）**，並在第一個 key 旁加註解：

```jsx
{/* Remount on period change: react-calendar only reads
    defaultActiveStartDate on mount (#22), and LeaveForm keeps its
    half-typed input in local state (#28). milestoneMonths is unique
    per period (see normalizeCustomThresholds). */}
```

`LeaveCalendar.jsx`、`LeaveForm.jsx` 本身**不改**。

### e2e：`e2e/period-tabs.spec.js`，`describe('期別分頁')` 內新增

以下皆使用 `SETTINGS_WITH_CARRYOVER` 與預設凍結日 2025-06-15。

- `切換到較舊分頁後，月曆顯示該期間內的月份`
  - 點 `2024–25`，斷言 `zhDayLabel({ year: 2024, month: 6, day: 20 })` 的日期格可見且 enabled。
  - 再點回 `2025–26`，斷言 `2025-06-20` 的日期格可見。
  - 註解寫明：修正前，月曆會停在 2025-06，舊期間的日期格根本不存在。
- `切換分頁後，表單中尚未送出的輸入被清空`
  - 在最新分頁填日期 `2025-07-01`、天數 `3`，然後點 `2024–25`。
  - 斷言日期欄為空字串、天數欄為 `1`。
- `編輯中切換分頁後，表單回到新增模式且欄位清空`
  - seed 一筆記錄 `{ id: 'r1', startDate: '2025-07-01', days: 2 }`，按「編輯」後點 `2024–25`。
  - 斷言標題為「新增請假記錄」、日期欄為空。
- `點擊目前已選取的分頁不會中斷編輯`
  - 同上 seed，按「編輯」後點 `2025–26`。
  - 斷言「儲存變更」按鈕仍可見，且日期欄仍為 `2025-07-01`。
  - 註解寫明：修正前，這個操作會讓表單退回新增模式但保留舊值。

---

## 6. Commit 5 — 揭露國定假日限制（`Fixes #33`）

### 網頁程式碼

**`src/components/MainPage.jsx`：** 在月曆卡片副標「點擊日期快速新增請假記錄」下方新增一行：

```jsx
<p data-testid="calendar-holiday-note" className="text-xs text-stone-400">
  圓點只跳過週六日，未考慮國定假日與補班日
</p>
```

**`src/utils/leaveCalculations.js`：** 在 `getLeaveRecordDates` 的 JSDoc 補一句：不處理國定假日與補班日（沒有假日資料來源），這個限制已在月曆副標向使用者揭露（#33）。

### e2e：`e2e/calendar-and-records.spec.js`，`describe('月曆互動與請假記錄 CRUD')` 內新增

- `月曆說明揭露圓點未考慮國定假日與補班日`
  - 斷言 `calendar-holiday-note` 可見，且包含「國定假日」。
  - 只比對關鍵詞，避免文案微調就讓測試失敗。

---

## 7. Commit 6 — 成長規則的計算核心、儲存與 CSV（`Refs #35`）

### 網頁程式碼：`src/utils/leaveCalculations.js`

**新增並 export 常數：**

```js
/** customGrowth value meaning "no growth after the last custom threshold". */
export const NO_CUSTOM_GROWTH = Object.freeze({ perYear: 0, cap: 0 });
```

**改寫 `getDaysForMilestone(milestoneMonths, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH)`：**

- 勞基法分支不變。
- **基本天數：** 只看有效門檻（與 `normalizeCustomThresholds` 同一套規則：`Number(months)` 為正整數），取 ≤ milestone 的最高門檻。有重複時沿用既有行為，也就是穩定排序後的最後一筆。
- **成長：** 令 L 為最高有效門檻、D 為 L 的天數，並將 `perYear`、`cap` 轉成數字（不是有限數就視為 0）。當 `milestoneMonths > L` 且 `perYear > 0` 時：
  ```js
  const k = Math.floor((milestoneMonths - L) / 12);
  return Math.min(D + perYear * k, Math.max(cap, D));
  ```
- **JSDoc** 要說明兩點：公式對應勞基法「每年加 1 天，上限 30 天」；`cap` 低於 D 時視同不增加（UI 已擋，這裡只是防禦）。

**逐層傳遞 `customGrowth`（D12），一律作為尾端可省略參數：**

- `getPeriodInfo(onboardDate, milestoneMonths, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH)`：傳給 `getDaysForMilestone`。
- `getPeriodContainingDate(…, customGrowth = NO_CUSTOM_GROWTH)`：傳給 `getPeriodInfo`。
- `computePeriodLedger(onboardDate, ruleType, customRules, records, asOfDate, allowCarryover, customGrowth = NO_CUSTOM_GROWTH)`：傳給 `getPeriodInfo`。
- `validateRecordsChain` 與 `calculateSummary`：從 `settings` 解構出 `customGrowth`，傳給 `computePeriodLedger` 與 `getDaysForMilestone`（算下一期額度的那一處）。
- `getMilestones` **不需要**這個參數，因為成長不影響切點。

### 網頁程式碼：`src/utils/storage.js`

在 `DEFAULT_SETTINGS` 新增欄位並加註解：

```js
/**
 * Only used when ruleType === 'custom'. After the last custom threshold,
 * add `perYear` days per completed year, capped at `cap`.
 * perYear 0 = no growth (cap ignored). This default also back-fills
 * settings saved before the field existed, keeping their numbers unchanged.
 */
customGrowth: { perYear: 0, cap: 0 },
```

這裡直接寫字面值，不要從 `leaveCalculations.js` import，以免 storage 依賴計算模組。

### 網頁程式碼：`src/utils/exportCsv.js`

當 `ruleType === 'custom'` 時，在規則列之後輸出成長設定：

- 一律輸出 `之後每年加,${perYear}`；
- `perYear > 0` 時，再輸出 `天數上限,${cap}`。

讀取時用 `settings.customGrowth ?? { perYear: 0, cap: 0 }` 做防禦。

### 單元測試

**`leaveCalculations.test.js`，`describe('getDaysForMilestone')` 內新增：**
- `adds perYear days for each full year past the last custom threshold`
  - 預設規則加上 `{ perYear: 1, cap: 30 }`，斷言 132 個月為 17、144 個月為 18。
- `stops growing once the cap is reached`
  - 同上，斷言 288 與 300 個月皆為 30。
- `keeps the last threshold's days when perYear is 0`
  - 斷言 132 個月為 16。
- `never drops below the last threshold's days when cap is lower than them`
  - `cap: 10`，斷言 132 個月為 16。
- `ignores customGrowth for the labor rule type`

**`describe('calculateSummary')` 內新增：**
- `applies customGrowth from settings to periods past the last custom threshold`
  - 到職日 2014-06-15、today 2025-06-15（年資 132 個月），設定成長 1 天、上限 30。
  - 斷言最新一期 `entitledDays` 為 17。

**`describe('validateRecordsChain')` 內新增：**
- `uses the grown entitlement of the next period as the carryover overspend allowance`
  - 自行設計一個數字，讓「有成長時合法、沒成長時不合法」，並在註解列出算式。

**`storage.test.js`：**
- 既有的 `persists and reloads settings correctly`：fixture 加上 `customGrowth: { perYear: 1, cap: 30 }`。
  - 原因：沒有這個欄位時，讀回的物件會多出預設欄位，`toEqual` 會失敗。
- 新增 `back-fills the no-growth default for settings saved before customGrowth existed`。

**`exportCsv.test.js`：**
- 既有的 `lists each custom rule as months,days when ruleType is custom`：fixture 加上 `customGrowth`，期望輸出補上成長設定那幾行。
- 新增 `omits the cap line when perYear is 0`。
- 新增 `treats a missing customGrowth as no growth`。

---

## 8. Commit 7 — 成長列 UI 與驗證（`Refs #35`）

### 網頁程式碼：`src/components/Settings.jsx`

**預設值：** 在 `DEFAULT_CUSTOM_RULES` 旁新增：

```js
// Mirrors labor law's "每年加 1 天，上限 30 天" so the default custom rule set
// stays compliant past 120 months.
const DEFAULT_CUSTOM_GROWTH = { perYear: 1, cap: 30 }
```

**State：**
- 新增 `growthPerYear` 與 `growthCap` 兩個**字串** state。
- 初始值規則與 `customRules` 相同：`settings.customRules?.length > 0` 時取 `settings.customGrowth`，否則取 `DEFAULT_CUSTOM_GROWTH`，再轉成字串。

**成長列的呈現：** 放在自訂規則表 `tbody` 最後、所有 `custom-rule-row` 之後，標記為 `<tr data-testid="custom-growth-row">`。

- **左欄（唯讀文字）：**
  - 取有效門檻的最大值 L，顯示「滿 {L+12} 個月起」；
  - 沒有有效門檻時顯示「—」。
- **右欄：** 顯示「每年加 [input] 天，上限 [input] 天」。
  - 兩個 input 都是 `type="number"`、`step={0.25}`、`min={0}`，分別加上 `aria-label="每年增加天數"` 與 `aria-label="天數上限"`。
  - 兩者都在 `isLocked` 時停用。
  - 上限欄另外在「每年增加天數不是空字串，且 `Number()` 為 0」時停用（D9）。
- **第三欄：** 空白，沒有刪除按鈕，也不計入刪除下限。

**`handleSave()`：** 在自訂規則驗證之後，驗證成長列（D10）：

| 條件 | 錯誤訊息 |
|---|---|
| 每年增加天數為空、不是有限數、< 0，或不是 0.25 的倍數 | `每年增加天數請填寫 0 或 0.25 的倍數` |
| `perYear > 0`，且上限為空、不是有限數，或低於最後一列天數 D | `` `天數上限不可低於最後一列的天數（${D} 天）` `` |

**儲存內容：**
- 自訂規則時存 `customGrowth: { perYear, cap: perYear > 0 ? cap : 0 }`；
- 勞基法時存 `DEFAULT_SETTINGS.customGrowth`。

**合規警告：** 計算警告的 `useEffect` 暫時不動，commit 8 才會接上成長參數。

### e2e：`e2e/onboarding-and-settings.spec.js`，`describe('特休規則設定')` 內新增

- `自訂規則表格最下方顯示成長列，門檻自動為最後一列加 12 個月`
  - 預設狀態下，斷言 `custom-growth-row` 包含「滿 132 個月起」，兩個輸入框分別為 `1` 與 `30`。
  - 把 120 那列改為 `96` 後，斷言變成「滿 108 個月起」。
- `新增規則後成長列門檻跟著更新`
  - 按「新增規則」後，斷言變成「滿 144 個月起」。
- `每年增加天數為 0 時上限欄位停用`
- `每年增加天數留空時無法儲存`
  - 斷言 alert 訊息。
- `上限低於最後一列天數時無法儲存`
  - 上限填 `10`，斷言 alert 訊息為 `天數上限不可低於最後一列的天數（16 天）`。
- `成長列設定儲存後在首頁生效`
  - 到職日填 `2014-06-15`（年資 132 個月），儲存。
  - 斷言 `summary-entitled` 為 17，並在註解寫出算式 16 + 1×1。

### e2e：`e2e/resignation.spec.js`

- `LOCKED_SETTINGS` 加上 `customGrowth: { perYear: 1, cap: 30 }`。
- `儲存後欄位變唯讀…` 補上斷言：兩個成長列輸入框都是 disabled。
- 既有測試用 `table tbody tr input[type="number"]` 的 `first()` 與 `nth(1)` 選取元素。成長列在表格最後，所以不受影響，但請確認一次。

---

## 9. Commit 8 — 合規檢查改用聯集切點比對（`Fixes #35`）

### 網頁程式碼：`src/utils/leaveCalculations.js`

**新增常數並加註解：**

```js
/** getLaborLawDays() first reaches its 30-day cap at 288 months (24 years). */
const LABOR_LAW_CAP_MONTHS = 288;
```

**改寫 `checkLaborLawCompliance(customRules, customGrowth = NO_CUSTOM_GROWTH)`（D11）：**

1. `thresholds = normalizeCustomThresholds(customRules)`。若為空就回傳 `[]`，因為使用者編輯到一半時不應該跳出滿版警告。
2. 令 L 為最後一個門檻、D 為 `getDaysForMilestone(L, 'custom', customRules)`，並計算自訂天數何時不再變動：
   ```js
   let stableAt = L;
   if (perYear > 0 && cap > D) stableAt = L + 12 * Math.ceil((cap - D) / perYear);
   const horizon = Math.max(LABOR_LAW_CAP_MONTHS, stableAt) + 12;
   ```
3. 檢查點取 `getMilestones('labor', [], horizon)` 與 `getMilestones('custom', customRules, horizon)` 的聯集，去重、排序，並過濾掉大於 `horizon` 的值。
4. 逐點計算 `custom = getDaysForMilestone(m, 'custom', customRules, customGrowth)` 與 `legal = getLaborLawDays(m)`：
   - `custom < legal` 時算不足。連續的不足點合併成一段；遇到第一個不再不足的檢查點就結束該段，並以該點作為 `untilMonths`（不含）。
   - 迴圈結束時如果仍在不足段內，令 `untilMonths = null`，代表之後永遠不足（到 `horizon` 時兩邊天數都已不再變動）。
5. 回傳值：

```js
/** @returns {Array<{ fromMonths, untilMonths: number|null,
 *   minCustomDays, maxCustomDays, minLegalDays, maxLegalDays }>} */
```

**更新 JSDoc**，說明兩點：
- 為什麼檢查聯集就足夠：兩邊的天數都只在各自的切點上改變；
- 為什麼檢查到 `horizon` 就足夠。

### 網頁程式碼：`src/components/Settings.jsx`

**計算警告的 `useEffect`：** 把 `{ perYear: Number(growthPerYear), cap: Number(growthCap) }` 傳進去（不是有限數就視為 0），並把兩個 state 加進依賴陣列。

**警告清單：**
- 標題改為 `⚠ 以下年資區間的天數低於勞基法最低標準`；
- `key={w.fromMonths}`（去重後保證唯一）；
- 每一項的文字：

```
區間：untilMonths 為 null → 「滿 {from} 個月起」
      否則               → 「滿 {from} 個月至未滿 {until} 個月」
數值：min === max ? `${min}` : `${min}～${max}`
整句：「{區間}：您的規則 {custom} 天，勞基法最低 {legal} 天」
```

「仍可儲存，但請確認是否符合規定。」這行保留不變。

### 單元測試：`describe('checkLaborLawCompliance')` 整段改寫

既有三條測試的前提（只比對使用者設定的門檻）已不成立，要替換掉。以下的「預設規則」指 commit 1 宣告的那組常數。

- `reports no deficit for the default custom rules with yearly growth of 1 capped at 30`
- `flags the default custom rules without growth from 132 months onward, open-ended`
  - 期望回傳 `[{ fromMonths: 132, untilMonths: null, minCustomDays: 16, maxCustomDays: 16, minLegalDays: 17, maxLegalDays: 30 }]`。
- `flags the missing 6-month entitlement when the first threshold is later than 6 months`
  - 規則為 `[12:7, 24:10, 36:14, 60:15, 120:16]`，成長 1 天、上限 30。
  - 期望回傳 `[{ fromMonths: 6, untilMonths: 12, 自訂 0, 勞基法 3 }]`。
- `flags a labor-law milestone that falls between two custom thresholds`
  - 規則為 `[6:3, 18:10, 36:14, 60:15, 120:16]`，成長 1 天、上限 30。
  - 期望回傳 `[{ fromMonths: 12, untilMonths: 18, 自訂 3, 勞基法 7 }]`。
- `merges consecutive deficient checkpoints into one run with min/max ranges`
  - 預設規則加上 `{ perYear: 0.5, cap: 30 }`。
  - 期望回傳一段：`fromMonths: 132`、`untilMonths: 456`，自訂 16.5～29.5 天，勞基法 17～30 天。
  - 註解寫明：456 = 120 + 12×28，是成長觸頂的月數；`horizon` 為 468。
- `closes a run at the first checkpoint where the rule catches up with the law`
  - 預設規則，把 12 個月改成 5 天。
  - 期望回傳 `[{ fromMonths: 12, untilMonths: 24, 自訂 5, 勞基法 7 }]`。
- `returns an empty array when there are no valid thresholds`

**`describe('getLaborLawDays')` 內新增：**
- `first reaches the 30-day cap at 288 months`
  - 斷言 276 個月為 29、288 個月為 30。這條用來鎖住 `LABOR_LAW_CAP_MONTHS`。

### e2e：`e2e/onboarding-and-settings.spec.js`，`describe('特休規則設定')` 內

**改寫既有 `自訂天數低於勞基法最低標準時顯示警告`：**
- 預設狀態下，先斷言警告區塊不存在。
- 把 12 個月那列改成 5 天後，斷言出現 `滿 12 個月至未滿 24 個月：您的規則 5 天，勞基法最低 7 天`。

**新增：**
- `每年增加天數改為 0 時，顯示滿 132 個月起的開放區間警告`
  - 斷言出現 `滿 132 個月起：您的規則 16 天，勞基法最低 17～30 天`。
- `第一個門檻晚於 6 個月時，警告滿 6 個月的缺口`
  - 刪除 6 個月那列，斷言出現 `滿 6 個月至未滿 12 個月：您的規則 0 天，勞基法最低 3 天`。

---

## 10. 本輪不做的事

以下即使順手也不要改：

- **報告的重構建議 R1–R12**，包括：`buildPeriods` 重寫、持久化改用 `useEffect`、MainPage 的兩個 effect、`formatDays` 抽出、拆檔、Settings 拆元件、移除 `uuid`、清除死碼、`storage` 資料淨化、JSDoc typedef、ESLint、訊息常數集中。
- **把 `alert()` 改成行內錯誤訊息。**
- **P1-2**（跨期間請假）、**P1-3**（修正設定流程）、**P1-4**（JSON 備份、ErrorBoundary）。
- **P2-1**（`today` 凍結）、**P2-2**（遞延 0 天的卡片）、**P2-4**（迴圈上限）、**P2-5**（天數上限）、**P2-6**（結清明細）、**P2-7**（圓點無障礙文字）。
- **修改 `LeaveCalendar.jsx` 與 `LeaveForm.jsx` 的內部邏輯**（本輪只在 MainPage 加 `key`）。
- **修改 `DEFAULT_CUSTOM_RULES` 的門檻或天數。**

---

## 11. 驗收清單

- [ ] 八個 commit 依序完成，每個 commit 單獨都能通過全部單元測試與 e2e。
- [ ] 選「公司另有規定」且不改預設值時，任何年資下的期間都不超過 12 個月，而且完全沒有合規警告。
- [ ] 重複門檻、空規則、成長列不合法的值都無法儲存，並跳出明確訊息。
- [ ] 自訂規則最後一列的刪除按鈕為 disabled；成長列沒有刪除按鈕。
- [ ] 切換期別分頁後，月曆落在該期間的月份，表單清空；點擊目前分頁不影響編輯。
- [ ] 月曆副標顯示國定假日限制的說明。
- [ ] 既有的 localStorage 資料（沒有 `customGrowth`）載入後，天數與修正前相同（除了 #19 修正所造成的期間切分改變）。
- [ ] 本輪沒有修改第 10 節列出的任何項目。
