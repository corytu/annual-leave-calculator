# annual-leave-calculator 全面審視報告

審視者：Claude Opus 5, with effort High
審視日期：2026-09-11
審視版本：commit `882e0e7`
審視範圍：`src/`（App、components、utils）、`e2e/`、`src/**/*.test.js`、`index.html`、`package.json`、`vite.config.js`、`README.md`

---

## 一、評估方法

這份審視沒有實際執行程式，而是以「靜態閱讀 + 資料流追蹤 + 情境矩陣」三層方式進行：

**1. 資料流追蹤（由外而內）**

從三個入口各走一次完整資料流，確認每一段轉換的型別與前後置條件：

- `localStorage → loadSettings/loadRecords → App state → calculateSummary → MainPage 畫面`
- `使用者輸入 → LeaveForm.validate → validateRecordsChain → onAdd → saveRecords`
- `Settings 表單 → handleSave 驗證 → onSave → getMilestones → getPeriodInfo`

**2. 情境矩陣（邊界列舉）**

針對每個關鍵維度列出極端值，逐一代入計算核心，看是否有未定義行為：

| 維度 | 列舉值 |
|---|---|
| 到職日 | 未來日、今天、月底日（1/31、2/29）、極早（1990） |
| 年資 | 0、正好 6 個月、正好 12 個月、48 個月、120+、240+ |
| 規則類型 | 勞基法、自訂（正常）、自訂（門檻重複）、自訂（全刪光）、自訂（門檻間隔 > 12 個月） |
| 遞延 | 開 / 關 × 預支 / 未預支 / 剛好用完 |
| 請假記錄 | 0.25 天、跨週末、跨期間結束日、數量極大、儲存資料被竄改 |
| 操作 | 切換期別分頁、切分頁後編輯、離職重來後再入職、跨午夜長開分頁 |

**3. 既有測試覆蓋對照**

把上表每格對照 `leaveCalculations.test.js`、`storage.test.js`、`exportCsv.test.js` 與四份 e2e spec，把「已有測試守住的」跟「沒有任何測試提及的」分開。你的測試品質其實相當高（尤其 e2e 的註解把每個數字的來源都算給讀者看），所以**本報告的發現絕大多數集中在測試矩陣沒覆蓋到的那幾格**，而不是既有邏輯寫錯。

**標註慣例**

- **P0**：會產生錯誤數字或讓畫面壞掉，且一般使用者走得到。
- **P1**：不會算錯，但會讓使用者卡住、看到不合理畫面，或有資料遺失風險。
- **P2**：體驗瑕疵、防禦性不足、或需要產品決策的模糊地帶。
- 標「**需實機驗證**」者，是我依函式庫行為推斷但沒實際跑過的。

---

## 二、邏輯漏洞與邊界情境

### P0-1　自訂規則會切出「跨越數年的單一期間」，而且預設值就中招 \([issue #19](https://github.com/corytu/annual-leave-calculator/issues/19)\)

**這是本次審視最嚴重的發現。**

`getMilestones()` 在 `ruleType === 'custom'` 時，直接把使用者輸入的門檻當成期間切點：

```js
const base = [...customRules].map(r => r.months).sort((a, b) => a - b);
```

而 `DEFAULT_CUSTOM_RULES` 的門檻是 `[6, 12, 24, 36, 60, 120]`——刻意對齊勞基法級距。於是 `getPeriodInfo(onboard, 36, 'custom', rules)` 算出的下一個里程碑是 **60**，期間變成：

- 36 → 60 個月：**一個長達 2 年的期間，總共只有 14 天**
- 60 → 120 個月：**一個長達 5 年的期間，總共只有 15 天**

對照之下，勞基法路徑的 `buildLaborLawMilestones()` 明確補上了 `48, 72, 84, 96, 108`，正是為了讓每個期間都剛好 12 個月。自訂路徑少了這一段補齊邏輯。

**影響**：使用者選「公司另有規定」、不改任何預設值直接儲存，到職滿 3 年後就會看到「當期天數 14」搭配一個橫跨兩年的區間；月曆允許他在這兩年內把 14 天用完，第 4 年不會重新配額。這不只是顯示錯誤，是**特休天數實際少給了一整年**。

**重現**

```
到職日 2020-01-01，規則「公司另有規定」（不改預設），今天 2024-01-01
→ 期間分頁最新一期為 2023-01-01 ~ 2024-12-31，當期天數 14
```

**根因**：期間邊界與「配額級距」被綁成同一個概念。勞基法路徑靠硬編碼的 milestone 陣列把兩者拆開，自訂路徑沒有。

**修法**：在 `getMilestones()` 裡把使用者門檻正規化成「每段不超過 12 個月」的網格。配額解析（`getDaysForMilestone`）本來就是「取 ≤ milestone 的最高門檻」，補進去的中間點會自動沿用下層級距的天數，不需要改。

```js
// src/utils/leaveCalculations.js
const MONTHS_PER_YEAR = 12;

/** 把使用者輸入的門檻清成：數字、正整數、去重、遞增。 */
function normalizeCustomThresholds(customRules) {
  return [...new Set(
    (customRules ?? [])
      .map(r => Number(r.months))
      .filter(m => Number.isInteger(m) && m >= 1)
  )].sort((a, b) => a - b);
}

export function getMilestones(ruleType, customRules, upToMonths = 360) {
  if (ruleType !== 'custom') return buildLaborLawMilestones(upToMonths);

  const thresholds = normalizeCustomThresholds(customRules);
  if (thresholds.length === 0) return [6]; // 保留既有 fallback

  const milestones = [];
  for (let i = 0; i < thresholds.length; i++) {
    const current = thresholds[i];
    const next = thresholds[i + 1];
    milestones.push(current);
    if (next === undefined) break;

    // 由 next 往回每 12 個月補一個切點，確保沒有任何一段超過 12 個月。
    // 往回（而非往前）補，是為了讓每個切點都對齊上一層門檻的週年日。
    const gapFill = [];
    for (let m = next - MONTHS_PER_YEAR; m > current; m -= MONTHS_PER_YEAR) {
      gapFill.push(m);
    }
    milestones.push(...gapFill.reverse());
  }

  // 最後一個門檻之後，沿用既有的逐年延伸邏輯
  let m = milestones[milestones.length - 1] + MONTHS_PER_YEAR;
  while (m <= upToMonths + MONTHS_PER_YEAR) {
    milestones.push(m);
    m += MONTHS_PER_YEAR;
  }
  return milestones;
}
```

