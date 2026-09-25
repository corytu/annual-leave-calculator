# 國定假日資料整合 — 實作計畫（第九版，回應 Reviewer 第八輪 3 項意見）

> 本文件為完整、獨立可執行的實作計畫，取代第八版。第一輪 14 項、第二輪 9 項、第三輪 3 項、第四輪 4 項、第五輪 3 項、第六輪 12 項、第七輪 6 項意見的裁決與修法**全部維持不變**，不再重複列出理由。本版聚焦第八輪新出現的 3 項意見，**全部接受**。三項都不是對架構決策的挑戰，而是「測試有效性不足」（issue 1：修正失效時測試仍會通過）與「計畫文字的前置條件描述和實際邏輯對不上」（issue 2、3）——與第六、七輪同一類問題，只是這次換了地方出現。本輪已用 Bash 對照實際原始碼逐條驗證下述裁決理由中引用的行號與邏輯。

## Context

`getLeaveRecordDates` 目前只跳過週六日，不考慮國定假日與彈性放假，導致：視覺層月曆無假日標示；邏輯層（#48 核心）跨連假的多天請假記錄圓點誤標在不用上班的日子。本功能同時解決兩層問題（連動 #34），**不影響特休餘額計算**——`getLeaveTakenInPeriod` 直接對 `r.days` 加總，不呼叫 `getLeaveRecordDates`，兩者是獨立路徑。

## 0. 對 Reviewer 第八輪 3 項意見的裁決

全部**接受**。

### 0.1（issue 1）測試 10 驗證不到「清除快取造成重抓」，且是上一輪我自己的建議造成的

接受。第八版把「第一次掛載的請求」改成立即回 404，但在 `FIXED_TODAY = 2025-06-15` 下 2025 年是 `year >= currentYear`，404 依 §2.3 分類成 `pending`；`pending` 的規則是「`ensureYear` 只略過 `available`／`unavailable`，其餘一律重抓」，所以就算完全不點「清除國定假日快取」，光是「設定 → 首頁」的重新掛載也會送出第 2 次請求。這代表測試最後「計數器到 2、note 顯示載入中」這組斷言，在清除邏輯完全失效（例如 `clearCache()` 被改成空函式）的情況下依然會通過——它驗證的其實是「pending 年度會被重新掛載觸發重抓」，不是「清除快取」本身，是一個無效測試。我上一輪的建議是錯的，在此更正。

修法：把 2025 年**第一次**請求改回 200（`buildHolidayYearBody(2025)`，成為 `available`），讓它在後續重新掛載時因為 `isFresh` 而被跳過，不會再自然觸發請求；只有明確呼叫 `clearCache()` 才會讓快取變回 miss，觸發第 2 次請求。額外加一段「清除前先做一次『設定 → 首頁』來回，用計數器 + 寬限時間斷言請求次數仍是 1」的正向對照，直接證明第 2 次請求的成因是「清除」而不是「重新掛載」。計數器只計 2025 年（`if (year !== 2025) return { status: 404 }`），避免掛載時 2024／2025／2026 三個年度同時發出請求造成「第幾次呼叫」的歧義（比照測試 14、15 的既有寫法）。見 §4.12 測試 10。

### 0.2（issue 2）測試 10、11 的前置條件仍不足，§4.8 情境 2 的推論不正確

接受，三個子項：

**(a)** 測試 10 想在「已 seed 滿足 milestone 的 `onboardDate`」情境裡，同時斷言「快取為空物件時 disabled」——但這兩者互斥：只要 seed 了會產生至少一個 period 的 `onboardDate`，`page.goto('/')` 進首頁的當下 `MainPage` 就掛載、coverage effect 立刻對該年度呼叫 `ensureYear`，使用者/測試根本來不及在「holidayCache 仍是 `{}`」的狀態下切到設定頁觀察。修法：把「快取為空時 disabled」的斷言**移到測試 11**（完全不 seed `onboardDate` 直接進設定頁），測試 10 一律從「已經進過首頁、holidayCache 已有至少一筆紀錄」的狀態開始。

**(b)** 已用 `grep`／`sed` 對照 `src/utils/leaveCalculations.js:430-433` 確認：

```js
const chainMilestones = milestones.filter(m => m <= completedMonths);
if (chainMilestones.length === 0) return [];
```

`calculateSummary` 的 `periods` 直接來自這條 `ledger`（`chainMilestones` 驅動）。當 `onboardDate` 距 `today` 不滿第一個 milestone（勞基法預設門檻 6 個月）時，`chainMilestones` 是空陣列，`periods` 因此是 `[]`，`MainPage.jsx` 的 `neededYears`（依 `periods` 算出）也是空集合，coverage effect 不會對任何年度呼叫 `ensureYear`，`holidayCache` 維持 `{}`。所以 §4.8 原文「只要有到職日，coverage effect 至少會對一個年度呼叫 `ensureYear`」不成立——真正條件是**到職滿 6 個月（至少有一個 period）且進過首頁**。修法：改寫 §4.8 情境 2 的條件敘述，並把它套進測試 11。（已額外確認 `App.jsx` 的 `loadSettings()` 只在使用者透過設定頁存檔時才寫入 localStorage，`App` 掛載時不會自動把 `DEFAULT_SETTINGS` 寫回 storage，所以「完全不 seed」的情境下 `hasAnyAppData()` 一開始確實是 `false`，(a) 的修法成立。）

**(c)** 測試 11 原文只寫「同 §4.8 三個驗證情境」，依 §0.3 規範必須寫出具體步驟。已對照 `Settings.jsx` 現有離職彈窗流程（`resignStep`：`null → 'confirm' → 'settlement'`，確認按鈕文字「確定清空」、取消「取消」）與 `App.jsx:51-58` 的 `handleResign`（`clearAll()` + 重設 `settings`/`records` + `setPage('main')`），依 reviewer 給的具體步驟重寫，並把「『清除所有本機資料』確認後落在 EmptyState」單獨列成明確斷言（原文只是隱含在描述裡，沒有真的寫出來）。見 §4.8、§4.12 測試 11。

### 0.3（issue 3）§7 引用的補班斷言不存在，`buildHolidayYearBody` 的 docstring 與實作不符

接受，採用 reviewer 給的選項 (1)：幫 `buildHolidayYearBody` 加 `excludeIsoDates` 參數，並在測試 1 補上具體的補班週六斷言，而不是只把 §7 的引用文字改成間接驗證。

**理由**：§3.7「明確接受的樣式結果」把「補班的週六不加 `--holiday`、維持原生 `--weekend` 灰色 `#6b7280`」列為這個功能對外可見的樣式行為之一，不是內部實作細節。這類「畫面上到底顯示什麼顏色」的結果，只靠 `isNonWorkingDay` 的單元測試（邏輯層）加上 CSS 特異性分析（靜態文字論證）沒辦法真正防止未來的視覺回歸——例如日後有人把 `tileClassName` 的判斷條件寫反，單元測試與特異性分析都不會抓到，只有 e2e 對實際渲染出的顏色斷言會抓到。而補上這個能力的成本很低（`buildHolidayYearBody` 內部本來就是一個迴圈塞週六日，加一個排除清單只是多一個 `if`），比起把驗收條件的引用文字改成間接論證，直接加斷言更符合這份計畫一貫「e2e 覆蓋所有使用者可見狀態」的做法（§4.11、§4.12 其他每一項都是為了驗證 viewport 可見行為而不是只驗證邏輯）。

同時修正 docstring：舊版寫「makeup workdays flip via omission」但函式沒有任何參數可以真的省略某個週末，這次補上實際的 `excludeIsoDates` 參數，讓 docstring 與實作一致。見 §4.11、§4.12 測試 1、§7。

---

## 1. 背景與目標（沿用，完整重列）

`getLeaveRecordDates` 目前只跳過週六日，不考慮國定假日與彈性放假，導致：視覺層月曆無假日標示；邏輯層（#48 核心）跨連假的多天請假記錄圓點誤標在不用上班的日子。本功能同時解決兩層問題（連動 #34），**不影響特休餘額計算**——`getLeaveTakenInPeriod` 直接對 `r.days` 加總，不呼叫 `getLeaveRecordDates`，兩者是獨立路徑。

## 2. 資料源與五態模型（沿用，完整重列）

### 2.1 資料源

