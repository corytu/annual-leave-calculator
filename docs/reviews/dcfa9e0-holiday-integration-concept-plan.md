# 國定假日資料整合 — 概念計畫（v2）

> **版本說明（v2）**：本版依第一次 plan 迴圈（5 輪 Coder／Reviewer 審查）的結果修訂。v1 有幾處設計寫錯或彼此矛盾，已依對照原始碼後的結論修正。迴圈中 Coder 與 Reviewer 形成的共識，已由維護者逐項追認，並以【已定案】標記寫入本文件。主要變更：
>
> - 修正：hook 改放在 `App.jsx`（§3.1）；顯示月份的 fallback 改為共用 helper，並修正跨年午夜錯位（§3.5）；CSS 需求依實際既有規則重寫（§3.7）；Settings 按鈕 disabled 判斷改為依記憶體中的快取（§3.9）；補上既有 e2e 的 CDN 攔截與 `storage.js` 單元測試（§6）
> - 追認：`ensureYear` 略過規則、持久化範圍、世代計數、清除所有資料的行為、localStorage 存取防護等（§3.2、§3.3、§3.9）
> - 新增：期間外週末顏色修正（§3.8）；`available` 不做背景再驗證的定案與維護說明（§3.3）；給迴圈的撰寫規範（§0）
>
> 對應 GitHub issue：[#34](https://github.com/corytu/annual-leave-calculator/issues/34)（未開放自外部納入國定假日資料）、[#48](https://github.com/corytu/annual-leave-calculator/issues/48)（國定假日不會在請假時被跳過標示）。

## 0. 給 plan／diff 迴圈的閱讀與撰寫規範

### 0.1 本文件的程式碼一律是「示意」

文中的程式碼片段用來說明意圖與約束，不保證可以逐字使用。實作時以實際原始碼為準；片段與原始碼衝突時，以本文件描述的**需求與決策**為準、調整寫法。

### 0.2 【已定案】條目的處理方式

- 標記【已定案】的條目是維護者已確認的決策。Reviewer 不需要重新評估決策本身是否最佳；只有在發現它和實際程式碼衝突、照做會出錯時，才提出 issue。
- 實作計畫可以調整寫法細節，不得改變決策本身。確實需要偏離時，要在實作計畫中明確標註「偏離概念計畫」並寫明理由。

### 0.3 實作計畫的撰寫要求

- **每一版都要完整呈現所有決策**。可以精簡理由，但不得用「沿用，未變動」刪掉決策條文本身。上一次迴圈曾因此遺失三個已確認的樣式決定（見 §3.7）。
- 單元測試列出案例即可。
- e2e 測試以「情境、前置條件、斷言、同步方式」描述，不需要寫出完整的測試程式碼。

### 0.4 e2e 同步原則

- 所有 CDN 請求都經由 `mockHolidayCdn` 攔截（§6.2）。
- 需要確認請求次數時，用 handler 閉包裡的計數器搭配 `expect.poll`。不要在觸發請求的動作之後才註冊 `page.waitForRequest`，因為請求可能早已送出。
- 負向斷言（「某件事不應該發生」）在修正生效時第一次檢查就成立，Playwright 的自動重試不構成同步點。斷言前要先等相關回應處理完（例如 `resp.finished()`），再加一段明確的寬限時間。
- Vitest 中對 `Storage.prototype` 的 spy，要在檔案層級用 `afterEach(() => vi.restoreAllMocks())` 還原。
- **時序正確性以實際執行驗證**：`npx playwright test e2e/holiday-integration.spec.js --repeat-each=20`。這屬於實作與 diff 迴圈的責任；plan 迴圈不對尚未執行的測試程式碼做逐行時序推演。

### 0.5 本次為接續審查

本次 plan 迴圈以上一次迴圈的 Coder 第六版計畫為起點。第六版中已寫出的測試程式碼可以保留作為參考，但依 §0.3、§0.4 的原則審查。

## 1. 背景與目標

`getLeaveRecordDates` 目前只跳過週六日，不考慮國定假日與彈性放假（調整放假、補班日），導致：

1. **視覺層**：月曆上沒有任何國定假日標示
2. **邏輯層**（#48 的核心）：一筆跨越連假的多天請假記錄，圓點會標在使用者其實不用上班的日子上，而不是正確地往後延展

本功能同時解決這兩層問題，且**不影響特休餘額計算**：`getLeaveTakenInPeriod` 直接加總 `r.days`，不呼叫 `getLeaveRecordDates`，兩者是獨立路徑。

## 2. 資料源

- **ruyut/TaiwanCalendar**，經 jsDelivr CDN 取得：`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json`
- 純前端 client-side fetch，不引入後端
- CORS 已由維護者實測可用（curl header 檢查，以及實際部署網域下的瀏覽器 fetch）
- `date` 欄位是無橫線的 `YYYYMMDD`（如 `"20270101"`），需轉成 `YYYY-MM-DD`
- `isHoliday` 涵蓋週六日、國定假日與補假，不是只有國定假日（實測 2027 年資料的每個週六日都是 `true`）。有資料的年度以 `isHoliday` 為唯一真相來源；只有沒資料的年度才 fallback 成「週六日視為非工作日」

### README 授權文案（放進「授權」章節，逐字使用）

```
行事曆中的國定假日標示，資料引用自公開 GitHub 專案 [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar)，其原始資料源自[政府資料開放平臺](https://data.gov.tw/)之「中華民國政府行政機關辦公日曆表」，依創用 CC 姓名標示 4.0 國際版本（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）提供。

本專案程式碼以 [MIT 授權](LICENSE.txt)釋出。
```

## 3. 設計決策

### 3.1 架構：hook 位置與資料流【已定案】

- `useHolidayCache()` 在 `App.jsx` 呼叫一次，回傳 `{ cache, ensureYear, clearCache }`。
  - 往下傳給 `MainPage`：`holidayCache`、`ensureYear`。
  - 往下傳給 `Settings`：`holidayCache`、`onClearHolidayCache`、`onClearAllData`。
- **理由**：`App.jsx` 以 `page === 'main' ? <MainPage/> : <Settings/>` 互斥渲染。Settings 不是 MainPage 的子元件，而且切換頁面時另一方會整個卸載。hook 若放在 MainPage（v1 的寫法），Settings 拿不到快取，切到設定頁時 hook 狀態與 in-flight guard 也會跟著消失。
- `MainPage` 負責兩個 effect，兩者都對需要的每個年度呼叫 `ensureYear`：
  - **coverage effect**：依賴 `neededYearsKey`
  - **每日心跳 effect**：依賴 `today`（來自既有 `useToday()`）
- 觸發 effect 不直接依賴 `periods` 的參照。`calculateSummary` 的 `useMemo` 依賴包含 `records`，每次編輯請假記錄都會產生新的 `periods` 參照。因此改用「需要的年度集合」序列化後的字串當依賴：

  ```js
  // 示意
  function computeNeededYears(periods) {
    const years = new Set()
    periods.forEach(p => {
      years.add(p.periodStart.getFullYear())
      years.add(p.periodEnd.getFullYear())
    })
    return years
  }
  const neededYears = useMemo(() => computeNeededYears(periods), [periods])
  const neededYearsKey = [...neededYears].sort().join(',')
  ```

- **Hooks 規則**：`MainPage` 有兩個既有的 early return（尚未設定到職日、尚無特休）。所有新增的 `useMemo`／`useState`／`useEffect` 必須放在 early return 之前；只有依賴 `activePeriod` 的推導值可以放在之後。

### 3.2 五態模型與 `ensureYear` 規則【已定案】

| 狀態 | 判斷依據 | 自動重抓時機 | 手動介入 |
|---|---|---|---|
| `available` | fetch 成功取得資料 | 不重抓（永久快取，見 §3.3） | 無 |
| `loading` | 請求進行中（含 `error` 的自動重試期間） | 不適用 | 無需 |
| `pending` | 404，且年度 `>= currentYear` | MainPage 每次掛載、每日心跳 | 可用 Settings「清除國定假日快取」強制重抓 |
| `unavailable` | 404，且年度 `< currentYear` | 不重抓（永久快取） | 同上 |
| `error` | 非 404 的失敗（網路錯誤、非 2xx、JSON 解析失敗） | 抓取層內先自動重試：立刻、2 秒後、5 秒後，共 3 次；之後在 MainPage 每次掛載、每日心跳也會重抓 | 「點此重試」按鈕 |

`ensureYear(year)` 的規則：

- **只有**快取中該年度為 `available` 或 `unavailable`、且 `cacheVersion` 相符時才略過。其他情況（沒有紀錄、`pending`、`error`）一律重抓。
- 發出請求前，先把該年度設為 `loading`，讓手動重試與每日重試都有即時的視覺回饋。
- 用一個 in-flight guard（`Set`）避免同一年度重複發請求。coverage effect 與每日心跳 effect 在掛載時會同時觸發，要靠它擋掉重複請求。
- 判斷是否略過、是否在飛行中時，讀 ref（例如 `cacheRef`），不讀 closure 裡的 state。否則清除快取後，同一次 render 內仍會看到舊值。
- **世代計數**：`clearCache()` 將世代加一。請求發出時記下當下的世代；resolve 時若世代已過期，就直接放棄：不寫 state、不寫 localStorage、也不動 in-flight guard（`clearCache()` 已整批清空 guard，由新的請求接手）。
- 404 分類採 `year >= currentYear` 為 `pending`，刻意給資料源維護者一年緩衝。附帶效果：一個年度若拖過緩衝期仍未公布，下次重抓時會自動改判為 `unavailable`，不需要另寫「重試 N 次就放棄」的邏輯。
- **追認的副作用**：`error` 會在 MainPage 重新掛載與每日心跳時自動重抓，成本低且能自我修復。`error` 的文案仍不加「暫時」，因為使用者停留在畫面上時，它不會自己好轉。

### 3.3 快取持久化【已定案】

- localStorage key：`leaveCalculator_holidayCache_{year}`，沿用既有 `leaveCalculator_*` 命名慣例。每筆紀錄帶 `cacheVersion`，對應程式碼中的 `HOLIDAY_CACHE_VERSION`（初始為 `1`）。
- **只持久化 `available` 與 `unavailable`**；`loading`、`pending`、`error` 只存在記憶體。理由：`pending` 與 `error` 本來就要在每次掛載時重新確認，持久化它們反而會讓下次開站時被誤當成已確定的結果。
- `available` 的日期以陣列儲存，讀取時轉回 `Set`。
- App 掛載時用 `useState` 的 lazy initializer 從 localStorage 載入一次（hydrate）。版本不符或損毀的紀錄直接略過，視為沒抓過。
- **所有 localStorage 存取都要防護**：瀏覽器封鎖網站資料時，連存取 `localStorage` 本身都會丟出 `SecurityError`。
  - hydrate：外層 try/catch，失敗時回傳 `{}`
  - 寫入、清除：失敗時靜默放棄
  - `hasAnyAppData()`（§3.9）：失敗時回傳 `false`
  - 目標是這種環境下 App 與 Settings 頁都能正常渲染，只是無法持久化。寫入失敗時，該次 session 仍以記憶體中的結果正常顯示。
  - 既有的 `clearAll()` 沒有 try/catch，屬既有行為，本輪不改。
- **`available` 永久快取，不做背景再驗證**。
  - **理由**：已公布年度的辦公日曆表事後被修改的情況很罕見。為此多一條「有資料但可能過期」的狀態路徑與對應測試並不划算。
  - **已知風險**：2025 年曾因修法新增國定假日，人事總處重新公告當年度的辦公日曆表。在修正前就快取該年度的使用者，不會自動取得新資料。
  - **因應方式**：維護者將 `HOLIDAY_CACHE_VERSION` 加一並重新部署，所有使用者下次開站會自動重抓；使用者也可以自行用 Settings「清除國定假日快取」。
  - 這項維護程序寫進 `CONTRIBUTING.md`（§4）。

### 3.4 UI 文案與樣式（`calendar-holiday-note`）

五種狀態都顯示文字，依「目前顯示月份所屬年度」的狀態決定（§3.5）。快取中查無該年度時視為 `loading`。

| 狀態 | 文案 | 文字顏色 |
|---|---|---|
| `available` | 國定假日資料已載入，圓點已跳過所有國定休假 | `text-stone-400` |
| `loading` | 國定假日資料載入中，圓點暫時只跳過週六日 | `text-stone-400` |
| `pending` | 國定假日資料尚未公布，圓點暫時只跳過週六日 | `text-stone-400` |
| `unavailable` | 無國定假日資料來源，圓點只跳過週六日 | `text-stone-400` |
| `error` | 國定假日資料載入失敗，圓點只跳過週六日（點此重試） | `text-red-600` |

- 只有 `error` 用紅色，因為它是唯一需要使用者採取行動的狀態。其餘四種維持與同區塊其他說明文字一致的灰階語氣。
- 「點此重試」是 `<button type="button">`，樣式做成連結（底線），不在 span 上掛 onClick，讓鍵盤與讀螢幕軟體都能操作。
- 保留既有的 `data-testid="calendar-holiday-note"`，既有與新增的 e2e 都靠它定位。
- 五句文案都包含「國定假日」，因此既有 e2e 的 `toContainText('國定假日')` 斷言在整個開發過程中都會持續通過，不需要修改斷言本身。

### 3.5 顯示月份的粒度【已定案】

**需求**：note 反映的是「使用者現在看到的那個月所屬年度」的狀態，而不是整個 period。一個 period 可能橫跨兩個狀態不同的年度。

- **`minDetail="month"`**：禁止鑽到年檢視或年代檢視，確保畫面上永遠只有一個月、只對應一個年度狀態。
- **共用 helper `getDefaultVisibleMonth(periodStart, periodEnd, today)`**（放在 `leaveCalculations.js`）：
  - 規則：今天落在期間內就用今天的月份，否則用 `periodStart` 的月份。
  - `today` 先正規化到當天午夜再比較。這順便修正一個既有 bug：`periodEnd` 是午夜，帶時間的 `today` 在期間最後一天會比它大，導致誤判成 `periodStart` 的月份。
- **月曆在掛載時凍結並回報初始月份**：
  - `LeaveCalendar` 用 `useState` 的 lazy initializer 算出掛載當下的初始月份，作為 `defaultActiveStartDate`，並在掛載時呼叫一次 `onVisibleMonthChange(初始月份)`。使用者之後切換月份，則經由 `onActiveStartDateChange` 回報。
  - **理由一**：react-calendar 6.0.1 的 `onActiveStartDateChange` 只在使用者操作時觸發，掛載時不會觸發（已對照原始碼）。
  - **理由二**：`defaultActiveStartDate` 只在掛載時讀取一次。若 MainPage 每次 render 都用即時的 `today` 重算 fallback，網頁開著跨過 12/31 午夜、且使用者未切換月份時，月曆仍顯示 12 月，note 卻會改讀下一年度的狀態。
- **MainPage**：`visibleYear = (visibleMonth ?? getDefaultVisibleMonth(...)).getFullYear()`。fallback 只在月曆回報之前的第一次 render 生效。
- **重置**：`handleSelectPeriod` 切換 tab 時將 `visibleMonth` 設回 `null`；清空到職日的既有 effect 也一併重置。月曆因 `key` 重新掛載後會再次回報，手動重置保留作為保險。
- 修改 `LeaveCalendar` 附近的程式碼時，同步更新既有註解（"react-calendar only reads defaultActiveStartDate at mount..."），補充說明：`key` 重新掛載重置的是月曆本身，不是 MainPage 的 `visibleMonth`。

```jsx
// 示意：LeaveCalendar.jsx
const [initialMonth] = useState(() => getDefaultVisibleMonth(periodStart, periodEnd, today))
useEffect(() => { onVisibleMonthChange?.(initialMonth) }, [])

<Calendar
  defaultActiveStartDate={initialMonth}
  minDetail="month"
  onActiveStartDateChange={({ activeStartDate }) => onVisibleMonthChange?.(activeStartDate)}
  ...
/>
```

### 3.6 `getLeaveRecordDates` 的假日感知（#48 的核心）

- 全專案只有 `LeaveCalendar.jsx` 一處呼叫 `getLeaveRecordDates`，回傳值從未持久化、每次 render 現算。因此假日資料到位並觸發 re-render 時，既有請假記錄的圓點會自動重新計算、往後延展，不需要額外的「重算既有記錄」邏輯。
- 簽章新增第三參數 `isNonWorkingDay`，預設值為「只判斷週末」，維持向後相容。
- 新增 `makeIsNonWorkingDay(holidayCache)`：
  - 年度為 `available` 時，依日期 `Set` 判斷。
  - 其他狀態（含查無紀錄）退回只判斷週末。
  - **同一個實例同時餵給 `getLeaveRecordDates` 與 `tileClassName`**，確保圓點與標紅的判斷永遠一致。

```js
// 示意
export function makeIsNonWorkingDay(holidayCache) {
  return function isNonWorkingDay(date) {
    const entry = holidayCache[date.getFullYear()]
    if (entry?.status === 'available') return entry.dates.has(toISODateString(date))
    return date.getDay() === 0 || date.getDay() === 6
  }
}
```

**已知邊界，本輪不處理**：多天請假往後延展時，可能推到超出 `periodEnd`。react-calendar 不渲染範圍外的 tile，最壞結果只是圓點尾端被截斷，不影響天數計算。

### 3.7 視覺樣式【已定案】

**決策**：
- 假日（含無資料時 fallback 的週末）的日期數字改為暗紅 `#9f1239`，不採用第二個圓點。
- 選取中的假日：背景暗紅、文字白色。
- `tileClassName` 依 `isNonWorkingDay(date)` 決定是否加上 `react-calendar__tile--holiday`，不依賴 react-calendar 原生的 `--weekend` class。

**必須滿足的 CSS 需求**（v1 的選擇器寫錯了，以下依 `index.css` 實際既有規則重寫）：

1. 假日暗紅必須勝過既有的週末灰色規則 `.react-calendar__month-view__days__day--weekend { color: #6b7280 }`。它與單一 class 同特異性，而且寫在較後面。
2. 期間外的日期維持淡灰，不被假日暗紅覆蓋（期間外優先）。
3. 選取中的假日必須勝過既有的 `.react-calendar__tile--active:enabled:hover/:focus`。後者特異性 (0,3,0) 且帶 `!important`，點擊後按鈕保持 focus，會把背景變回 teal。

```css
/* 示意（上一次迴圈中經 Reviewer 對照 index.css 確認可行） */
.react-calendar__tile--holiday:not(.react-calendar__tile--out-of-period) {
  color: #9f1239;
}
.react-calendar__tile--active.react-calendar__tile--holiday {
  background: #9f1239 !important;
  color: white !important;
}
.react-calendar__tile--active.react-calendar__tile--holiday:enabled:hover,
.react-calendar__tile--active.react-calendar__tile--holiday:enabled:focus {
  background: #9f1239 !important;
}
```

**明確接受的樣式結果**（上一次迴圈第二、三輪已確認，後續版本因壓縮而遺失，於此補回）：

- 補班的週六不加 `--holiday`，但仍帶原生 `--weekend` class，維持週末灰色 `#6b7280`。
- 未選取的假日在 hover／focus 時，文字維持暗紅，不變成 teal。
- 今天剛好是假日時，暗紅文字蓋過 `--now` 的 teal 文字色；`--now` 的淺色底與粗體保留。

### 3.8 期間外週末顏色修正（既有瑕疵，本輪一併修正）【已定案】

- **現象**：期間外的週末顯示 `#6b7280`（與期間內週末同色），而不是期間外應有的淡灰 `#d1d5db`。
- **成因**：`.react-calendar__tile--out-of-period` 與 `--weekend` 規則同為單一 class 特異性，前者寫在較前面，被後者覆蓋。同檔案中的鄰月規則 `--neighboringMonth` 寫在週末規則之後，所以鄰月週末正確顯示淡灰，可見這是規則順序的意外。
- **修法**：把 `--out-of-period` 規則移到週末規則之後（鄰月規則旁）。
- **影響範圍已檢查，挪動位置不影響其他規則**：
  - 假日規則靠 `:not(--out-of-period)` 排除期間外，不受順序影響。
  - 期間外的 tile 是 disabled，不會成為 `--active`。
  - `--now` 規則本來就在更前面。
- 做成獨立 commit，不標註 #34／#48。

### 3.9 Settings 資料管理【已定案】

- **新增兩顆按鈕**，都是 `type="button"`，點擊後以既有的 `Modal` 元件顯示確認彈窗（「確定清空」／「取消」），比照離職流程的兩步驟寫法：
  - 「清除國定假日快取」：確認文案為「將清除國定假日快取，未來使用時將觸發重新下載」
  - 「清除所有本機資料」：確認文案為「將清空所有資料，請自行備份重要資訊」
- **disabled 判斷依記憶體中的快取**（偏離 v1 以 localStorage 為準的定義）：
  - 「清除國定假日快取」enabled ⟺ `holidayCache` 中至少有一筆紀錄（不論狀態）
  - 「清除所有本機資料」enabled ⟺ `hasAnyAppData() || 上述條件`，其中 `hasAnyAppData()` 回報 settings 或 records 是否存在
  - **偏離理由**：只持久化 `available`／`unavailable` 之後，若以 localStorage 為準，「只有 `pending`」時按鈕會是 disabled，§3.2 承諾的「可用清除快取強制重抓 `pending`」就做不到。
  - 從 props 推導、每次 render 內聯計算，天然滿足「清除後立即重新評估」。
  - **驗證情境**：
    - 首次使用、尚無到職日 → 不會發出請求，兩顆都 disabled
    - 曾進過首頁 → 兩顆都 enabled
    - 離職後再清除國定假日快取 → 兩顆都 disabled
- **清除國定假日快取**：
  - 呼叫 `clearCache()` 後停留在設定頁。
  - 重新抓取發生在使用者回到首頁、MainPage 重新掛載時，由 coverage effect 自然觸發。Settings 不需要知道需要哪些年度（v1 在 Settings 使用 `neededYears` 的寫法不可行，已移除）。
- **清除所有本機資料**：
  - 依序呼叫既有的 `clearAll()` 與 `clearCache()`，並重設 App 記憶體中的 settings（`DEFAULT_SETTINGS`）與 records（`[]`），然後 `setPage('main')`，畫面落在 EmptyState。比照既有的 `handleResign` 模式。
  - 若只清 localStorage 而不重設 App state，回到首頁仍會顯示舊資料。
- **離職彈窗**：「應結清工資天數」卡片新增第二行 `（不含瀏覽器暫存的國定假日資料；如需一併清除請至設定頁「清除所有本機資料」）`，樣式為 `text-xs text-stone-400`。
- 離職流程本身不改動：`clearAll()` 只清 settings 與 records，不影響假日快取。

### 3.10 與 issue #46（警告 UI 重構）的關係

- 資料模型不共用。`Warning` 型別是為使用者輸入驗證設計的（touched 狀態、可能阻擋送出），假日狀態是背景非同步抓取，語意不同。
- 視覺 class 風格（如 `text-xs text-red-600`）可以借用。
- #46 已完成、等待 merge，本功能不依賴它。

### 3.11 已知且刻意不處理的事項

- 多天請假延展超出 `periodEnd` 時圓點被截斷（§3.6）
- `available` 不做背景再驗證（§3.3）
- `mockHolidayCdn` 採每個 spec 手動呼叫，不改成 Playwright auto fixture。未來新增 spec 時需自行呼叫，helper 的註解要寫明這一點。
- 既有 `clearAll()` 沒有 try/catch（§3.3）

## 4. 檔案異動範圍

| 檔案 | 異動內容 |
|---|---|
| `src/utils/holidayCache.js`（新增） | 抓取與分類（含 404 分類、`error` 自動重試、可注入 `fetchImpl`／`sleep`）、日期格式轉換、`HOLIDAY_CACHE_VERSION`、持久化、hydrate、清除；所有 localStorage 存取加防護 |
| `src/utils/holidayCache.test.js`（新增） | 見 §6.1 |
| `src/hooks/useHolidayCache.js`（新增） | reactive hook：`cache`、`ensureYear`、`clearCache`；`cacheRef`、in-flight guard、世代計數。無對應單元測試（符合既有 hook 慣例），由 e2e 覆蓋 |
| `src/App.jsx` | 呼叫 `useHolidayCache()`；props 下傳；新增 `handleClearAllData` |
| `src/utils/leaveCalculations.js` | `getLeaveRecordDates` 第三參數；新增 `makeIsNonWorkingDay`、`getDefaultVisibleMonth` |
| `src/utils/leaveCalculations.test.js`（擴充） | 見 §6.1 |
| `src/utils/storage.js` | 新增 `hasAnyAppData()`（含 try/catch）；`clearAll()` 不改 |
| `src/utils/storage.test.js`（擴充） | 見 §6.1 |
| `src/components/MainPage.jsx` | coverage effect、每日心跳 effect、`visibleMonth`／`visibleYear`、`handleSelectPeriod` 重置、note 五態文案與重試按鈕 |
| `src/components/LeaveCalendar.jsx` | 初始月份凍結與回報、`minDetail="month"`、`onActiveStartDateChange`、`tileClassName` 加假日判斷、`getLeaveRecordDates` 傳入 `isNonWorkingDay`、更新註解 |
| `src/index.css` | 假日樣式（§3.7）；`--out-of-period` 規則移位（§3.8） |
| `src/components/Settings.jsx` | 兩顆按鈕、確認彈窗、disabled 判斷；離職彈窗第二行說明 |
| `e2e/helpers.js` | 新增 `mockHolidayCdn(page, handler)` |
| 既有 6 個 spec | `calendar-and-records`、`carryover`、`period-tabs`、`onboarding-and-settings`、`resignation`、`footer`：在 `freezeTime` 之後呼叫 `mockHolidayCdn(page)`；`calendar-and-records` 中語意過時的測試標題可重新命名，斷言不改 |
| `e2e/holiday-integration.spec.js`（新增） | 見 §6.2 |
| `README.md` | 授權章節文案（§2） |
| `CONTRIBUTING.md` | 新增「國定假日資料維護」小節（見下） |

`CONTRIBUTING.md` 新增小節的內容：

```
## 國定假日資料維護

國定假日資料取自 ruyut/TaiwanCalendar，已抓取成功的年度會永久快取在使用者的瀏覽器中，不會自動重新下載。若政府修改已公布年度的辦公日曆表（例如修法新增國定假日），或資料源的既有檔案有誤並已修正，請將 `src/utils/holidayCache.js` 的 `HOLIDAY_CACHE_VERSION` 加一並重新部署，所有使用者下次開啟網站時會自動重新下載。
```

## 5. Commit 拆分

每個 commit 都要能獨立通過 CI。`Refs` 表示相關但尚未完整解決；`Fixes` 用在使用者真正感受到問題被解決的那個 commit。

1. **資料層**：`holidayCache.js` 與單元測試 → `Refs #34`
2. **既有 e2e 的 CDN 攔截**：`mockHolidayCdn` 與 6 個既有 spec。必須早於任何會發出請求的 commit，確保之後每個 commit 的 e2e 都不打真實網路 → `Refs #34`
3. **hook 串接（純資料，無視覺變化）**：`useHolidayCache.js`、`App.jsx` 的呼叫與 props 下傳、`MainPage.jsx` 的兩個 effect → `Refs #34`
4. **計算層**：`getLeaveRecordDates` 第三參數、`makeIsNonWorkingDay`、`getDefaultVisibleMonth` 與單元測試 → `Refs #48`
5. **期間外週末顏色修正**：`index.css` 規則移位（§3.8）→ 不標註 issue
6. **月曆視覺層**：`LeaveCalendar.jsx`、`MainPage.jsx` 的顯示月份與 note、`index.css` 假日樣式。使用者從這個 commit 起實際感受到兩個 issue 被解決 → `Fixes #48`、`Fixes #34`
7. **Settings 資料管理**：兩顆按鈕、確認彈窗、disabled 判斷、離職彈窗說明、`hasAnyAppData()` 與單元測試、`App.jsx` 的 `handleClearAllData` → `Refs #34`
8. **新 e2e spec**：`holiday-integration.spec.js` → `Refs #34`、`Refs #48`
9. **文件**：README 授權文案、CONTRIBUTING 維護說明 → `Refs #34`

> 原始 P2-8 是先前 code review 報告中的標記，不是 GitHub issue，不另外標註。

## 6. 測試計畫

### 6.1 單元測試（Vitest，`src/utils/**`，須達 codecov/patch 90% 門檻）

**`holidayCache.test.js`（新增，檔案層級加 `afterEach(() => vi.restoreAllMocks())`）**

1. 日期格式轉換：`"20270101"` → `"2027-01-01"`
2. 200 回應解析成 `available` 與日期 `Set`
3. 404 且年度 `>= currentYear` → `pending`，不重試
4. 404 且年度 `< currentYear` → `unavailable`，不重試
5. 非 404 失敗連續 3 次 → `error`；`fetchImpl` 被呼叫 3 次，`sleep` 依序收到 2000、5000
6. 非 404 失敗後第 2 次成功 → `available`，`fetchImpl` 只呼叫 2 次
7. 不注入 `sleep`／`fetchImpl`，改用 fake timers 與 stub 全域 fetch，走一次「失敗後重試成功」，涵蓋預設分支
8. hydrate：版本不符的紀錄視為 cache miss（涵蓋 `available`、`unavailable` 兩種原狀態）；日期陣列正確轉回 `Set`；損毀的 JSON 被略過
9. 持久化寫入丟錯時，不外洩例外
10. 清除只刪除假日快取 prefix 的 key，不影響 settings 與 records
11. localStorage 存取本身丟錯時（模擬瀏覽器封鎖網站資料）：hydrate 回傳 `{}`，清除不外洩例外

**`leaveCalculations.test.js`（擴充）**

12. `getDefaultVisibleMonth`：
    - 今天在期間內（含兩端點）→ 今天的月份
    - 今天在期間外 → `periodStart` 的月份
    - 今天是期間最後一天、帶非午夜時間（如 15:00）→ 仍回傳 `periodEnd` 所在月份
13. `getLeaveRecordDates` 的 `isNonWorkingDay` 對某天回傳 `true` → 該天不計入，展開往後延一天
14. `isNonWorkingDay` 對某個週六回傳 `false`（補班日）→ 視為工作日並計入
15. 不傳第三參數 → 維持只跳過週末（回歸測試）
16. `makeIsNonWorkingDay`：`available` 時依 `Set` 判斷；`pending`／`unavailable`／`error`／查無紀錄時退回只判斷週末

**`storage.test.js`（擴充，檔案層級加 `afterEach(() => vi.restoreAllMocks())`）**

17. `hasAnyAppData()` 的五種情境：兩者皆無 → `false`；只有 settings → `true`；只有 records → `true`；兩者皆有 → `true`；`clearAll()` 後 → `false`
18. `hasAnyAppData()`：`getItem` 丟出 `SecurityError` 時回傳 `false`，不外洩例外

### 6.2 e2e 測試（Playwright）

**共用設定**

- `mockHolidayCdn(page, handler)` 攔截所有 TaiwanCalendar CDN 請求，必須在 `page.goto` 之前呼叫。
  - `handler` 可以是 async，也可以回傳延遲 resolve 的 Promise，用來做延遲回應的情境。
  - 可用閉包維持狀態（計數器、可切換的旗標）。
  - 省略 `handler` 時，每個年度都回 404。
- 預設刻意用 404、不用 `abort`：404 讓年度分類成 `pending`／`unavailable`，圓點只跳過週末，與目前行為一致；`abort` 會被分類成 `error`（紅字）。
- 既有 spec 大多凍結在 `FIXED_TODAY = 2025-06-15`（`currentYear = 2025`）。新測試以 2026 代表 `pending`、2024 代表 `unavailable`。
- 需要其他時間點時，用 `freezeTime(page, iso)` 指定。

**`holiday-integration.spec.js` 情境**

1. **available**：mock 200、含平日假日 → 該日期暗紅；note 顯示「已載入」文案，class 含 `text-stone-400`、不含 `text-red-600`。
2. **既有記錄延展**：已有一筆橫跨平日假日的多天請假 → 圓點跳過假日、往後延展一天。
3. **選取中的假日**：點擊假日 → 背景暗紅、文字白色；點擊後保持 focus 時背景仍為暗紅。
4. **pending**：2026 年回 404 → 切到 2026 年的月份，note 顯示「尚未公布」，`text-stone-400`。
5. **unavailable**：2024 年回 404 → 切到 2024 年的月份，note 顯示「無資料來源」，`text-stone-400`。
6. **error 與重試**：2025 年一律 `abort`。
   - 第一次失敗後，note 仍是「載入中」；用 `page.clock.runFor` 快轉經過第二、三次嘗試。
   - 以計數器與 `expect.poll` 確認請求剛好 3 次；之後 note 變成「載入失敗」、`text-red-600`，並出現「點此重試」按鈕。
   - 把 handler 切成成功後點擊重試 → note 變成「已載入」。
7. **minDetail**：點擊月曆導覽列標籤，不會鑽到年檢視。
8. **跨年度切換月份**：在同一個 period 內切換到狀態不同的年度 → note 文案隨之切換。
9. **期間外的日期**（涵蓋 §3.8 的修正）：期間外的平日假日與期間外的週末，都維持淡灰 `#d1d5db`，不顯示暗紅。
10. **清除國定假日快取**：
    - 快取為空時 disabled；曾進過首頁後 enabled。
    - 點擊後確認彈窗文案正確；確認後停留在設定頁，兩顆按鈕的 disabled 狀態即時更新。
    - 回到首頁後會重新發出請求：用延遲 handler 卡住請求後斷言「載入中」，或以計數器確認請求次數增加。
11. **清除所有本機資料**：
    - disabled 規則同 §3.9。
    - 「離職後再清除國定假日快取」→ 此按鈕 disabled。
    - 確認後導回首頁並顯示 EmptyState。
12. **離職**：確認彈窗的「應結清工資天數」卡片顯示新增的第二行說明；離職後 localStorage 仍有假日快取的 key。
13. **loading 與先有記錄、後有資料**：
    - 先 seed 一筆橫跨「即將被 mock 成假日」那天的多天請假，並延遲 2025 年的回應。
    - 回應前：note 為「載入中」，圓點落在該日（fallback 只跳週末）。
    - 回應成功後：note 變成「已載入」，該日圓點消失，往後延展的那天出現圓點。
14. **世代計數：清除所有本機資料時仍有請求在飛行**：
    - 延遲 2025 年的回應，確認請求已送出（計數器搭配 `expect.poll`）。
    - 切到設定頁執行「清除所有本機資料」，然後放行舊回應。
    - 依 §0.4 等待舊回應處理完並加上寬限後，斷言：localStorage 沒有任何假日快取 key；經 EmptyState 回到設定頁時，兩顆按鈕都是 disabled。
15. **世代計數：清除國定假日快取時仍有請求在飛行**：
    - 第一次請求 A 延遲；清除國定假日快取後回首頁，觸發第二次請求 B，同樣延遲。
    - 放行 A（其資料標記 X 日為假日）→ note 仍為「載入中」，X 日不標紅。
    - 再做一次「設定 → 首頁」讓 MainPage 重新掛載 → 請求次數仍為 2（驗證舊請求沒有誤刪新請求的 in-flight guard）。
    - 放行 B（其資料標記 Y 日為假日）→ Y 日標紅、X 日不標紅。
    - X、Y 必須是預設顯示月份內、且在期間內的平日，例如在 2025-06-15 凍結、到職日 2024-06-01 的前提下，用 2025-06-18 與 2025-06-19。
16. **跨年午夜**（§3.5）：
    - 用 `freezeTime` 設在某年 12/31 深夜，並選一個橫跨年底的 period。當年度 mock 為 available，下一年度回 404。
    - 不切換月份，用 `page.clock.runFor` 快轉過午夜，並超過 `useToday` 的 60 秒輪詢間隔。
    - 斷言：月曆仍顯示 12 月，note 仍為「已載入」，沒有改成下一年度的「尚未公布」。

所有情境的時序穩定性，以 `--repeat-each=20` 實際執行驗證（§0.4）。

## 7. 驗收條件

- [ ] 有資料的年度：平日國定假日與週六日都顯示暗紅；跨越假日的多天請假正確往後延展（單元 13、14、16；e2e 1、2）
- [ ] 沒有資料的年度：退回只跳過週末，週末同樣暗紅（單元 15、16；e2e 4、5、6）
- [ ] note 反映目前顯示月份所屬年度的狀態，包含切換 tab、切換月份、期間最後一天、跨年午夜等情況（單元 12；e2e 8、16）
- [ ] `minDetail="month"` 生效（e2e 7）
- [ ] 選取中的假日背景暗紅、文字白色，focus 時仍維持（e2e 3）
- [ ] 期間外的日期（含週末與假日）一律顯示淡灰（e2e 9）
- [ ] 既有記錄在資料中途到位後，圓點自動重新定位（e2e 13）
- [ ] 五種狀態的文案與顏色正確，只有 `error` 是紅色；「點此重試」可用鍵盤操作（e2e 1、4、5、6、13）
- [ ] `pending` 與 `error` 在重新掛載與每日心跳時重抓；`error` 在抓取層自動重試 3 次後才顯示；`unavailable` 與 `available` 不重抓（單元 3～7；e2e 6）
- [ ] `cacheVersion` 不符時視為沒抓過（單元 8）
- [ ] localStorage 無法使用時，App 與 Settings 頁仍能正常渲染（單元 11、18）
- [ ] 離職不清除假日快取；兩顆清除按鈕的確認彈窗、disabled 規則、清除後的頁面行為正確（單元 10、17；e2e 10、11、12）
- [ ] 清除時仍在飛行中的舊請求，不會讓快取復活、不會覆蓋新結果、不會誤刪新請求的 in-flight guard（e2e 14、15）
- [ ] README 授權文案與 CONTRIBUTING 維護說明已加入

## 8. 相關 Issue

完成後可關閉：[#34](https://github.com/corytu/annual-leave-calculator/issues/34)、[#48](https://github.com/corytu/annual-leave-calculator/issues/48)。原始 P2-8（僅在 UI 揭露限制）由本功能完整取代。