**驗證**：`[6,12,24,36,60,120]` → `[6,12,24,36,48,60,72,84,96,108,120,132,…]`，與勞基法路徑的切點完全一致；`getDaysForMilestone(48,…)` = 14（沿用 36 門檻）、`(72)` = 15（沿用 60 門檻），符合預期。

---

### P0-2　自訂門檻重複時，會算出 `periodEnd < periodStart` \([issue #20](https://github.com/corytu/annual-leave-calculator/issues/20)\)

`handleSave()` 只檢查「正整數」與「天數 > 0」，**沒有檢查門檻重複**。使用者按兩次「新增規則」再把兩列都改成 12，就能存檔。

之後 `getPeriodInfo(onboard, 12, …)`：

```js
const idx = allMilestones.indexOf(12);      // → 0（只找到第一個）
nextMilestoneMonths = allMilestones[1];      // → 12（重複的那個）
// periodStart === nextStart
// periodEnd = periodStart - 1 day  ← 比 periodStart 還早
```

連鎖後果：

1. `LeaveCalendar` 收到 `minDate > maxDate`，react-calendar 行為未定義（**需實機驗證**，最可能是整個月曆不可用或拋錯）。
2. `computePeriodLedger` 的 `chainMilestones` 出現兩筆相同 milestone → MainPage 的 `<TabButton key={p.milestoneMonths}>` 與警告清單的 `<li key={w.months}>` 都會 **React duplicate key**，兩個分頁標籤一模一樣且點哪個都選到同一個。
3. `periods.find(p => p.milestoneMonths === selectedMilestone)` 永遠只拿到第一筆，第二個期間的資料完全無法觸及。

**修法（兩層）**

第一層，P0-1 的 `normalizeCustomThresholds()` 已用 `Set` 去重，計算核心不會再壞。

第二層，在 `Settings.handleSave()` 補上輸入面驗證，讓使用者知道發生什麼事：

```js
if (ruleType === 'custom') {
  if (normalizedRules.length === 0) {
    setFormError('請至少保留一條自訂規則');   // 見 P0-3
    return;
  }
  const sorted = [...normalizedRules].sort((a, b) => a.months - b.months);
  const seen = new Set();
  for (const r of sorted) {
    if (!Number.isInteger(r.months) || r.months < 1) {
      setFormError('年資門檻請填寫正整數（月數）'); return;
    }
    if (seen.has(r.months)) {
      setFormError(`年資門檻「${r.months} 個月」重複，請合併或刪除其中一列`); return;
    }
    seen.add(r.months);
    if (!Number.isFinite(r.days) || r.days <= 0) {
      setFormError('特休天數請填寫大於 0 的數字'); return;
    }
    if (r.days % 0.25 !== 0) {
      setFormError('特休天數最小單位為 0.25 天'); return;
    }
    if (r.days > 365) {
      setFormError('特休天數不可超過 365 天'); return;
    }
  }
}
```

同時把警告清單的 key 改成 `key={`${w.months}-${w.customDays}`}` 做防禦。

---

### P0-3　自訂規則可以被刪到一條不剩，結果是「永遠 0 天的單一停滯期間」 \([issue #21](https://github.com/corytu/annual-leave-calculator/issues/21)\)

`removeCustomRule` 沒有下限保護，`handleSave` 的 `for` 迴圈跑空陣列直接通過，於是 `{ ruleType: 'custom', customRules: [] }` 可以被存進 localStorage。之後：

- `getMilestones('custom', [], n)` → 恆為 `[6]`（fallback）
- `getDaysForMilestone(6, 'custom', [])` → **0**
- `getPeriodInfo(…, 6, …)` → `allMilestones = [6]`，`idx + 1` 越界 → `next = 18`，期間固定為「到職 +6 個月 ~ 到職 +18 個月」
- `computePeriodLedger` 的 `chainMilestones` **永遠只有 `[6]`**，所以到職滿 18 個月之後，期間再也不會往前推進

使用者會看到：當期天數 0、期間停在兩年前、月曆完全鎖死、而且新增任何記錄都會被 `validateRecordsChain`（`0 - taken < 0`）擋下，錯誤訊息卻是「這筆請假超支可用額度上限」——完全看不出真正原因。

**修法**：除了上面的 `normalizedRules.length === 0` 驗證，UI 層也要擋：

```js
// Settings.jsx
<button
  onClick={() => removeCustomRule(rule.id)}
  disabled={isLocked || customRules.length <= 1}
  title={customRules.length <= 1 ? '至少需保留一條規則' : undefined}
  …
>
```

---

### P1-1　切換期別分頁後，月曆停留在舊期間的月份 \([issue #22](https://github.com/corytu/annual-leave-calculator/issues/22)\)

`LeaveCalendar` 用的是 `defaultActiveStartDate`——react-calendar 只在**初次掛載**時讀取它，之後 `activeStartDate` 存在元件內部 state。切換分頁時 `periodStart` / `periodEnd`（也就是 `minDate` / `maxDate`）換了，但內部的 `activeStartDate` 不會跟著重算。

情境：預設在「2025–26」分頁（月曆顯示 2025-06），點到「2024」分頁（區間 2024-03-01 ~ 2024-08-31）。月曆仍然顯示 2025-06，而該月每一格都超出新的 min/max → 全部 disabled，使用者看到一整片灰掉的月曆，還得自己按好幾次上一頁才找得到正確月份。

現有 e2e 在切分頁後只斷言摘要卡片數字，沒有斷言月曆月份，所以這格沒被守住。

**修法 A（最小改動，建議先做）**：在 MainPage 讓期間變化時重建元件。

```jsx
<LeaveCalendar
  key={activePeriod.milestoneMonths}
  periodStart={activePeriod.periodStart}
  …
/>
```

**修法 B（受控，較穩健）**：把 `activeStartDate` 收成受控 props。