- **ruyut/TaiwanCalendar**，經 jsDelivr CDN：`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json`。純前端 client-side fetch，不引入後端。CORS 已由維護者實測可用。
- `date` 欄位是無橫線的 `YYYYMMDD`，需轉成 `YYYY-MM-DD`。
- `isHoliday` 涵蓋週六日、國定假日與補假，**不是只有國定假日**（實測 2027 年資料每個週六日都是 `true`）。有資料的年度以 `isHoliday` 為唯一真相來源；只有沒資料的年度才 fallback 成「週六日視為非工作日」。這一點直接影響 e2e mock 資料的設計（見 §4.11：mock body 必須包含週末，否則不是真實資料形狀的模擬）。

### 2.2 README 授權文案（逐字使用、明確為「取代」）

`README.md` 現有「## 授權」章節（實測 L142）目前只有一句「本專案以 [MIT 授權](LICENSE.txt) 釋出。」。本次**用以下兩段文字完整取代這一句**（不是插入在其前面、也不是兩句並存），逐字比對概念計畫原文，**不加任何額外空格**：

```
行事曆中的國定假日標示，資料引用自公開 GitHub 專案 [ruyut/TaiwanCalendar](https://github.com/ruyut/TaiwanCalendar)，其原始資料源自[政府資料開放平臺](https://data.gov.tw/)之「中華民國政府行政機關辦公日曆表」，依創用 CC 姓名標示 4.0 國際版本（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）提供。

本專案程式碼以 [MIT 授權](LICENSE.txt)釋出。
```

注意第二段是「本專案**程式碼**以」而非既有句子的「本專案以」，且「`)釋出`」之間沒有空格——這是概念計畫指定的逐字文案，直接取代既有句子，不依既有風格加空格。

### 2.3 五態模型與 `ensureYear` 規則

| 狀態 | 判斷依據 | 自動重抓時機 | 手動介入 |
|---|---|---|---|
| `available` | fetch 成功取得資料 | 不重抓（永久快取，見 §2.4） | 無 |
| `loading` | 請求進行中（含 `error` 的自動重試期間） | 不適用 | 無需 |
| `pending` | 404，且年度 `>= currentYear` | MainPage 每次掛載、每日心跳 | 可用 Settings「清除國定假日快取」強制重抓 |
| `unavailable` | 404，且年度 `< currentYear` | 不重抓（永久快取） | 同上 |
| `error` | 非 404 的失敗（網路錯誤、非 2xx、JSON 解析失敗） | 抓取層內先自動重試：立刻、2 秒後、5 秒後，共 3 次；之後在 MainPage 每次掛載、每日心跳也會重抓 | 「點此重試」按鈕 |

`ensureYear(year)` 規則：

- **只有**快取中該年度為 `available` 或 `unavailable`、且 `cacheVersion` 相符時才略過。其他情況（沒有紀錄、`pending`、`error`）一律重抓——**這一條是本輪 issue 1 修法的關鍵依據**：`pending` 年度只要 MainPage 重新掛載就會重抓，跟「有沒有點清除按鈕」無關。
- 發出請求前先把該年度設為 `loading`，讓手動重試與每日重試都有即時視覺回饋。
- 用 in-flight guard（`Set`）避免同一年度重複發請求；coverage effect 與每日心跳 effect 掛載時同時觸發，要靠它擋掉重複請求。
- 判斷是否略過、是否在飛行中時讀 `cacheRef`／`inFlightRef`，不讀 closure 裡的 state，否則清除快取後同一次 render 內仍會看到舊值。
- **世代計數**：`clearCache()` 將世代加一；請求發出時記下當下世代，resolve 時若世代已過期就直接放棄（不寫 state、不寫 localStorage、也不動 in-flight guard——`clearCache()` 已整批清空 guard，由新請求接手）。
- 404 分類採 `year >= currentYear` 為 `pending`，給資料源維護者一年緩衝；一個年度若拖過緩衝期仍未公布，下次重抓時自動改判為 `unavailable`，不需要另寫「重試 N 次就放棄」的邏輯。
- **`error` 的自我修復**：`error` 會在 MainPage 重新掛載與每日心跳時自動重抓，成本低且能自我修復；但文案**刻意不加「暫時」**，因為使用者停留在畫面上時它不會自己好轉（跟 `loading`／`pending`／`unavailable` 的措辭邏輯不同）。

### 2.4 快取持久化

- localStorage key：`leaveCalculator_holidayCache_{year}`，每筆紀錄帶 `cacheVersion`（對應 `HOLIDAY_CACHE_VERSION`，初始為 `1`）。
- **只持久化 `available` 與 `unavailable`**；`loading`、`pending`、`error` 只存在記憶體——`pending`／`error` 本來就要在每次掛載時重新確認，持久化反而會讓下次開站時被誤當成已確定的結果。
- `available` 的日期以陣列儲存，讀取時轉回 `Set`。
- App 掛載時用 `useState` lazy initializer 從 localStorage 載入一次（hydrate）；版本不符或損毀的紀錄直接略過，視為沒抓過。
- **所有 localStorage 存取都要防護**（瀏覽器封鎖網站資料時連存取本身都會丟 `SecurityError`）：hydrate 外層 try/catch 失敗回傳 `{}`；寫入、清除失敗時靜默放棄；`hasAnyAppData()` 失敗回傳 `false`。目標是這種環境下 App 與 Settings 頁仍能正常渲染，只是無法持久化。既有 `clearAll()` 沒有 try/catch，屬既有行為，本輪不改。
- **`available` 永久快取，不做背景再驗證**——已公布年度的辦公日曆表事後被修改的情況很罕見，多一條「有資料但可能過期」的狀態路徑並不划算。
  - **已知風險**：2025 年曾因修法新增國定假日，人事總處重新公告當年度的辦公日曆表；在修正前就快取該年度的使用者不會自動取得新資料。
  - **因應方式**：維護者將 `HOLIDAY_CACHE_VERSION` 加一並重新部署，所有使用者下次開站自動重抓；使用者也可自行用 Settings「清除國定假日快取」。這項維護程序寫進 `CONTRIBUTING.md`（見 §4.13）。

### 2.5 UI 文案與顏色表（全形標點）

| 狀態 | 文案 | 文字顏色 |
|---|---|---|
| `available` | 國定假日資料已載入，圓點已跳過所有國定休假 | `text-stone-400` |
| `loading` | 國定假日資料載入中，圓點暫時只跳過週六日 | `text-stone-400` |
| `pending` | 國定假日資料尚未公布，圓點暫時只跳過週六日 | `text-stone-400` |
| `unavailable` | 無國定假日資料來源，圓點只跳過週六日 | `text-stone-400` |
| `error` | 國定假日資料載入失敗，圓點只跳過週六日（點此重試） | `text-red-600` |

只有 `error` 用紅色，因為它是唯一需要使用者採取行動的狀態。

## 3. 架構變更總覽（沿用，完整重列）

`useHolidayCache()` 在 `App.jsx` 呼叫一次。**理由**：`App.jsx` 目前 `page === 'main' ? <MainPage/> : <Settings/>` 三元互斥渲染，切換 `page` 會讓非目前分支的元件整個卸載重掛載；hook 放在 `App.jsx` 才能讓 Settings 頁拿到同一份快取狀態，且不會因為切頁而重置 in-flight guard／世代計數。往下傳給 `MainPage`：`holidayCache`、`ensureYear`；往下傳給 `Settings`：`holidayCache`、`onClearHolidayCache`、`onClearAllData`。

`neededYearsKey` coverage effect 留在 `MainPage.jsx`（依賴 `periods`，不必在 `App.jsx` 重算）。

`useHolidayCache` 內部有 `generationRef` 世代計數：`clearCache()` 遞增世代、任何「世代已過期」的 in-flight fetch 在 resolve 時直接放棄寫入。「清除國定假日快取」不導頁，停留在 Settings；「清除所有本機資料」比照既有 `handleResign`（已對照 `App.jsx:51-58` 確認：`clearAll()` → 重設 `settings`/`records` → `setPage('main')`）模式，清空後 `setPage('main')`。

**已查證的頁面導覽拓樸**：Header「設定」／「首頁」`NavButton` 永遠可見；`MainPage`（`MainPage.jsx:46` 起）第一個 early return（尚未設定到職日）有「前往設定」按鈕；`Settings`「取消」按鈕只在 `!isLocked` 時顯示；`Settings` 現有的離職確認彈窗用本地 `Modal` 元件，兩步驟（`resignStep`：`null → 'confirm' → 'settlement'`），確認按鈕文字是「確定清空」，取消按鈕文字是「取消」；清空動作最終落在 `MainPage` 的 `EmptyState`（`!settings.onboardDate` 分支）。這個拓樸貫穿 §4.4、§4.8、§4.12 的設計。