```jsx
function initialMonth(periodStart, periodEnd) {
  const now = new Date();
  const anchor = now >= periodStart && now <= periodEnd ? now : periodStart;
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

const [activeStartDate, setActiveStartDate] = useState(() => initialMonth(periodStart, periodEnd));
useEffect(() => {
  setActiveStartDate(initialMonth(periodStart, periodEnd));
}, [periodStart.getTime(), periodEnd.getTime()]);

<Calendar
  activeStartDate={activeStartDate}
  onActiveStartDateChange={({ activeStartDate: next }) => next && setActiveStartDate(next)}
  …
/>
```

---

### P1-2　跨越期間結束日的請假記錄，天數全算在前一期、後半段圓點消失 \([issue #23](https://github.com/corytu/annual-leave-calculator/issues/23)\)

`LeaveForm.validate()` 只檢查 `startDate` 落在 `[periodStart, periodEnd]`，沒有檢查「起始日 + 天數」會不會溢出期間。

情境：期間結束日是 2025-06-14（週六），使用者在 2025-06-11（週三）請 5 天。`getLeaveRecordDates` 展開為 6/11、6/12、6/13、6/16、6/17。

後果有三個，而且彼此不一致：

1. `getLeaveTakenInPeriod` 依 `startDate` 歸屬 → **5 天全記在舊期間**，新期間顯示已休 0 天。
2. `activePeriodRecords` 也依 `startDate` 過濾 → 這筆記錄不會出現在新期間的月曆 records 裡，所以 6/16、6/17 **兩顆圓點憑空消失**。
3. 舊期間月曆的 6/16、6/17 超出 `maxDate` 不會渲染，所以那兩天在任何一個分頁都看不到。

**修法**：最單純且語意最清楚的做法是禁止跨期間，請使用者拆成兩筆。

```js
// LeaveForm.validate()，放在 0.25 檢查之後、鏈式驗證之前
const spannedDates = getLeaveRecordDates(startDate, parsedDays);
const lastSpanned = parseLocalDate(spannedDates[spannedDates.length - 1]);
if (lastSpanned > periodEnd) {
  setError(`這筆假會延伸到 ${toISODateString(lastSpanned)}，已跨過本週年度結束日（${periodEndISO}），請拆成兩筆分別登記`);
  return false;
}
```

（記得把 `getLeaveRecordDates` 加進 LeaveForm 的 import。）

若你希望產品行為是「自動拆帳」而非「擋下」，那就要把 `getLeaveTakenInPeriod` 從「依 startDate 歸屬整筆」改成「展開日期後逐日歸屬」——那是比較大的模型變更，會影響所有既有測試的預期值，我建議先用擋下的版本。

---

### P1-3　設定一經儲存即永久鎖定，到職日打錯只能全部清空重來 \([issue #24](https://github.com/corytu/annual-leave-calculator/issues/24)\)

`isLocked = Boolean(settings.onboardDate)`，一旦鎖上：到職日、規則類型、自訂規則、遞延開關全部 `disabled`，而且「儲存設定」按鈕整個消失（`{!isLocked && …}`）。唯一出口是「離職重來」——它會 `clearAll()` 連同所有請假記錄一起清掉。

也就是說：**到職日按錯一天，就得把所有請假記錄重打一次。** 這對一個要用好幾年的工具來說是很硬的代價。同理，公司後來改了遞延政策，使用者也沒有任何方法只改那一個開關。

**修法**：加一條「修正設定」路徑，允許解鎖，但存檔前對既有記錄做完整性檢查。

```js
// leaveCalculations.js 新增
/** 找出在新設定下不落在任何期間內的「孤兒記錄」。 */
export function findOrphanRecords(settings, records, asOfDate = new Date()) {
  if (!settings.onboardDate) return records;
  const onboard = parseLocalDate(settings.onboardDate);
  const latest = records.reduce(
    (max, r) => { const d = parseLocalDate(r.startDate); return d > max ? d : max; },
    asOfDate
  );
  const ledger = computePeriodLedger(
    onboard, settings.ruleType, settings.customRules, records, latest, settings.allowCarryover
  );
  if (ledger.length === 0) return records;
  const first = ledger[0].periodStart;
  const last  = ledger[ledger.length - 1].periodEnd;
  return records.filter(r => {
    const d = parseLocalDate(r.startDate);
    return d < first || d > last;
  });
}
```

Settings 的流程改為：

1. 鎖定狀態下顯示「修正設定」按鈕 → `setIsUnlocked(true)`（本地 state，不寫進 settings）。
2. 存檔時先跑 `findOrphanRecords(candidateSettings, records)` 與 `validateRecordsChain(candidateSettings, records, new Date())`。
3. 若有孤兒或鏈式驗證失敗，顯示明確的確認對話框：「有 N 筆記錄（列出日期）在新的到職日下不屬於任何年資區間，將無法在畫面上看到。是否仍要儲存？」讓使用者自己決定，而不是靜默吞掉。

這裡要特別注意：目前**孤兒記錄是完全靜默的**——`getLeaveTakenInPeriod` 只加總期間內的記錄，`activePeriodRecords` 也只過濾期間內的，所以落在第一個里程碑之前的記錄既不顯示、也不計入、也刪不掉，但它確實還在 localStorage 裡，而且 CSV 匯出時**會**出現。建議不論有沒有做修正設定功能，都在首頁加一則孤兒記錄提示。

---

### P1-4　資料只存在 localStorage，且 CSV 無法回匯、沒有 ErrorBoundary \([issue #25](https://github.com/corytu/annual-leave-calculator/issues/25)\)

三個問題疊在一起構成單點失效：

1. **唯一儲存位置是 localStorage。** 清瀏覽資料、換裝置、Safari 的 ITP 七天未造訪清除，都會無預警清空數年的記錄。
2. **`exportCsv.js` 的註解明說 “Not intended to be re-imported.”** 使用者手上有備份也救不回來——它是給人看的報表，不是給機器讀的備份。
3. **`main.jsx` 沒有 ErrorBoundary。** 上面 P0-2 那種 `minDate > maxDate`、或是被竄改的 localStorage 讓 `records.reduce` 拋錯，結果都是整頁白畫面，而且**畫面上沒有任何清除資料的入口**，使用者只能自己開 DevTools。

**修法（三件都建議做）**

其一，加一組真正可回匯的 JSON 備份：

```js
// src/utils/backup.js
const SCHEMA_VERSION = 1;

export function buildBackupJson(settings, records) {
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings, records },
    null, 2
  );
}

export function parseBackupJson(text) {
  const data = JSON.parse(text);
  if (data?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不支援的備份版本：${data?.schemaVersion}`);
  }
  if (typeof data.settings !== 'object' || !Array.isArray(data.records)) {
    throw new Error('備份檔格式不正確');
  }
  return { settings: data.settings, records: data.records };
}
```

設定頁加「匯出備份 / 還原備份」兩個按鈕，且**不綁在離職流程裡**——備份應該是隨時可做的日常操作。還原時走與 P1-3 相同的驗證流程。

其二，ErrorBoundary 附逃生門：

```jsx
// src/components/ErrorBoundary.jsx
import { Component } from 'react';
import { clearAll } from '../utils/storage.js';

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-lg mx-auto mt-20 p-6 text-center space-y-4">
        <h1 className="text-lg font-semibold text-stone-800">發生未預期的錯誤</h1>
        <p className="text-sm text-stone-500">
          可能是本機儲存的資料損毀。建議先匯出備份（若仍可操作），再清除資料重新開始。
        </p>
        <pre className="text-xs text-left text-stone-400 overflow-auto">
          {String(this.state.error?.message ?? this.state.error)}
        </pre>
        <button
          onClick={() => { clearAll(); location.reload(); }}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded-md"
        >
          清除本機資料並重新載入
        </button>
      </div>
    );
  }
}
```

其三，`storage.js` 加 schema 版本與淨化，讓損毀資料退回預設而不是往上拋（見重構 R9）。

---

### P2-1　`today` 在掛載時凍結，長時間開著分頁不會跨日更新 \([issue #26](https://github.com/corytu/annual-leave-calculator/issues/26)\)

```js
const today = useMemo(() => new Date(), [])
```

依賴陣列是空的，所以 `today` 是掛載當下那一刻，永遠不變。若使用者開著分頁過夜——尤其**跨過週年日**那一晚——新的期間分頁不會出現，摘要也還是舊期間的。同時 `LeaveForm.validate()` 用的是 `new Date()`（每次都取當下），兩邊會出現不一致的時間基準。

**修法**：抽一個只在「日期字串真的變了」時才更新 state 的 hook，避免每分鐘都重算。

```js
// src/hooks/useToday.js
import { useState, useEffect } from 'react';
import { toISODateString } from '../utils/leaveCalculations.js';