## 4. 各檔案詳細設計

### 4.1 `src/utils/holidayCache.js`（沿用，未再變動）

```js
export const HOLIDAY_CACHE_VERSION = 1
const KEY_PREFIX = 'leaveCalculator_holidayCache_'
const keyFor = (year) => `${KEY_PREFIX}${year}`
const RETRY_DELAYS_MS = [0, 2000, 5000]

export async function fetchHolidayYear(
  year,
  { currentYear = new Date().getFullYear(), fetchImpl = fetch, sleep = defaultSleep } = {}
) {
  let lastError
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt])
    try {
      const res = await fetchImpl(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`)
      if (res.status === 404) {
        return year >= currentYear ? { status: 'pending' } : { status: 'unavailable' }
      }
      if (!res.ok) throw new Error(`Unexpected status ${res.status}`)
      const json = await res.json()
      return { status: 'available', dates: toHolidayDateSet(json) }
    } catch (err) {
      lastError = err
    }
  }
  return { status: 'error', error: lastError }
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toHolidayDateSet(json) {
  const dates = new Set()
  for (const entry of json) {
    if (!entry.isHoliday) continue
    const s = entry.date
    dates.add(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
  }
  return dates
}

export function persistHolidayYear(year, entry) {
  try {
    const payload = {
      cacheVersion: entry.cacheVersion,
      status: entry.status,
      ...(entry.status === 'available' ? { dates: [...entry.dates] } : {}),
    }
    localStorage.setItem(keyFor(year), JSON.stringify(payload))
  } catch {
    // 寫入失敗:靜默降級,本次 session 仍以記憶體結果呈現
  }
}

export function hydrateHolidayCache() {
  const result = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(KEY_PREFIX)) continue
      const year = Number(key.slice(KEY_PREFIX.length))
      if (!Number.isInteger(year)) continue
      try {
        const parsed = JSON.parse(localStorage.getItem(key))
        if (parsed.cacheVersion !== HOLIDAY_CACHE_VERSION) continue
        // status 必須是 available/unavailable 之一,且 available 時 dates 必須
        // 是陣列,否則視為損毀跳過 -- 否則會被還原成空 Set 且因判定為 available
        // (fresh)永遠不會重抓,是唯一沒有自我修復路徑的壞狀態。
        if (parsed.status !== 'available' && parsed.status !== 'unavailable') continue
        if (parsed.status === 'available' && !Array.isArray(parsed.dates)) continue
        result[year] = {
          cacheVersion: parsed.cacheVersion,
          status: parsed.status,
          ...(parsed.status === 'available' ? { dates: new Set(parsed.dates) } : {}),
        }
      } catch {
        // 損毀的紀錄直接跳過
      }
    }
  } catch {
    return {}
  }
  return result
}

export function clearHolidayCacheFromStorage() {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(KEY_PREFIX)) keysToRemove.push(key)
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
  } catch {
    // localStorage 整體不可用:沒有東西好清的,靜默放棄
  }
}
```

### 4.2 `src/hooks/useHolidayCache.js`（沿用，未再變動）

```js
import { useCallback, useRef, useState } from 'react'
import {
  HOLIDAY_CACHE_VERSION, fetchHolidayYear, persistHolidayYear,
  hydrateHolidayCache, clearHolidayCacheFromStorage,
} from '../utils/holidayCache.js'

export function useHolidayCache() {
  const [cache, setCache] = useState(() => hydrateHolidayCache())
  const cacheRef = useRef(cache)
  const inFlightRef = useRef(new Set())
  const generationRef = useRef(0)

  const ensureYear = useCallback((year) => {
    const current = cacheRef.current[year]
    const isFresh =
      current && current.cacheVersion === HOLIDAY_CACHE_VERSION &&
      (current.status === 'available' || current.status === 'unavailable')
    if (isFresh) return
    if (inFlightRef.current.has(year)) return

    inFlightRef.current.add(year)
    const gen = generationRef.current

    cacheRef.current = { ...cacheRef.current, [year]: { status: 'loading' } }
    setCache(cacheRef.current)

    fetchHolidayYear(year).then((result) => {
      if (gen !== generationRef.current) return
      const entry = { ...result, cacheVersion: HOLIDAY_CACHE_VERSION }
      cacheRef.current = { ...cacheRef.current, [year]: entry }
      setCache(cacheRef.current)
      inFlightRef.current.delete(year)
      if (entry.status === 'available' || entry.status === 'unavailable') {
        persistHolidayYear(year, entry)
      }
    })
  }, [])

  const clearCache = useCallback(() => {
    generationRef.current += 1
    clearHolidayCacheFromStorage()
    cacheRef.current = {}
    inFlightRef.current.clear()
    setCache({})
  }, [])

  return { cache, ensureYear, clearCache }
}
```

### 4.3 `src/utils/leaveCalculations.js`（沿用，未再變動）

```js
export function getDefaultVisibleMonth(periodStart, periodEnd, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const base = t >= periodStart && t <= periodEnd ? t : periodStart
  return new Date(base.getFullYear(), base.getMonth(), 1)
}