export function useToday(intervalMs = 60_000) {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setToday(prev => {
        const now = new Date();
        return toISODateString(now) === toISODateString(prev) ? prev : now;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return today;
}
```

MainPage 改用 `const today = useToday()`，並把同一個 `today` 往下傳給 `LeaveForm`，讓驗證與顯示共用同一個時間基準。

---

### P2-2　關閉遞延時仍會顯示「遞延至下一期 0 天」 \([issue #27](https://github.com/corytu/annual-leave-calculator/issues/27)\)

```js
const showCarryIn = settings.allowCarryover && !isEarliest
const showSettlementOut = !isNewest   // ← 沒有檢查 allowCarryover
```

`showSettlementOut` 同時控制「已結清未休工資天數」與「遞延至下一期」兩張 MiniStat。關閉遞延時 `carryOut` 恆為 0，但那張卡片還是會渲染，使用者會看到「遞延至下一期 0 天」——在他明明關掉遞延的情況下，這個標籤本身就令人困惑。既有 e2e 只斷言 `summary-carryin` 不存在，沒有斷言 `summary-carryout`。

**修法**：把兩者拆開。

```js
const showSettlement = !isNewest;
const showCarryOut   = settings.allowCarryover && !isNewest;
```

並把 JSX 的 `<>…</>` 拆成兩個各自條件渲染。注意 grid 是 `grid-cols-3`，卡片數量變動時版面要跟著調（建議改成 `flex flex-wrap gap-6 justify-around` 或動態 `grid-cols-*`）。

---

### P2-3　切換期別分頁後，LeaveForm 殘留上一個期間的輸入 \([issue #28](https://github.com/corytu/annual-leave-calculator/issues/28)\)

`handleSelectPeriod` 清掉了 `editingRecord` 與 `selectedDate`，但 LeaveForm 的 `startDate` / `days` 是它自己的 local state，而同步用的 `useEffect` 只在 `editingRecord` 或 `selectedDate` 變成 truthy 時才觸發。所以打到一半的日期會留在表單裡，`min`/`max` 屬性已經換成新期間，值卻是舊的 → 按送出得到「日期必須在本週年度範圍內」。

**修法**：和 P1-1 同一招，讓期間變化時重建元件。

```jsx
<LeaveForm key={activePeriod.milestoneMonths} … />
```

---

### P2-4　`getLeaveRecordDates` 的 `while` 迴圈沒有上限 \([issue #29](https://github.com/corytu/annual-leave-calculator/issues/29)\)

```js
while (remaining > 0) { … }
```

正常路徑安全（表單擋下 `days > 30` ⋯⋯其實沒擋，見 P2-5），但若 localStorage 被竄改成 `days: 1e6`，這個迴圈會在 `LeaveCalendar` 的 render 期間跑一百多萬圈 → 分頁凍結，而且因為是在 render 裡，連 ErrorBoundary 都攔不到。

**修法**：加上防禦性上限。

```js
export function getLeaveRecordDates(startDate, days, maxDates = 400) {
  const start = typeof startDate === 'string' ? parseLocalDate(startDate) : startDate;
  const cursor = new Date(start);
  const dates = [];
  let remaining = Number(days);
  if (!Number.isFinite(remaining)) return dates;
  while (remaining > 0 && dates.length < maxDates) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) { dates.push(toISODateString(cursor)); remaining -= 1; }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
```

---

### P2-5　`max={30}` 只是裝飾，天數上限沒有真正驗證 \([issue #30](https://github.com/corytu/annual-leave-calculator/issues/30)\)

`<input type="number" max={30}>` 在使用者手動輸入或程式填值時不會被強制。`validate()` 檢查了「> 0」與「0.25 倍數」，但沒有上限。目前是靠 `validateRecordsChain` 間接擋住（因為超過額度會失敗），所以一般情況下沒問題——但錯誤訊息會變成「超支可用額度上限」，而不是「一次不能請超過 30 天」，使用者搞不清楚該改哪裡。

**修法**：把 HTML 屬性與 JS 驗證對齊。

```js
const MAX_DAYS_PER_RECORD = 30;
if (parsedDays > MAX_DAYS_PER_RECORD) {
  setError(`單筆請假不可超過 ${MAX_DAYS_PER_RECORD} 天，請拆成多筆`);
  return false;
}
```

自訂規則的天數欄位同理（`min={0}` 與「必須 > 0」的驗證也不一致，建議改成 `min={0.25}`）。

---

### P2-6　「離職結清」只計算最後一期，可能低估應領工資 \([issue #31](https://github.com/corytu/annual-leave-calculator/issues/31)\)

```js
const settlementDays = resignSummary.periods[resignSummary.periods.length - 1].remaining
```

情境：使用者剛跨過週年日兩週，上一期還剩 5 天未休。若遞延關閉，那 5 天在模型裡被記成上一期的 `settlement`（視為「已結清」）；若遞延開啟，它已經併進本期的 `carryIn`，所以會被算到。

**關閉遞延時**，那 5 天完全不會出現在結清數字裡。模型的語意是「已結清 = 雇主當時已折發工資」，這個假設本身合理，但**畫面上沒有任何地方說明這個假設**，使用者看到「應結清工資天數：7 天」時無從判斷那 5 天去哪了。

這比較偏產品決策而非程式錯誤，我的建議是把單一數字改成明細，讓使用者自己對帳：

```jsx
<div className="text-sm text-stone-700 space-y-1">
  <p>本期未休：<strong>{formatDays(currentRemaining)}</strong> 天</p>
  {priorSettlements > 0 && (
    <p className="text-stone-500">
      先前各期已結清（假設雇主當時已折發）：{formatDays(priorSettlements)} 天
    </p>
  )}
  <p className="text-xs text-stone-400">
    依勞基法施行細則第 24-1 條，年度終結或契約終止未休畢之特休應折發工資；
    若先前各期實際未折發，請自行併入請領。
  </p>
</div>
```

CSV 匯出同樣建議補上明細列。

---

### P2-7　月曆圓點對螢幕閱讀器完全不可見 \([issue #32](https://github.com/corytu/annual-leave-calculator/issues/32)\)

```jsx
return <span className="leave-dot" aria-hidden="true" />
```

`aria-hidden` 加上純視覺的圓點，等於「有沒有請假」這個資訊對輔助科技使用者不存在。

**修法**：在同一格內補一段視覺隱藏文字（react-calendar 會把 `tileContent` 的內容放進 tile 的 `<button>` 裡，所以會被一起讀出來）。

```jsx
function tileContent({ date, view }) {
  if (view !== 'month') return null;
  if (!leaveDates.has(toISODateString(date))) return null;
  return (
    <>
      <span className="leave-dot" aria-hidden="true" />
      <span className="sr-only">已登記請假</span>
    </>
  );
}
```

Tailwind 的 `sr-only` 已在 base 樣式中提供，不需額外 CSS。

---

### P2-8　國定假日未納入（已知限制，但建議在 UI 揭露） \([issue #33](https://github.com/corytu/annual-leave-calculator/issues/33)\)

`getLeaveRecordDates` 只跳過週六日。台灣的國定假日與彈性放假（調整放假、補班日）都不處理，所以一筆跨過連假的多天記錄，圓點會標在使用者其實沒上班的日子上。

這是刻意的取捨（沒有假日資料來源），但目前只有程式註解提到，使用者看不到。建議在月曆卡片的副標補一句：「圓點僅跳過週六日，未扣除國定假日與補班調整」。若日後要做，可考慮讓使用者在設定頁自行維護一份「額外休假日」清單，再傳進 `getLeaveRecordDates` 作為 skip 條件——這個介面設計比綁定外部 API 更符合這個專案「無後端」的定位。

---

### 已驗證為正確、不需處理的項目

以下是我特別檢查過、確認沒問題的地方，列出來讓你知道審視有涵蓋到：

- **`addMonthsToDate` 的月底回捲**：溢出量最多 3 天，而溢出只發生在 `originalDay ≥ 29` 時，兩者不可能相等，所以 `d.getDate() !== originalDay` 這個判斷不會誤判。1/31、2/29 皆正確。
- **`getLaborLawDays` 的級距**：`<36→10`、`<60→14`、`<120→15`、`120 個月起 `15 + (年資年數 - 9)` 上限 30`，對照勞基法第 38 條逐格核對，包含 240 個月（滿 20 年）達到 30 天上限的點，全部正確。
- **`% 0.25` 的浮點安全性**：0.25 的倍數在二進位皆可精確表示，`parsedDays % 0.25 !== 0` 不會誤判；`reduce` 累加 0.25 倍數也不會累積誤差。
- **`getCompletedMonths` 在週年日當天**：`onboard` 是午夜、`today` 有時分秒，午夜 ≤ 當下 → 不會 `> to` → 月數不會被多減 1，週年日當天即進入新期間。正確。
- **MainPage 的 hooks 順序**：所有 hook 都在早期 return 之前，沒有條件式 hook 問題。
- **`allowCarryover` 開關有 `disabled={isLocked}`**：不會出現「改了卻無法儲存」的狀況（但這也正是 P1-3 描述的鎖定過嚴問題）。
- **`downloadCsv` 有加 BOM**：Excel 開啟中文不會亂碼。

---

## 三、重構建議

### R1　`App.jsx`：在 state updater 裡做副作用（StrictMode 下會跑兩次）

```js
setRecords(prev => {
  const next = [...prev, newRecord].sort(…)
  saveRecords(next)          // ← 副作用寫在 updater 裡
  return next
})
```

`main.jsx` 用了 `<React.StrictMode>`，React 18 會在開發模式下**重複呼叫 updater 函式**來偵測不純的邏輯。`saveRecords` 剛好是冪等的，所以現在沒出事，但這是被 StrictMode 明確標記為反模式的寫法——一旦哪天在 updater 裡加了不冪等的東西（例如寫入計數、發 analytics）就會出錯。

**改法**：讓持久化跟著 state 走，而不是跟著事件走。

```jsx
const [records, setRecords] = useState(() => loadRecords());
const [settings, setSettings] = useState(() => loadSettings());
// 用一個 flag 避開「離職重來後不該把空值寫回去」的情況
const hydrated = useRef(false);

useEffect(() => {
  if (!hydrated.current) { hydrated.current = true; return; }
  saveRecords(records);
}, [records]);

const handleAddRecord = useCallback((record) => {
  setRecords(prev =>
    [...prev, { id: crypto.randomUUID(), ...record }]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  );
}, []);
```

注意「離職重來」的既有註解明說**故意**不呼叫 `saveRecords`，所以改成 useEffect 持久化時，`handleResign` 要在 `clearAll()` 之後把 `hydrated` 重設，或改用 `clearAll()` 搭配 `location.reload()`。這段要小心處理，建議一併補一個 e2e 斷言「離職重來後 localStorage 兩個 key 都是 null」（你已經有這條測試了，剛好可以當回歸網）。

### R2　`MainPage`：兩個 `useEffect` 可以化為衍生狀態

```js
useEffect(() => { if (selectedMilestone == null && periods.length > 0) …  }, [periods, selectedMilestone])
useEffect(() => { if (!settings.onboardDate) setSelectedMilestone(null) }, [settings.onboardDate])
```

第一個 effect 會造成一次額外 render（首次 render 時 `selectedMilestone` 是 null，effect 跑完再 render 一次），而且它其實沒有實質效果——`activePeriod` 本來就有 `?? periods[periods.length - 1]` 的 fallback。第二個 effect 只是為了清掉第一個 effect 留下的殘值。

兩個都可以刪掉，改成衍生值：

```js
const activePeriod =
  periods.find(p => p.milestoneMonths === selectedMilestone) ?? periods[periods.length - 1];
```

`selectedMilestone` 保持 `null` 代表「跟隨最新一期」，使用者點了分頁才寫入具體值。離職重來後 `periods` 變空陣列，早期 return 會先擋住，`selectedMilestone` 殘留的舊值在下次有期間時會 `find` 不到而自動 fallback 到最新一期——行為與現在相同，但少了兩個 effect 和一次額外 render。

### R3　`formatDays` 應該抽成共用工具

目前 `formatDays` 是 `MainPage.jsx` 檔案底部的私有函式，於是：

- `LeaveForm` 的合計 `{records.reduce((s, r) => s + r.days, 0)} 天` 沒有格式化
- `RecordRow` 的 `{record.days} 天` 沒有格式化
- `Settings` 結清彈窗的 `{settlementDays}` 沒有格式化

同一個數字在不同地方可能顯示成 `7.5` 或 `7.500000000000001`（理論上；目前 0.25 倍數不會發生，但資料被竄改就會）。

**改法**：新開 `src/utils/format.js`，把 `formatDays` 搬過去並修掉一個小瑕疵——目前的 `n.toFixed(2).replace(/\.?0+$/, '')` 對 `0.001` 會回傳 `"0"`（非零顯示成零）。

```js
// src/utils/format.js
/** 整數顯示為整數，小數最多兩位且去掉尾隨的 0。 */
export function formatDays(n) {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  const fixed = n.toFixed(2);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
```

然後在四處統一使用。

### R4　`leaveCalculations.js` 職責過多，建議拆檔

這個檔案現在同時承擔：日期工具、勞基法規則、規則解析、期間切割、帳本計算、鏈式驗證、摘要組裝、標籤格式化、合規檢查。九個職責、單檔 400 行以上，而且其中「日期工具」被 `LeaveCalendar`、`LeaveForm`、`Settings`、`exportCsv` 到處 import——導致這些元件對整個計算核心產生不必要的相依。

**建議切法**：

| 新檔案 | 內容 |
|---|---|
| `src/utils/dateUtils.js` | `addMonthsToDate`、`getCompletedMonths`、`toISODateString`、`parseLocalDate` |
| `src/utils/leaveRules.js` | `getLaborLawDays`、`buildLaborLawMilestones`、`getMilestones`、`getDaysForMilestone`、`checkLaborLawCompliance` |
| `src/utils/leaveLedger.js` | `getPeriodInfo`、`computePeriodLedger`、`validateRecordsChain`、`calculateSummary`、`findOrphanRecords` |
| `src/utils/leaveRecords.js` | `getLeaveRecordDates`、`getLeaveTakenInPeriod` |
| `src/utils/format.js` | `formatDays`、`formatPeriodLabel` |

既有測試檔也可對應拆成四份，讀起來會清楚很多。建議用 re-export 做漸進遷移，避免一次改動所有 import：

```js
// src/utils/leaveCalculations.js  ← 暫時保留為 barrel
export * from './dateUtils.js';
export * from './leaveRules.js';
export * from './leaveLedger.js';
export * from './leaveRecords.js';
```

### R5　`computePeriodLedger` 的 O(n²) milestone 重算

```js
for (const milestoneMonths of chainMilestones) {
  const period = getPeriodInfo(onboardDate, milestoneMonths, ruleType, customRules);
  // getPeriodInfo 內部又呼叫一次 getMilestones()，每次重建整個陣列
}
```

年資 10 年約 11 個期間、20 年約 21 個，實際負擔很小，所以這**不是效能問題**——但它是一個結構訊號：`getPeriodInfo` 需要「整個 milestone 清單」這個上下文，卻每次自己重建。

**改法**：讓 milestone 清單成為顯式參數。

```js
export function buildPeriods(onboardDate, ruleType, customRules, upToMonths) {
  const milestones = getMilestones(ruleType, customRules, upToMonths);
  return milestones.map((milestoneMonths, i) => {
    const nextMilestoneMonths = milestones[i + 1] ?? milestoneMonths + 12;
    const periodStart = addMonthsToDate(onboardDate, milestoneMonths);
    const periodEnd = new Date(addMonthsToDate(onboardDate, nextMilestoneMonths));
    periodEnd.setDate(periodEnd.getDate() - 1);
    return {
      milestoneMonths, nextMilestoneMonths, periodStart, periodEnd,
      entitledDays: getDaysForMilestone(milestoneMonths, ruleType, customRules),
    };
  });
}
```

順帶一提，這個寫法同時**根除了 P0-2 的 `indexOf` 陷阱**——用索引取下一個里程碑，重複值也不會指到自己。`getPeriodInfo` 可以保留為 `buildPeriods(…).find(p => p.milestoneMonths === m)` 的薄包裝，或直接標記為 deprecated。

### R6　`Settings.jsx` 過長，且用 `alert()` 做驗證回饋

單一元件包含：到職日欄位、規則類型卡片、勞基法預覽表、自訂規則編輯表、合規警告、遞延開關、動作按鈕、兩層離職彈窗，外加四個本地子元件。

**拆法建議**：

- `src/components/settings/CustomRulesTable.jsx`（表格 + 新增/刪除 + 合規警告）
- `src/components/settings/ResignFlow.jsx`（兩層彈窗 + 結清計算 + 匯出）
- `src/components/settings/LaborLawPreview.jsx`（靜態表格，目前那個 inline 陣列可以搬成模組層級常數）
- `src/components/ui/Modal.jsx`、`Section.jsx`（共用）

同時把 `alert()` 換成與 `LeaveForm` 一致的 inline 錯誤訊息（`const [formError, setFormError] = useState('')`）。理由有三：`alert` 阻塞 UI、無法樣式化、且 e2e 必須用 `page.once('dialog', …)` 這種脆弱的方式攔截（你現在的測試正是這樣寫的，改成 inline 之後可以直接 `expect(getByText(…)).toBeVisible()`）。

另外 `resignSummary = calculateSummary(settings, records, new Date())` 寫在元件本體，**每次 render 都重算且每次產生新的 `new Date()`**，應該包 `useMemo`（或更好：只在打開離職彈窗時才算）。

### R7　移除 `uuid` 相依，改用 `crypto.randomUUID()`

`package.json` 為了一個 `v4()` 呼叫引入 `uuid@^14`。`crypto.randomUUID()` 在所有現代瀏覽器（含 README 推薦的 Chrome）皆原生支援，且本專案是純前端、部署在 HTTPS 的 GitHub Pages（`crypto.randomUUID` 需要 secure context，這個條件成立）。

移除後少一個相依、少一段 bundle。`Settings.jsx` 和 `App.jsx` 各換兩三處即可。

### R8　清除死碼

- `LeaveForm.jsx` 的 `DAY_STEPS` 常數**完全沒有被使用**（快選按鈕用的是 inline 的 `[0.25, 0.5, 1, 2, 3]`）。刪掉，或改成讓快選按鈕使用它。
- `getPeriodContainingDate` 似乎沒有被任何元件呼叫（請用 `rg 'getPeriodContainingDate' src e2e` 確認）。若只有測試在用，考慮移除或標記為 internal。
- `LeaveCalendar.handleChange` 裡的 `if (date >= periodStart && date <= periodEnd)` 與 `tileDisabled` 重複——`minDate`/`maxDate` 已經讓 react-calendar 把區間外的 tile 設為 `disabled`，點不到。保留一個即可（建議保留 `tileDisabled`，因為 `tileClassName` 需要相同判斷，可以抽成一個 `isOutOfPeriod(date)` 函式共用）。
- `SummaryCard` 同時有 `unit` 和 `sub` 兩個 props 走 `sub ?? unit`，但所有呼叫端都只傳 `unit`。二選一。

### R9　`storage.js` 加上 schema 版本與淨化

目前 `loadRecords()` 直接回傳 `JSON.parse` 的結果——如果 localStorage 被寫成一個物件而非陣列，`records.reduce` 會在 render 期間拋錯（配合 R-P1-4 提到的無 ErrorBoundary，結果是白畫面）。`loadSettings()` 雖然有 spread 預設值，但 `customRules` 若是字串或 null 同樣會炸。

```js
const SCHEMA_VERSION = 1;

function sanitizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  return {
    onboardDate: typeof merged.onboardDate === 'string' ? merged.onboardDate : '',
    ruleType: merged.ruleType === 'custom' ? 'custom' : 'labor',
    customRules: Array.isArray(merged.customRules)
      ? merged.customRules
          .filter(r => r && typeof r === 'object')
          .map(r => ({ id: String(r.id ?? crypto.randomUUID()), months: Number(r.months), days: Number(r.days) }))
          .filter(r => Number.isFinite(r.months) && Number.isFinite(r.days))
      : [],
    allowCarryover: Boolean(merged.allowCarryover),
  };
}

function sanitizeRecords(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r === 'object')
    .map(r => ({ id: String(r.id ?? crypto.randomUUID()), startDate: String(r.startDate ?? ''), days: Number(r.days) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && Number.isFinite(r.days) && r.days > 0);
}
```

並在寫入時一併存 `schemaVersion`，替未來的資料結構變更預留遷移點。

### R10　型別：建議至少加 JSDoc typedef

專案已經有 `@types/react`，但沒有 TypeScript 也沒有 PropTypes。`LeaveForm` 有 13 個 props、`MainPage` 有 6 個，而 `days` 這個值在 state 裡是 `number | string`（初始是 number，使用者輸入後變 string）——這種型別漂移正是本專案第二個 bug（數字輸入框歸零）的根源。

不需要整包遷移到 TS，先加 typedef 就能讓編輯器提供檢查：

```js
/**
 * @typedef {{ id: string, startDate: string, days: number }} LeaveRecord
 * @typedef {{ id: string, months: number, days: number }} CustomRule
 * @typedef {{ onboardDate: string, ruleType: 'labor'|'custom', customRules: CustomRule[], allowCarryover: boolean }} Settings
 * @typedef {{ milestoneMonths: number, nextMilestoneMonths: number, periodStart: Date, periodEnd: Date,
 *             entitledDays: number, taken: number, carryIn: number, carryOut: number,
 *             settlement: number, remaining: number }} PeriodSummary
 */
```

搭配 `jsconfig.json` 的 `"checkJs": true` 即可在 IDE 裡即時看到型別錯誤，成本很低。

### R11　缺少 lint 設定

`package.json` 沒有 ESLint，CI 也只跑測試。`react-hooks/exhaustive-deps` 這條規則就能自動抓到 P2-1（`useMemo(() => new Date(), [])`）與 R2 的 effect 問題。建議加：

```jsonc
// devDependencies
"eslint": "^9",
"eslint-plugin-react": "^7",
"eslint-plugin-react-hooks": "^5",
"globals": "^15"
```

並在 `pr-checks.yml` 的測試步驟之前加一步 `npm run lint`。

### R12　錯誤訊息字串散落各處

`'日期必須在本週年度範圍內'`、`'這筆請假超支可用額度上限，請確認天數是否正確'`、`'年資門檻請填寫正整數（月數）'` 等等，同時出現在元件和 e2e 斷言裡。任何一次文案微調都會讓 e2e 紅掉。

建議集中成 `src/constants/messages.js`，元件與測試都從那裡 import。這同時也是未來要做多語系（例如加英文版）的前置作業。

---

## 四、建議實作順序

給 Claude Code 的執行順序建議，依「風險 × 相依性」排序：

**第一批：計算核心（有既有單元測試當安全網）**

1. R5 `buildPeriods` 重寫期間切割 —— 順帶根除 P0-2 的 `indexOf` 陷阱
2. P0-1 `getMilestones` 自訂門檻年度網格補齊
3. P2-4 `getLeaveRecordDates` 迴圈上限
4. 補測試：P0-1 的 `[6,12,24,36,60,120]` 期間長度、P0-2 的重複門檻、P0-3 的空規則

**第二批：輸入驗證（純新增，不動既有行為）**

5. P0-2 / P0-3 `Settings.handleSave` 的重複/空清單/上限驗證 + 刪除鈕下限
6. P1-2 `LeaveForm` 跨期間檢查
7. P2-5 單筆天數上限

**第三批：UI 修正（改動小、風險低）**

8. P1-1 + P2-3 `<LeaveCalendar key>` / `<LeaveForm key>`
9. P2-2 `showCarryOut` 拆分
10. P2-7 月曆圓點無障礙文字
11. P2-8 月曆副標揭露國定假日限制

**第四批：資料韌性（獨立功能，可平行）**

12. R9 `storage.js` sanitize + schemaVersion
13. P1-4 ErrorBoundary
14. P1-4 JSON 備份匯出/還原

**第五批：結構重構（無行為變更，最後做）**

15. R1 `App.jsx` 持久化改 useEffect（**這批裡最需要小心的一項**，離職重來的行為要靠既有 e2e 守住）
16. R2 MainPage 衍生狀態
17. R3 + R4 工具函式拆檔
18. R6 Settings 拆元件 + 移除 `alert()`（會需要同步改 e2e）
19. R7 移除 uuid、R8 清死碼、R10 typedef、R11 ESLint、R12 訊息常數

**第六批：需要你先做產品決策，才適合動工**

20. P1-3 設定解鎖與修正流程 —— 要先決定「允許改到職日」的產品語意
21. P2-6 離職結清是否改為明細顯示

---

## 五、建議補上的測試

以下是目前情境矩陣中**完全沒有測試覆蓋**的格子，按價值排序：

**單元測試（`leaveCalculations.test.js`）**

```js
describe('getMilestones 自訂規則的年度網格', () => {
  it('預設自訂門檻不會產生超過 12 個月的期間', () => {
    const rules = [6, 12, 24, 36, 60, 120].map(months => ({ months, days: 1 }))
    const milestones = getMilestones('custom', rules, 140)
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i] - milestones[i - 1]).toBeLessThanOrEqual(12)
    }
    expect(milestones).toEqual(expect.arrayContaining([48, 72, 84, 96, 108]))
  })

  it('補進來的中間里程碑沿用下層門檻的天數', () => {
    const rules = [{ months: 36, days: 14 }, { months: 60, days: 15 }]
    expect(getDaysForMilestone(48, 'custom', rules)).toBe(14)
  })

  it('門檻重複時去重，不會產生 periodEnd 早於 periodStart 的期間', () => {
    const rules = [{ months: 12, days: 7 }, { months: 12, days: 9 }]
    const info = getPeriodInfo(d('2023-01-01'), 12, 'custom', rules)
    expect(info.periodEnd.getTime()).toBeGreaterThan(info.periodStart.getTime())
  })
})

describe('getLeaveRecordDates 防禦', () => {
  it('天數異常巨大時在上限處停止，不會無限迴圈', () => {
    expect(getLeaveRecordDates('2025-01-01', 1e6).length).toBeLessThanOrEqual(400)
  })
  it('天數為 NaN 時回傳空陣列', () => {
    expect(getLeaveRecordDates('2025-01-01', NaN)).toEqual([])
  })
})
```

**E2E（新增 `e2e/custom-rules.spec.js`）**

- 使用「公司另有規定」+ 預設門檻，到職滿 4 年時，期間區間長度為 12 個月（斷言期間資訊列的起訖日）
- 自訂門檻填重複值時，儲存被擋下並顯示明確錯誤
- 刪除到剩一條規則時，刪除鈕變成 disabled

**E2E（補進 `period-tabs.spec.js`）**

- 切到較舊的分頁後，**月曆顯示的月份落在該期間內**（斷言 `.react-calendar__navigation__label` 的文字）—— 這條直接守住 P1-1
- 在表單日期欄輸入一半後切換分頁，表單被清空

**E2E（補進 `calendar-and-records.spec.js`）**

- 起始日靠近期間結束、天數會溢出時，顯示「請拆成兩筆」錯誤且不寫入

---

## 附註：關於既有的兩個已知 bug

你先前討論過的兩個問題，在目前的 codebase 裡**都已經修好了**：

- 多天請假只標第一天圓點 → `getLeaveRecordDates()` 已實作跳過週末的逐日展開，`LeaveCalendar` 已使用，且 e2e 有「跨週末」的專門測試。
- 數字輸入框清空後卡在 0 → `LeaveForm` 與 `Settings` 的數字欄位都已改成綁定原始字串、送出時才 `Number()`/`parseFloat()`，且兩份 e2e 都有「逐字元輸入小數」與「只輸入負號時擋下存檔」的測試。

當時討論的「不過濾負號、依賴下游 > 0 驗證」這個決定也保留著，而且 `Settings` 的 e2e 明確測了這條路徑。這部分不需要再動。