export function getLeaveRecordDates(startDate, days, isNonWorkingDay = defaultWeekendCheck) {
  const start = parseLocalDate(startDate)
  const cursor = new Date(start)
  const dates = []
  let remaining = Number(days)
  if (!Number.isFinite(remaining)) return dates
  while (remaining > 0 && dates.length < MAX_LEAVE_RECORD_DATES) {
    if (!isNonWorkingDay(cursor)) {
      dates.push(toISODateString(cursor))
      remaining -= 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function defaultWeekendCheck(date) {
  return date.getDay() === 0 || date.getDay() === 6
}

export function makeIsNonWorkingDay(holidayCache) {
  return function isNonWorkingDay(date) {
    const entry = holidayCache[date.getFullYear()]
    if (entry?.status === 'available') return entry.dates.has(toISODateString(date))
    return date.getDay() === 0 || date.getDay() === 6
  }
}
```

第三參數預設值維持向後相容。`makeIsNonWorkingDay` 產生的**同一個**實例要同時餵給 `getLeaveRecordDates`（圓點展延）與 `tileClassName`（視覺標紅），確保兩處判斷永遠一致。**已知邊界，本輪不處理**：多天請假展開可能推到超出 `periodEnd`，react-calendar 不渲染範圍外 tile，最壞結果只是圓點尾端被截斷。

### 4.4 `src/App.jsx`（沿用，未再變動）

```js
const { cache: holidayCache, ensureYear, clearCache } = useHolidayCache()

const handleClearAllData = useCallback(() => {
  clearAll()
  clearCache()
  setSettings({ ...DEFAULT_SETTINGS, customRules: [] })
  setRecords([])
  setPage('main')
}, [clearCache])
```

`<MainPage>` 新增 props：`holidayCache`、`ensureYear`。`<Settings>` 新增 props：`holidayCache`、`onClearHolidayCache={clearCache}`、`onClearAllData={handleClearAllData}`。「清除所有本機資料」清空後導回首頁（`onboardDate` 變空字串，`MainPage` 渲染 `EmptyState`）；「清除國定假日快取」不導頁，停留在 Settings。

### 4.5 `src/components/MainPage.jsx`（沿用，未再變動）

新增 props：`holidayCache`、`ensureYear`。Hooks 插入順序（早於兩個既有 early return）：

```js
const today = useToday()
const summary = useMemo(() => calculateSummary(settings, records, today), [settings, records, today])
const periods = summary.periods ?? []

const neededYears = useMemo(() => computeNeededYears(periods), [periods])
const neededYearsKey = [...neededYears].sort().join(',')

const isNonWorkingDay = useMemo(() => makeIsNonWorkingDay(holidayCache), [holidayCache])

const [selectedMilestone, setSelectedMilestone] = useState(null)
const [selectedDate, setSelectedDate] = useState(null)
const [editingRecord, setEditingRecord] = useState(null)
const [visibleMonth, setVisibleMonth] = useState(null)

useEffect(() => {
  if (selectedMilestone == null && periods.length > 0) {
    setSelectedMilestone(periods[periods.length - 1].milestoneMonths)
  }
}, [periods, selectedMilestone])

useEffect(() => {
  if (!settings.onboardDate) {
    setSelectedMilestone(null)
    setVisibleMonth(null)
  }
}, [settings.onboardDate])

useEffect(() => {
  neededYears.forEach((year) => ensureYear(year))
}, [neededYearsKey])

useEffect(() => {
  neededYears.forEach((year) => ensureYear(year))
}, [today])

// ── early return #1/#2 從這裡開始,不變 ──
// #1(MainPage.jsx:46): !settings.onboardDate -> EmptyState「前往設定」

function computeNeededYears(periods) {
  const years = new Set()
  periods.forEach((p) => {
    years.add(p.periodStart.getFullYear())
    years.add(p.periodEnd.getFullYear())
  })
  return years
}
```

**重要（本輪 issue 2b 已核實的邊界）**：`periods` 來自 `calculateSummary`→`chainMilestones`（`leaveCalculations.js:430-433`），到職未滿第一個 milestone（勞基法預設 6 個月）時 `chainMilestones` 為空、`periods` 為 `[]`，`neededYears` 也是空集合，兩個 effect 都不會呼叫 `ensureYear`——這代表「有到職日」不等於「holidayCache 會有資料」，見 §4.8 情境 2 的修正描述。

`handleSelectPeriod` 新增 `setVisibleMonth(null)`；`activePeriod`／`visibleYear`（早 return 之後）：

```js
const activePeriod =
  periods.find((p) => p.milestoneMonths === selectedMilestone) ?? periods[periods.length - 1]

const visibleYear = (
  visibleMonth ?? getDefaultVisibleMonth(activePeriod.periodStart, activePeriod.periodEnd, today)
).getFullYear()
```

`calendar-holiday-note`（全形標點）：

```jsx
const status = holidayCache[visibleYear]?.status ?? 'loading'
const NOTE_TEXT = {
  available: '國定假日資料已載入，圓點已跳過所有國定休假',
  loading: '國定假日資料載入中，圓點暫時只跳過週六日',
  pending: '國定假日資料尚未公布，圓點暫時只跳過週六日',
  unavailable: '無國定假日資料來源，圓點只跳過週六日',
  error: '國定假日資料載入失敗，圓點只跳過週六日',
}

<p data-testid="calendar-holiday-note"
   className={status === 'error' ? 'text-xs text-red-600' : 'text-xs text-stone-400'}>
  {NOTE_TEXT[status]}
  {status === 'error' && (
    <>
      （<button type="button" className="underline" onClick={() => ensureYear(visibleYear)}>點此重試</button>）
    </>
  )}
</p>
```

`<LeaveCalendar>` 旁的既有註解需重寫，說明兩件事：`key` 重新掛載重置的是月曆本身、不是 `visibleMonth`；重新掛載後的月曆會透過自己的掛載 effect 回報新的 `initialMonth`，`handleSelectPeriod`／清空到職日 effect 裡的 `setVisibleMonth(null)` 只是保險，覆蓋 `key` 改變到新實例掛載 effect 觸發之間的那一個 render。

### 4.6 `src/components/LeaveCalendar.jsx`（沿用，保留既有 JSDoc／inline 註解密度）

```jsx
import { useState, useEffect } from 'react'
import Calendar from 'react-calendar'
import { parseLocalDate, toISODateString, getLeaveRecordDates, getDefaultVisibleMonth } from '../utils/leaveCalculations.js'

export default function LeaveCalendar({
  periodStart, periodEnd, today, records, selectedDate,
  isNonWorkingDay, onDateClick, onVisibleMonthChange,
}) {
  const leaveDates = new Set(
    records.flatMap((r) => getLeaveRecordDates(r.startDate, r.days, isNonWorkingDay))
  )
  const selectedDateObj = selectedDate ? parseLocalDate(selectedDate) : null

  const [initialMonth] = useState(() => getDefaultVisibleMonth(periodStart, periodEnd, today))
  useEffect(() => {
    onVisibleMonthChange?.(initialMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once, at mount, using the frozen initialMonth
  }, [])

  function handleChange(date) {
    if (date >= periodStart && date <= periodEnd) onDateClick(date)
  }

  function tileContent({ date, view }) {
    if (view !== 'month') return null
    const iso = toISODateString(date)
    if (leaveDates.has(iso)) {
      return (
        <>
          <span className="leave-dot" aria-hidden="true" />
          <span className="sr-only">已登記請假</span>
        </>
      )
    }
    return null
  }

  function tileDisabled({ date, view }) {
    if (view !== 'month') return false
    return date < periodStart || date > periodEnd
  }

  function tileClassName({ date, view }) {
    if (view !== 'month') return null
    const classes = []
    if (date < periodStart || date > periodEnd) classes.push('react-calendar__tile--out-of-period')
    if (isNonWorkingDay(date)) classes.push('react-calendar__tile--holiday')
    return classes.length > 0 ? classes.join(' ') : null
  }

  return (
    <Calendar
      onChange={handleChange}
      value={selectedDateObj}
      tileContent={tileContent}
      tileDisabled={tileDisabled}
      tileClassName={tileClassName}
      minDate={periodStart}
      maxDate={periodEnd}
      minDetail="month"
      defaultActiveStartDate={initialMonth}
      onActiveStartDateChange={({ activeStartDate }) => onVisibleMonthChange?.(activeStartDate)}
      locale="zh-TW"
      calendarType="gregory"
      showNeighboringMonth={false}
    />
  )
}
```

**實作提醒**：上面是示意程式碼，實作時要保留 `LeaveCalendar.jsx` 既有的 JSDoc 與 inline 註解（例如原本描述「Start from the month that contains today (or period start)」的那一句），並把它改寫成描述**凍結後**的 `initialMonth` 行為，而不是直接刪除或整段覆蓋——維持既有的註解密度是這個檔案的慣例。

`minDetail="month"` 禁止鑽到年/年代檢視。是否套用 `--holiday` class 直接呼叫 `isNonWorkingDay(date)`，不看 react-calendar 原生 `--weekend` class，確保補班的週六不會被誤標。

### 4.7 `src/index.css`（沿用，未再變動）

已用 `grep -n` 對照確認：既有規則順序是 `--tile--now`（L108）→ `--tile--out-of-period`（L126）→ `--weekend`（L146）→ `--neighboringMonth`（L150），`--out-of-period` 目前確實寫在 `--weekend` 之前，同為單一 class 特異性 (0,1,0) 時後寫的規則勝出，所以期間外的週末目前錯誤顯示 `--weekend` 的 `#6b7280`。

**變動一**：把 `.react-calendar__tile--out-of-period` 規則從 `--weekend` 規則之前移到之後（`--neighboringMonth` 規則旁），修正這個既有瑕疵。已檢查不影響其他規則：假日規則靠 `:not(--out-of-period)` 排除期間外；期間外 tile 是 disabled 不會成為 `--active`；`--now` 規則本來就在更前面（L108）。

**變動二**：假日樣式規則組：

```css
.leave-dot {
  position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);
  width: 5px; height: 5px; border-radius: 50%; background: #0f766e;
}
.react-calendar__tile--active .leave-dot { background: white; }

.react-calendar__month-view__days__day--weekend { color: #6b7280; }
.react-calendar__month-view__days__day--neighboringMonth { color: #d1d5db; }

/* 移到 weekend 規則之後,贏過同特異性 (0,1,0) 的 source-order 對決 */
.react-calendar__tile--out-of-period { color: #d1d5db; }

/* 假日不是第二個圓點,而是日期數字本身變暗紅。是否套用由 isNonWorkingDay(date)
   決定,不依賴原生 --weekend,所以補班週六不會拿到這個 class,維持 #6b7280。 */
.react-calendar__tile--holiday:not(.react-calendar__tile--out-of-period) {
  color: #9f1239;
}

/* 未選取假日 hover/focus (0,4,0):蓋過通用 tile:enabled:hover/:focus (0,3,0)
   會設的 teal color #0f766e。 */
.react-calendar__tile--holiday:not(.react-calendar__tile--out-of-period):enabled:hover,
.react-calendar__tile--holiday:not(.react-calendar__tile--out-of-period):enabled:focus {
  color: #9f1239;
}

/* 選取中假日:背景暗紅、文字白色。 */
.react-calendar__tile--active.react-calendar__tile--holiday {
  background: #9f1239 !important;
  color: white !important;
}

/* 選取中假日 hover/focus (0,4,0) + !important:蓋過既有 --active:enabled:hover/
   :focus (0,3,0) + !important 會設的 teal 背景 #0d9488,否則點擊後 focus 保持時
   背景會變回 teal。 */
.react-calendar__tile--active.react-calendar__tile--holiday:enabled:hover,
.react-calendar__tile--active.react-calendar__tile--holiday:enabled:focus {
  background: #9f1239 !important;
}

/* 今天恰好是假日:--now (0,1,0) 同時設 background/font-weight/color;上面 (0,2,0)
   的假日規則只蓋過 color,不動 background/font-weight,兩者可並存,不需額外規則。 */
```

**明確接受的樣式結果**：補班的週六不加 `--holiday`，維持原生 `--weekend` 的 `#6b7280`（本輪起由 e2e 測試 1 直接斷言，見 §4.12、§7，回應 issue 3）；未選取的假日在 hover/focus 時文字維持暗紅（e2e 測試 1）；今天恰好是假日時暗紅文字蓋過 `--now` 的 teal，淺色底與粗體保留。

### 4.8 `src/components/Settings.jsx`（本輪修正情境 2 的推論錯誤，回應 issue 2b）

新增 props：`holidayCache`、`onClearHolidayCache`、`onClearAllData`。沿用既有本地 `Modal` 元件，新增 `dataActionStep` state（`null`／`'clearHoliday'`／`'clearAll'`）。

**disabled 判斷（偏離 v1 以 localStorage 為準的定義，已標註）**：

```js
const hasHolidayCache = Object.keys(holidayCache).length > 0
const canClearHolidayCacheOnly = hasHolidayCache
const canClearAllData = hasAnyAppData() || hasHolidayCache
```

**偏離理由**：概念計畫承諾「`pending` 可用 Settings 全域清除快取強制立即重試」；若嚴格只看 localStorage（只有 `available`／`unavailable` 會持久化），一個「只快取到 `pending` 年度」的狀態下按鈕會是 disabled，承諾就變成空話。因此只要記憶體 `cache` 裡有任何一筆紀錄（不論 status）就視為「有得清」，每次 render 內聯計算，天然滿足「清除後立即重新評估」。

**三個驗證情境（本輪修正情境 2 的推論，回應 issue 2b；已對照 `leaveCalculations.js:430-433` 核實）**：

1. 首次使用、尚無到職日 → `MainPage` 走第一個 early return，coverage effect 從未被觸發，`holidayCache` 是空物件 → 兩顆按鈕都 disabled。
2. **（本輪修正）到職滿 6 個月（至少有一個 period）且曾進過首頁** → `periods` 非空、`neededYears` 至少有一個年度，coverage effect 至少對一個年度呼叫 `ensureYear`、寫入至少一筆任意 status → 兩顆都 enabled。**修正說明**：原文「只要有到職日」不成立——`calculateSummary` 的 `chainMilestones = milestones.filter(m => m <= completedMonths)`（`leaveCalculations.js:432`）在到職未滿第一個 milestone（勞基法預設 6 個月）時為空陣列，`periods` 因此是 `[]`，不會呼叫 `ensureYear`；這種情況下兩顆按鈕其實維持跟情境 1 一樣的 disabled 狀態，只是 `hasAnyAppData()` 尚未變 `true`（因為使用者還沒存過設定）。
3. 離職後（`clearAll()` 清空 settings/records）再手動清除國定假日快取（`clearCache()` 清空記憶體 cache）→ 兩顆都 disabled（`hasAnyAppData()` 因 settings/records 已清空回傳 `false`，`hasHolidayCache` 因 cache 已清空回傳 `false`）。

**兩顆按鈕與確認彈窗**（全形標點，按鈕文字比照既有離職彈窗「確定清空」／「取消」）：

```jsx
<button type="button" disabled={!canClearHolidayCacheOnly} onClick={() => setDataActionStep('clearHoliday')}>
  清除國定假日快取
</button>
<button type="button" disabled={!canClearAllData} onClick={() => setDataActionStep('clearAll')}>
  清除所有本機資料
</button>
```

「清除國定假日快取」彈窗文案「將清除國定假日快取，未來使用時將觸發重新下載」；「清除所有本機資料」彈窗文案「將清空所有資料，請自行備份重要資訊」。

```js
function handleClearHolidayCache() {
  onClearHolidayCache()
  setDataActionStep(null)
}
function handleClearAllData() {
  onClearAllData()
  setDataActionStep(null)
}
```

**離職彈窗**：「應結清工資天數」卡片新增第二行：

```jsx
<p className="text-xs text-stone-400">
  （不含瀏覽器暫存的國定假日資料；如需一併清除請至設定頁「清除所有本機資料」）
</p>
```

`handleConfirmResign`（呼叫既有 `onResign()`）不改動——`clearAll()` 只清 `settings`／`records`，假日快取 key 前綴不同、不受影響。

### 4.9 `src/utils/storage.js`（沿用，未再變動）

```js
export function hasAnyAppData() {
  try {
    return localStorage.getItem(KEYS.settings) !== null || localStorage.getItem(KEYS.records) !== null
  } catch {
    return false
  }
}
```

`storage.test.js` 頂層加 `afterEach(() => vi.restoreAllMocks())`。既有 `clearAll()`（`storage.js:86-89` 附近）本身沒有 try/catch，屬既有行為，本輪不改。已對照 `storage.js` 確認 `saveSettings` 只在 `App.jsx` 的 `handleSaveSettings`（使用者實際存檔時）被呼叫，`App` 掛載時不會自動把 `DEFAULT_SETTINGS` 寫回 localStorage——這是 §4.8 情境 1、測試 11 情境 A「完全不 seed 時兩顆按鈕皆 disabled」成立的前提。

### 4.10 `README.md`

見 §2.2。實作時直接把 `README.md`（既有「## 授權」章節下那一句，實測位於 L142）的既有句子替換成 §2.2 給出的兩段文字，不是插入在其前面、也不是兩句並存。

### 4.11 `e2e/helpers.js` ＋ 既有 spec 異動（本輪為 `buildHolidayYearBody` 新增 `excludeIsoDates` 參數，回應 issue 3）

```js
const HOLIDAY_CDN_PATTERN = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/*.json'

/**
 * Intercept every TaiwanCalendar CDN request for the test's lifetime. Call
 * BEFORE page.goto() (right after freezeTime()).
 *
 * `handler` may be async / return a Promise that resolves late, enabling
 * delayed-response tests. It may also be a stateful closure (call counter,
 * or an outer `let` the test flips) to simulate "fails then succeeds on
 * retry" or "first vs. second request for the same year returns different
 * bodies".
 * Default (handler omitted): every year -> 404, classifying as
 * pending/unavailable -- the quietest baseline for specs that don't care
 * about holidays. Deliberately NOT route.abort() by default, which would
 * classify as error (red note text) instead.
 *
 * Not an auto fixture -- every future spec that renders MainPage must call
 * this itself, right after freezeTime(), or it will hit the real CDN. There
 * is no autouse fixture wiring this in; if a new spec forgets, its test will
 * make a live network request in CI.
 */
export async function mockHolidayCdn(page, handler = () => ({ status: 404 })) {
  await page.route(HOLIDAY_CDN_PATTERN, async (route) => {
    const year = Number(new URL(route.request().url()).pathname.match(/(\d{4})\.json$/)?.[1])
    const result = await handler(year)
    if (result === 'abort') {
      await route.abort()
    } else if (result.status === 200) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result.body) })
    } else {
      await route.fulfill({ status: result.status ?? 404, body: '' })
    }
  })
}

/**
 * Build a realistic TaiwanCalendar year body: every Saturday/Sunday in
 * `year` marked isHoliday, plus any extra ISO dates (weekday national
 * holidays / makeup workdays) layered on top. Real API data marks isHoliday
 * on weekends too (see §2.1) -- tests that only listed one weekday date were
 * silently missing this and could get wrong dot-extension results whenever a
 * leave record crossed a real weekend.
 *
 * `excludeIsoDates`: weekends to OMIT from the generated body (e.g. a
 * makeup workday Saturday, 補班). The real API represents a makeup workday
 * as that date simply not being isHoliday; since toHolidayDateSet() only
 * reads entries where isHoliday is true, omitting the entry has the same
 * parsed effect as an explicit isHoliday:false entry, so this stays a plain
 * omission rather than pushing a redundant entry.
 */
export function buildHolidayYearBody(year, extraHolidayIsoDates = [], excludeIsoDates = []) {
  const excluded = new Set(excludeIsoDates)
  const entries = []
  const cursor = new Date(year, 0, 1)
  while (cursor.getFullYear() === year) {
    if (cursor.getDay() === 0 || cursor.getDay() === 6) {
      const iso = toISODateStringLocal(cursor)
      if (!excluded.has(iso)) entries.push({ date: toYYYYMMDD(cursor), isHoliday: true })
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  extraHolidayIsoDates.forEach((iso) => {
    entries.push({ date: iso.replaceAll('-', ''), isHoliday: true })
  })
  return entries
}

function toYYYYMMDD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function toISODateStringLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

**需要補上 `mockHolidayCdn(page)` 這一行的既有 spec**（`freezeTime` 之後加一行）：`calendar-and-records`、`carryover`、`period-tabs`、`onboarding-and-settings`、`resignation`、`footer`。既有 spec 多數凍結在 `2025-06-15`；預設 handler（每年 404）讓涉及年度一律 `pending`／`unavailable`，fallback 只跳週末，不改變既有斷言結果。`calendar-and-records.spec.js` 既有測試只重新命名標題（語意過時），`toContainText('國定假日')` 斷言本身不改。

### 4.12 `e2e/holiday-integration.spec.js`（本輪重寫測試 1、10、11，其餘未再變動）

用 `zhDayLabel`／`seedAppStorage`／`freezeTime`／`mockHolidayCdn`／`buildHolidayYearBody`（已對照 `e2e/helpers.js` 確認 `FIXED_TODAY = '2025-06-15T03:00:00'`、上述四個既有 export 都存在）。日期 tile 定位用 `page.getByRole('button', { name: zhDayLabel({year, month, day}) })`。顏色斷言用 `toHaveClass(/react-calendar__tile--holiday/)` 或 `toHaveCSS('color', 'rgb(...)')`。**所有 `available`（200）情境一律用 `buildHolidayYearBody` 產生 body**，不用單一日期陣列。

1. **（本輪追加補班週六斷言，回應 issue 3）available，含週末暗紅、未選取 hover/focus、補班週六**：`onboardDate = '2024-06-01'`（`FIXED_TODAY = 2025-06-15` 下，作用中 period 為 2025-06-01～2026-05-31，預設顯示月份為 2025 年 6 月，整月都在期間內）。mock 2025.json 為 `buildHolidayYearBody(2025, ['2025-06-18'], ['2025-06-21'])`——`2025-06-18` 是週三（額外標為國定假日的平日），`2025-06-07`／`2025-06-21` 都是週六，`2025-06-21` 被 `excludeIsoDates` 排除、模擬補班。斷言：
   - `2025-06-18`（平日假日）tile 文字暗紅 `rgb(159, 18, 57)`；對它呼叫 `.focus()` 後文字顏色仍是暗紅（驗證未選取假日 hover/focus 規則）。
   - `2025-06-07`（自動涵蓋的週末假日）tile 文字同樣暗紅。
   - `2025-06-21`（補班週六，被排除）tile **不含** `react-calendar__tile--holiday` class，文字顏色是 `rgb(107, 114, 128)`（維持原生 `--weekend` 灰色，不是暗紅、也不是期間外的淡灰）——這條斷言直接對應 §4.7、§3.7「補班的週六不加 `--holiday`」的樣式決策，取代舊版只靠單元測試＋CSS 特異性分析間接論證的做法。
   - note 顯示「已載入」+ `text-stone-400`，不含 `text-red-600`。
2. **既有記錄延展**：已有一筆橫跨平日假日（且可能跨週末）的多天請假記錄，mock 2025.json 用 `buildHolidayYearBody(2025, [對應平日假日])` → 圓點正確跳過假日與週末、往後延展。
3. 選取假日日期 → tile 背景暗紅、文字白色；點擊後保持 focus 時背景仍暗紅。
4. mock 404 且年度 2026（≥currentYear）→ note「尚未公布」+ `text-stone-400`。
5. mock 404 且年度 2024（<currentYear）→ note「無資料來源」+ `text-stone-400`。
6. **error 與重試**：2025.json 一律回傳 `'abort'`，handler 閉包維持計數器。`expect.poll(() => callCountFor2025).toBe(1)` 確認第一次嘗試已發生（此時 note 仍「載入中」）；`page.clock.runFor(2000)` → `expect.poll(...).toBe(2)`；`page.clock.runFor(5000)` → `expect.poll(...).toBe(3)`，斷言 note 變「載入失敗」+ `text-red-600` + 出現「點此重試」按鈕；把 handler 切成成功後點擊重試 → `expect(...).toContainText('已載入')`。
7. 點擊導覽列標籤 → 確認不會鑽到年/年代檢視（`minDetail="month"` 生效）。
8. 切換月份跨到另一狀態不同的 mock 年度 → note 文案正確切換。
9. **期間外的日期**：`onboardDate = '2024-06-15'`（非月初）。`FIXED_TODAY = 2025-06-15` 恰為某作用中 period 的 `periodStart`，預設顯示月份為 2025 年 6 月，其中 1～14 日為期間外（`showNeighboringMonth={false}` 下 `periodStart`／`periodEnd` 所在月都可能出現期間外 tile；本情境用的是 `periodStart` 所在月）。mock 2025.json 為 `buildHolidayYearBody(2025, ['2025-06-04'])`（`2025-06-04` 為期間外的週三，標為假日）。斷言：`2025-06-04`（期間外平日假日）與 `2025-06-07`（期間外週六，`buildHolidayYearBody` 自動涵蓋）都維持 `toHaveCSS('color', 'rgb(209, 213, 219)')`，不顯示暗紅、也不顯示 `#6b7280`——後者正是 §4.7 變動一的直接覆蓋範圍。同步方式：mock handler 立即回應，`toHaveCSS` 內建輪詢即可。
10. **（本輪重寫，回應 issue 1、2a）Settings：清除國定假日快取造成的重抓**：2025 年 handler 依「該年度累積呼叫次數」切換——第 1 次呼叫立即回 200（`buildHolidayYearBody(2025)`，使其成為 `available`），第 2 次以後回傳延遲 resolve 的 Promise；其餘年度一律 404（不計入計數器，避免掛載時 2024/2025/2026 同時發請求造成「第幾次」歧義，比照測試 14/15）。步驟：
    - `onboardDate = '2024-06-01'`（滿 6 個月、有 period），`page.goto('/')` → `expect.poll(() => callCountFor2025).toBe(1)`（掛載觸發第 1 次，2025 變 `available`）。
    - **清除前的負向對照**：做一次「設定 → 首頁」來回（不點任何清除按鈕），等一段寬限時間後斷言 `callCountFor2025` 仍是 `1`——證明 `available` 年度重新掛載不會自然觸發第 2 次請求，之後的第 2 次一定是清除造成的。
    - 到設定頁，斷言「清除國定假日快取」是 enabled（`holidayCache` 至少一筆紀錄）。點擊 → 確認彈窗文案「將清除國定假日快取，未來使用時將觸發重新下載」→ 點擊「確定清空」→ 斷言：**停留在設定頁**、「清除國定假日快取」**立即變回 disabled**、「清除所有本機資料」**維持 enabled**（settings/records 仍在，`hasAnyAppData()` 仍為真）。
    - 回首頁 → coverage effect 對 2025 發出第 2 次請求（此次延遲）→ `expect.poll(() => callCountFor2025).toBe(2)` → 斷言 note 顯示「載入中」。
11. **（本輪重寫具體步驟，回應 issue 2a、2c）Settings：清除所有本機資料**，單一測試內用 `page.evaluate` 寫入 localStorage 後 `page.reload()` 做狀態轉換（比照 `onboarding-and-settings.spec.js` 既有用 `page.evaluate` 檢查/操作 storage 的慣例）：
    - **情境 A（移自舊版測試 10，回應 issue 2a）**：完全不 seed `onboardDate`。`page.goto('/')` → 點「前往設定」（或直接前往設定頁）→ 斷言「清除國定假日快取」「清除所有本機資料」**皆 disabled**（`holidayCache` 為 `{}`，`hasAnyAppData()` 為 `false`，已對照 §4.9 核實掛載不會自動寫入 settings）。
    - **情境 B（清除所有本機資料 → EmptyState，回應 issue 2c 的明確斷言缺口）**：`page.evaluate` 寫入 `onboardDate = '2024-06-01'` 到 localStorage 並 `page.reload()` → 進首頁觸發 coverage effect（此時可用 404 或任意 handler,不需要延遲）→ 到設定頁，斷言兩顆按鈕皆 enabled → 點擊「清除所有本機資料」→ 確認彈窗文案「將清空所有資料，請自行備份重要資訊」→ 點擊「確定清空」→ 斷言**導回首頁並顯示 EmptyState**（`page.getByRole('heading', { name: '尚未設定到職日' })` 可見)。
    - **情境 C（disabled 規則與離職組合，回應 issue 2c）**：`page.evaluate` 重新寫入 `onboardDate = '2024-06-01'` 並 `reload()` → 進首頁（重新產生假日快取紀錄）→ 到設定頁 → 走離職兩步驟（「確定」→「確定清空」）→ 斷言此時設定頁「清除所有本機資料」**仍 enabled**（`hasHolidayCache` 仍為真,即使 settings/records 已被 `clearAll()` 清空）→ 點擊「清除國定假日快取」→ 斷言**兩顆按鈕皆變 disabled**（對應 §4.8 情境 3）。
12. 離職彈窗新增說明文字正確顯示；離職後假日快取仍存在（`page.evaluate` 檢查 localStorage）。
13. **`loading` 狀態 + 先有記錄、後 mock 成功**：延遲 handler 延遲 2025.json 回應，body 為 `buildHolidayYearBody(2025, [holidayIso])`。先 `seedAppStorage` 一筆橫跨該假日的多天請假記錄。**resolve 前**（正向斷言，內建輪詢即可）：note 顯示「載入中」，圓點落在該日（fallback 只跳週末）。**在呼叫 `resolveYear2025(...)` 之前**先註冊 `const staleResponse = page.waitForResponse(...)`（比照測試 14/15 的寫法，避免錯過已發生的 response 事件），呼叫 resolve 後 `await (await staleResponse).finished()` 確認回應本體已下載完成。**之後**依序用內建輪詢的正向斷言確認：note 變「已載入」、往後延展那天出現圓點——這兩個正向斷言成立即代表該次 render 已整批提交，接著斷言原本假日當天圓點消失（負向斷言）**不需要**額外的 `waitForTimeout`。
14. 世代計數：清除所有本機資料時仍在飛行中的舊 fetch（程式碼見下方，body 用 `buildHolidayYearBody`）。
15. 世代計數：清除國定假日快取時仍在飛行中的舊 fetch（程式碼見下方，body 用 `buildHolidayYearBody`）。
16. **跨年午夜**：`onboardDate` 使用月-日錨點 `07-01`（例如 `'2020-07-01'`），使涵蓋 `2025-12-31` 深夜的作用中 period 為 `2025-07-01～2026-06-30`——跨過午夜不會新增 period、`key`（`milestoneMonths`）也不會變。`freezeTime(page, '2025-12-31T23:59:30')`。`mockHolidayCdn`：2025.json 回 200（`buildHolidayYearBody(2025)`，`available`），2026.json 回 404（`pending`）。不切換月份，`page.clock.runFor` 快轉超過午夜且超過 `useToday` 的 60 秒輪詢間隔（如 90 秒）。斷言：月曆導覽列標籤仍顯示「2025 年 12 月」；`calendar-holiday-note` 仍為「已載入」（不是「尚未公布」）。同步方式：`page.clock.runFor` 本身同步，React 重新渲染用一般 `expect(...).toContainText(...)` 內建輪詢即可（正向斷言，不需要額外 `waitForTimeout`）。這個測試專門驗證 §4.6 的 `useState` lazy initializer 凍結修法：若沒有凍結，午夜後 `visibleMonth` 的 fallback 會變成 2026 年 1 月，note 會誤讀成「尚未公布」，即使月曆本身仍顯示 12 月。

**測試 14**（未再變動，body 用 `buildHolidayYearBody`）：

```js
test('清除所有本機資料時仍在飛行中的舊 fetch,resolve 後不會復活快取或讓按鈕誤判為 enabled', async ({ page }) => {
  await freezeTime(page)
  let resolveYear2025
  const deferred2025 = new Promise((resolve) => { resolveYear2025 = resolve })
  let callCountFor2025 = 0
  await mockHolidayCdn(page, (year) => {
    if (year !== 2025) return { status: 404 }
    callCountFor2025 += 1
    return deferred2025
  })
  await seedAppStorage(page, { settings: { onboardDate: '2024-06-01' } })
  await page.goto('/')
  await expect.poll(() => callCountFor2025).toBe(1)

  await page.getByRole('button', { name: '設定' }).click()
  await page.getByRole('button', { name: '清除所有本機資料' }).click()
  await page.getByRole('button', { name: '確定清空' }).click()
  await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()

  const staleResponse = page.waitForResponse((res) => /2025\.json/.test(res.url()))
  resolveYear2025({ status: 200, body: buildHolidayYearBody(2025, ['2025-01-01']) })
  const resp = await staleResponse
  await resp.finished()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: '前往設定' }).click()
  await expect(page.getByRole('button', { name: '清除國定假日快取' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '清除所有本機資料' })).toBeDisabled()
  await expect
    .poll(() => page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('leaveCalculator_holidayCache_'))
    ))
    .toEqual([])
})
```

**測試 15**（未再變動，body 用 `buildHolidayYearBody`）：

```js
test('清除國定假日快取後立刻觸發新請求,過期的舊請求不會誤判 in-flight guard 或覆蓋新結果', async ({ page }) => {
  await freezeTime(page)
  let resolveA, resolveB
  const deferredA = new Promise((r) => { resolveA = r })
  const deferredB = new Promise((r) => { resolveB = r })
  let callCountFor2025 = 0
  await mockHolidayCdn(page, (year) => {
    if (year !== 2025) return { status: 404 }
    callCountFor2025 += 1
    return callCountFor2025 === 1 ? deferredA : deferredB
  })
  await seedAppStorage(page, { settings: { onboardDate: '2024-06-01' } })
  await page.goto('/')
  await expect.poll(() => callCountFor2025).toBe(1)

  await page.getByRole('button', { name: '設定' }).click()
  await page.getByRole('button', { name: '清除國定假日快取' }).click()
  await page.getByRole('button', { name: '確定清空' }).click()

  await page.getByRole('button', { name: '首頁' }).click()
  await expect.poll(() => callCountFor2025).toBe(2)

  const responseA = page.waitForResponse((res) => /2025\.json/.test(res.url()))
  resolveA({ status: 200, body: buildHolidayYearBody(2025, ['2025-06-18']) }) // X 日
  const respA = await responseA
  await respA.finished()
  await page.waitForTimeout(200)
  await expect(page.getByTestId('calendar-holiday-note')).toContainText('載入中')
  await expect(
    page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
  ).not.toHaveClass(/react-calendar__tile--holiday/)

  await page.getByRole('button', { name: '設定' }).click()
  await page.getByRole('button', { name: '首頁' }).click()
  await page.waitForTimeout(200)
  expect(callCountFor2025).toBe(2)

  const responseB = page.waitForResponse((res) => /2025\.json/.test(res.url()))
  resolveB({ status: 200, body: buildHolidayYearBody(2025, ['2025-06-19']) }) // Y 日
  const respB = await responseB
  await respB.finished()
  await page.waitForTimeout(200)
  await expect(page.getByTestId('calendar-holiday-note')).toContainText('已載入')
  await expect(
    page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 19 }) })
  ).toHaveClass(/react-calendar__tile--holiday/)
  await expect(
    page.getByRole('button', { name: zhDayLabel({ year: 2025, month: 6, day: 18 }) })
  ).not.toHaveClass(/react-calendar__tile--holiday/)

  expect(callCountFor2025).toBe(2)
})
```

> 測試 1、9、10、11、14、15、16 的 `onboardDate` 精確值與星期數（`2025-06-01` = 週日、`2025-06-07`／`2025-06-21` = 週六、`2025-06-18`／`2025-06-19` = 週三／週四等）已依既有 `FIXED_TODAY = '2025-06-15T03:00:00'` 推算校準，實作時仍須對照 `e2e/helpers.js` 現況與 `calculateSummary` 的 period 邊界規則二次確認；只要保證 `neededYears` 涵蓋目標年度、且指定日期落在期望的期間內/外位置與正確的星期即可，日期本身可依實作校準結果微調。

### 4.13 `CONTRIBUTING.md`

已用 `grep -n '^## '` 對照確認既有章節順序：回報問題與提出建議（L5）／開發環境設定（L9）／開發流程（L18）／測試（L24）／Pull Request 合併規範（L38）／**程式碼風格（L56）**／**授權（L60）**／AI 輔助開發（L64）。**插入位置**：「## 程式碼風格」之後、「## 授權」之前。內容（逐字使用）：

```
## 國定假日資料維護

國定假日資料取自 ruyut/TaiwanCalendar，已抓取成功的年度會永久快取在使用者的瀏覽器中，不會自動重新下載。若政府修改已公布年度的辦公日曆表（例如修法新增國定假日），或資料源的既有檔案有誤並已修正，請將 `src/utils/holidayCache.js` 的 `HOLIDAY_CACHE_VERSION` 加一並重新部署，所有使用者下次開啟網站時會自動重新下載。
```

## 5. 測試計畫

### 5.1 單元測試（Vitest，`src/utils/**/*.test.js`，須達 codecov/patch 90% 門檻，未再變動）

**`holidayCache.test.js`**：1. 日期格式轉換；2. 200→`available`+`Set`；3. 404 且 `>=currentYear`→`pending`；4. 404 且 `<currentYear`→`unavailable`；5. 非 404 連續 3 次失敗→`error`，`fetchImpl` 3 次、`sleep` 收到 2000/5000；6. 第 2 次成功→`available`，只呼叫 2 次；6b. 不注入 `sleep`/`fetchImpl`，用 fake timers 走一次失敗後成功；7. `cacheVersion` 不符視為 cache miss；7b. `status='available'` 但 `dates` 缺失/非陣列，或 `status` 不屬於 `available`/`unavailable` → 視為損毀跳過；8. 持久化寫入丟錯不外洩例外；9. 清除只刪對應 prefix；9b. localStorage 存取本身丟錯（`Storage.prototype.length` getter spy）時 `clearHolidayCacheFromStorage` 不外洩例外；10. `hydrateHolidayCache` 正確轉回 `Set`，損毀 JSON 被跳過；10b. localStorage 存取本身丟錯時回傳 `{}`。檔案頂層 `afterEach(() => vi.restoreAllMocks())`。

**`leaveCalculations.test.js`**：11. `getDefaultVisibleMonth` 三種情況（期間內/外/不傳 `today`）；11b. `periodEnd` 當天帶非午夜時間仍回傳 `periodEnd` 所在月份；12. `isNonWorkingDay` 回傳 `true` 時不計入、往後延；13. 補班日（週六回傳 `false`）視為工作日；14. 不傳第三參數維持回歸行為；15. `makeIsNonWorkingDay` 各狀態下的行為。

**`storage.test.js`**：`hasAnyAppData()` 五種情境 + localStorage 存取丟例外時回傳 `false`。檔案頂層 `afterEach(() => vi.restoreAllMocks())`。

### 5.2 e2e 測試

見 §4.11、§4.12（含本輪重寫的測試 1、10、11）。所有情境的時序穩定性，以 `npx playwright test e2e/holiday-integration.spec.js --repeat-each=20` 實際執行驗證。

## 6. Commit 拆分建議（未再變動）

1. **資料層基礎** — `holidayCache.js` + 單元測試 → `Refs #34`
2. **既有 e2e 的 CDN 攔截先行** — `e2e/helpers.js` 新增 `mockHolidayCdn`、`buildHolidayYearBody`，六個既有 spec 補上攔截 → `Refs #34`
3. **hook + App.jsx 串接** — `useHolidayCache.js`、`App.jsx`、`MainPage.jsx` 兩個 effect → `Refs #34`
4. **`getLeaveRecordDates`／`getDefaultVisibleMonth` 假日感知** — `leaveCalculations.js` + 單元測試 → `Refs #48`
5. **期間外週末顏色修正** — `index.css` 中 `--out-of-period` 規則移位 → 不標註 issue
6. **月曆視覺層** — `LeaveCalendar.jsx`、`MainPage.jsx` 的 `visibleMonth`／五態文案、`index.css` 假日樣式 → `Fixes #48`、`Fixes #34`
7. **Settings 資料管理** — 兩顆按鈕、確認彈窗、disabled 判斷、離職彈窗說明、`hasAnyAppData()`、`App.jsx` 的 `handleClearAllData` → `Refs #34`
8. **新 e2e 測試** — `e2e/holiday-integration.spec.js` 全部情境 → `Refs #34`、`Refs #48`
9. **文件** — README 授權文案（取代 L142，逐字無空格）+ `CONTRIBUTING.md`「國定假日資料維護」小節（插入於「程式碼風格」之後、「授權」之前）→ `Refs #34`

## 7. 驗收方法與條件

- [ ] 有假日資料的年度，平日國定假日與週六日皆暗紅；跨越該日的多天請假記錄正確往後延展（單元 §5.1-12、13；e2e §4.12-1、2）
- [ ] 沒有假日資料時退回只跳過週末，週末同樣暗紅（單元 §5.1-14、15；e2e §4.12-4、5、6）
- [ ] `calendar-holiday-note` 正確反映目前顯示月份所屬年度的狀態，含切換 tab、切換月份、期間最後一天、跨年午夜（單元 §5.1-11、11b；e2e §4.12-8、16）
- [ ] `minDetail="month"` 生效（e2e §4.12-7）
- [ ] 選取中的假日 tile：背景暗紅、文字白色，hover/focus 後仍維持（e2e §4.12-3）
- [ ] 未選取的假日 tile 在 focus 時文字維持暗紅（e2e §4.12-1）
- [ ] **補班的週六不套用 `--holiday`，維持原生 `#6b7280`**（e2e §4.12-**1**，本輪改為直接斷言而非間接論證，回應 issue 3）
- [ ] 期間外的日期（含週末與假日）一律顯示淡灰 `#d1d5db`（e2e §4.12-9，涵蓋 §3.8 修正）
- [ ] 已存在的請假記錄，在假日資料中途 fetch 成功後，圓點位置自動正確更新（e2e §4.12-13）
- [ ] `loading` 狀態正確顯示並退回只跳週末；轉 `available` 後 note 與圓點正確更新，含清除快取後回首頁重新進入 loading 的過渡，且該次重抓可歸因於「清除」而非單純「重新掛載」（e2e §4.12-**10**，本輪修正測試有效性，回應 issue 1；e2e §4.12-13）
- [ ] 五種狀態 note 文字顏色正確，僅 `error` 為 `text-red-600`；所有文案標點與概念計畫原文逐字一致（e2e §4.12-1、4、5、6、13）
- [ ] `pending` 每天自動重試；`error` 內部自動重試 3 次後才顯示「點此重試」；`unavailable` 不重試（單元 §5.1-3~6、6b；e2e §4.12-6）
- [ ] `cacheVersion` 不符、或 `available` 缺少有效 `dates` 陣列時，視為未抓過重新 fetch（單元 §5.1-7、7b）
- [ ] localStorage 存取本身失敗時，App 與 Settings 頁仍能正常渲染（單元 §5.1-9b、10b）
- [ ] 離職不清除假日快取；兩顆清除按鈕的確認彈窗、disabled 規則（含 §4.8 三個驗證情境，情境 2 本輪已修正為「到職滿 6 個月且進過首頁」）、清除後頁面行為正確，含「清除所有本機資料」確認後落在 EmptyState 的明確斷言（單元 storage 案例；e2e §4.12-**10**、**11**、12，本輪重寫，回應 issue 2）
- [ ] 清除時仍在飛行中的舊請求，不會讓快取復活、不會覆蓋新結果、不會誤刪新請求的 in-flight guard（e2e §4.12-14、15）
- [ ] Vitest spy 不會污染同檔案其他案例（`storage.test.js`、`holidayCache.test.js` 皆有 `afterEach`）
- [ ] README 授權文案取代既有句子、逐字無空格；`CONTRIBUTING.md`「國定假日資料維護」小節已插入指定位置

## 8. 相關 Issue

完成後可關閉：[#34](https://github.com/corytu/annual-leave-calculator/issues/34)、[#48](https://github.com/corytu/annual-leave-calculator/issues/48)。原始 P2-8（僅 UI 揭露限制）由本功能完整取代。
