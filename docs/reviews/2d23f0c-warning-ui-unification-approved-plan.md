# 警示/警告機制統一改版 — 實作計畫（第五版，round 3 review 後修訂）

> 對應 concept plan：`.agent-log/20260923-121223/round-1-coder-prompt.txt` 內附的概念計畫（#46，第二版）
> 本文件是把 concept plan 的 W1–W16 決定，落到具體檔案異動與程式碼骨架的執行計畫。
> 本版依 round 3 Reviewer 的 JSON 意見（0 阻擋、1 重要、2 次要，另有 `notes` 欄位裡 3 則非必要觀察）逐條評估修訂，詳見下方「Reviewer 意見逐項處理」。上一版（第四版，round 2 review 後修訂）的 9 項意見與 1 則追問已在那一版處理完畢，本版不重複列出，僅在會被本輪修法波及的地方一併更新。

## 0. Context

現況警示機制四套並存、觸發時機與呈現方式互不一致：LeaveForm 的 inline `error`（submit-time）、Settings 的瀏覽器原生 `alert()`（submit-time）、離職重來的兩層 Modal（本輪不動）、Settings 的合規建議清單（`checkLaborLawCompliance`，本輪完全不碰）。本輪把前兩者統一成「即時重算、可同時多筆、依語意分三層（incomplete/error/advisory）」的機制。核心行為轉變：過去是「送出才知道被擋」，改成「值一變就知道會不會被擋，按鈕即時反映」（W14）。

本文件已經歷 Coder/Reviewer 審閱迴圈三輪：round 1 抓到 2 個阻擋、3 個重要、6 個次要問題，收斂出第三版計畫的核心變化（`fieldWarnings` 改用 `useMemo` 衍生，不用事件處理常式顯式呼叫）；round 2 對第三版又抓到 1 個阻擋、1 個重要、7 個次要問題，收斂出第四版（補齊 `onboardDateWarnings`/`growthPerYearWarnings` 兩個顯示子集等）；round 3 對第四版抓到 1 個重要、2 個次要問題，另有 3 則非必要觀察。本版（第五版）是把 round 3 的意見逐條處理後的結果。核心變化：

1. **修正 `isQuarterStep` 程式註解的機制錯誤**——原註解把「x 本身是 Infinity」與「x*4 溢位成 Infinity」這兩條路徑混為一談，錯誤地說「若 x*4 溢位成 Infinity，`Number.isFinite(x)` 這一步就會先擋下」，但 `Number.isFinite` 檢查的是 x 本身不是 x*4；這段註解會原封不動寫進程式碼，又是 concept §6 的驗收項目，必須改正確（回應重要項）。
2. **修正「到職日留空」新增 e2e 的觸發步驟**——原步驟「不填到職日直接嘗試儲存」做不到：按鈕一開始就是 disabled，`.click()` 會等到 enabled 才觸發、最終逾時；就算點得到，touched 也不會被標記。改成用 focus+blur 到職日輸入框觸發（回應次要項）。
3. **修正 §6.7 的 W16 回歸測試，補上前置 seed**——原步驟「只點月曆選日期，天數維持預設 1」在預設狀態下不會構成超支，缺少讓「剩餘額度不足」成立的前置條件。改成比照刪除記錄測試的手法先 seed 一筆用滿額度的既有記錄（回應次要項）。
4. **修正「門檻重複」相關的 e2e 斷言預期**——原文字「集中清單各自顯示一行」與「同時掛在兩列上」忽略了同一組重複的兩則警示共用同一個 `dedupeKey`，`dedupeBy` 只會留下 1 行代表，不是 2 行；UI 上觀察不到「兩列同時掛著」這件事，只能用單元測試驗證原始陣列裡兩個 `rowId` 都各自有 warning。§7.4 的對照表、Commit 4 的回歸測試都據此調整（採納 `notes` 欄位裡的非必要觀察 #2、#3，理由見下方）。

其餘 round 1、round 2 已確認的設計與骨架（§1–§11 大部分內容）本輪未被質疑，原樣沿用。

---

## Reviewer 意見逐項處理（round 3）

以下逐條評估 round 3 Reviewer 對第四版計畫的意見（0 阻擋、1 重要、2 次要），以及 `notes` 欄位裡的三則非必要觀察，說明是否接受與理由。

### 重要

**#1 §5.1 `isQuarterStep` 的程式註解把機制寫錯了 —— 接受**

原註解寫「若 x*4 溢位成 Infinity，`Number.isFinite(x)` 這一步就會先擋下回傳 false」。這句話錯誤地把「x*4 溢位」跟「被 `Number.isFinite(x)` 擋下」接在一起，但 `Number.isFinite` 檢查的對象是 `x`，不是 `x*4`。以 `x = Number.MAX_VALUE` 為例：`x` 本身是有限值，會通過 `Number.isFinite(x)`；`x*4` 才會溢位成 `Infinity`；`Infinity % 1` 是 `NaN`；`NaN === 0` 為 `false`——所以這個案例是在 `(x*4)%1 === 0` 這一步被擋下，不是被 `isFinite` 擋下。§5.2 的測試說明和 §9 邊界情境彙整第 5 點都把這兩條路徑分開寫對了（`Infinity` 在 `isFinite` 被擋、`MAX_VALUE` 才是 `x*4` 真正溢位的路徑），只有 §5.1 的程式註解跟它們自相矛盾。這段註解會原封不動寫進 `warnings.js`，又是 concept §6 驗收清單明列的項目（「這個差異已在 §3.1 的程式註解與此處明講」），寫錯會直接讓驗收失敗，必須修正。

**修法**：把兩條路徑分開寫清楚——「x 本身是 ±Infinity/NaN」由 `Number.isFinite(x)` 直接擋下；「x 是很大的有限數、x*4 才溢位成 Infinity」由 `(x*4)%1 === 0` 這一步擋下（`Infinity % 1 === NaN`）。並補上舊版行為對照：`Number.MAX_VALUE % 0.25 === 0`，舊版會判定合法，新版判定不合法，這才是兩版真正的行為差異點。詳見下方 §5.1。

### 次要

**#2 §7.4「到職日留空」新增測試的觸發步驟做不到 —— 接受**

原步驟「不填到職日直接嘗試儲存 → 斷言出現『請填寫到職日』」有兩個問題：到職日是空的時候，儲存按鈕一開始就是 `disabled`（§7.5 自己也這樣斷言），Playwright 的 `.click()` 會等到按鈕變成 enabled 才觸發，實際上永遠不會 enabled，最終逾時；而且就算點得到，`touched.onboardDate` 也只由到職日 input 的 `onBlur` 觸發，點擊儲存按鈕不會標記它，訊息依然不會顯示。

**修法**：改成切到設定頁 → 先斷言儲存按鈕 `disabled` 且「請填寫到職日」不可見（順便覆蓋 touched 過濾的正向情境）→ 對 `input[type="date"]` 依序 `.focus()` 再 `.blur()`（不輸入任何值，只觸發 touched）→ 斷言「請填寫到職日」可見（`{ exact: true }`）、儲存按鈕仍 `disabled`。同時在 §7.4 負向測試模板段落明講排除「直接點擊儲存按鈕觸發」這條路徑（呼應 concept plan Commit 3 e2e 段落原文「或直接點擊儲存按鈕」那個備選寫法，避免實作時照抄），因為 blocking 狀態下按鈕本身是 disabled，點擊既觸發不了、也不會標記任何欄位 touched，只有「改值/互動 + blur」這條路徑對三層警示都成立。詳見下方 §7.4。

**#3 §6.7 的 W16 回歸測試沒有寫前置 seed —— 接受**

原步驟「只點月曆選日期，天數維持預設 1，斷言超支警示可見」漏了前提：預設狀態下（無既有記錄）選一天、天數用預設值 1，並不會構成超支，這個步驟本身就觀察不到警示，測試會直接失敗或斷言不到任何東西。

**修法**：比照 §6.7 刪除記錄那條測試已經在用的 seed 手法——先 seed 一筆用滿本期額度的既有記錄（例如額度 7 天、seed 一筆 7 天的記錄，剩餘額度變成 0 天），開啟頁面後全程不去操作日期 input（不 focus、不 blur，直接不碰它），只透過點月曆選一個還沒被記錄佔用的合法日期（天數同樣全程不去碰，維持預設值 1）→ 斷言超支警示可見、新增按鈕 disabled。「日期 input 從未被 focus 過」這件事不需要額外的斷言 API，靠測試程式碼本身「全程不對它呼叫任何操作」來保證，就足以確定這條測試測的是「只透過點月曆」這條路徑。詳見下方 §6.7。

### `notes` 欄位裡的三則非必要觀察

**觀察 #1：`useMemo` 依賴的 `today`/`periodStart`/`periodEnd` 若每次 render 都是新的 Date 物件，`useMemo` 形同虛設 —— 不修改，維持現狀**

Reviewer 自己也判斷這不影響正確性，只是 memo 形同虛設，可以接受。本計畫同意：`useMemo` 在這裡的目的是「用衍生值取代事件處理常式裡顯式呼叫重算」這個架構決定（§2），不是為了效能優化；即使每次 render 都重算，重算成本本身跟 §2 效能核對的結論一致（單純比較，無迴圈/陣列建構），不會有效能問題。不為了讓 memo「真的生效」而額外做穩定化處理，那是本輪範圍外的優化。

**觀察 #2：§7.4 對照表「112-131 門檻重複」那列的新斷言「集中清單各自顯示一行」與實際行為不符 —— 接受**

不只是「只有被 blur 的那一列會出現在 touched 裡」這個顯示層問題，而是即使**兩列都 touched**，兩則警示的 `dedupeKey` 是同一個（`` `months-duplicate-${monthsNum}` ``），`dedupeBy` 一定只會保留先出現的那一筆代表，集中清單**最多只會顯示 1 行**，不會是「各自顯示一行」（2 行）。原文字如果照字面實作測試，會斷言出跟 `dedupeBy` 設計互相矛盾的期望值，測試一定會失敗。

**修法**：改成「只 blur 其中一列的 `months` 欄位 → 斷言 `settings-form-warnings` 容器內恰好 1 行」，並註明這跟 C3（兩組**不同數值**的重複門檻）不衝突——C3 的兩組警示 `dedupeKey` 不同，dedup 後本來就會各自保留 1 行、合計 2 行，這才是「各自顯示一行」成立的情境。詳見下方 §7.4。

**觀察 #3：Commit 4「門檻重複同時掛在兩列上」這條回歸測試在 UI 上觀察不到 —— 接受**

原因同觀察 #2：`scope: 'form'` 的門檻重複警示只會在集中清單出現，且經過 `dedupeBy` 之後同一組重複最多顯示 1 行，UI 上不可能同時看到「兩列各自掛著」的畫面。

**修法**：拆成兩種斷言分工——單元測試（§7.2）直接讀 `validateSettingsInput` 回傳的原始陣列，斷言兩個 `rowId` 都各自產生一則 `tier: 'error'`、`dedupeKey` 相同的 warning；e2e 則一次只 blur 其中一列的 `months` 欄位，分別驗證兩種情況下訊息都能正確顯示在集中清單（各自斷言「恰好 1 行」）。詳見下方 §7.2、Commit 4。

---

## 1. HEAD 覆核結果（與 concept plan 的落差）

本節內容在 round 1、round 2、round 3 三輪都已核對，round 3 Reviewer 的 `notes` 也再次比對過 HEAD（`d9a6bfb`）並確認大致正確，這裡不重複核對，直接沿用：

- `settingsValidation.js` 的 `validateSettingsInput` 已經把每個條件拆成具名布林變數，檔頭與函式註解都明確寫著「這是為了未來的 inline-error UI 預留」——本輪就是在兌現這個預留。**Commit 3 是改寫既有 `validateSettingsInput`（同名、原地改寫回傳型別為 `Warning[]`），不是新建函式。**
- LeaveForm 的月曆點選（`selectedDate`）與編輯模式（`editingRecord`）是**同一個** `useEffect`，依賴陣列 `[editingRecord, selectedDate]`，**不含 `allRecords`**。改用 `useMemo` 衍生 `fieldWarnings` 後，這個 effect 只需要負責 `setStartDate`/`setDays`/`setTouched`，不再需要呼叫任何重算函式。
- LeaveForm 的 quick-pick 天數按鈕用寫死的 `[0.25, 0.5, 1, 2, 3]`；本輪不處理這個既有死碼/命名不一致，只疊加 `touched.days = true` 標記。
- LeaveForm 送出按鈕、Settings 儲存按鈕目前都**沒有** `disabled` 屬性，也沒有任何 `disabled:*` class。本專案的 disabled 按鈕慣例是 `disabled:opacity-40 disabled:hover:<原色>`；兩個主要動作按鈕統一加上 `disabled:opacity-40 disabled:hover:bg-teal-700`，cursor 由 `src/index.css:11-16` 全域處理不用另加。
- `src/components/` 目前沒有 `ui/` 子目錄；`<FieldWarnings />` 新增為 `src/components/FieldWarnings.jsx`，直接被 `LeaveForm.jsx`、`Settings.jsx` import。
- e2e 的 `page.once('dialog', …)` 共 8 處，全部在 `onboarding-and-settings.spec.js` 的「特休規則設定」describe block 內，行號：112-131（門檻重複）、146-163（門檻 >1200）、180-202（天數欄位打負號）、264-280（每年增加天數留空）、282-297（cap 低於最後一列）、299-314（cap 非 0.25 倍數）、349-365（特休天數 365.1）、367-391（C4 正向）。`calendar-and-records.spec.js` 完全沒有 dialog 監聽。
- `resignation.spec.js` 需要修改：第 62-71 行的按鈕 cursor 斷言在改版後會失敗，必須改寫；第 185-217 行的鎖定頁合規清單測試維持不動——鎖定頁「儲存設定」按鈕根本不渲染，跟本輪 `fieldWarnings`/`touched` 機制無關。
- `Settings.jsx` 的 `customRules`/`growthPerYear`/`growthCap` 狀態是「原始值，可能是數字（預設值）也可能是字串（使用者編輯過）」的混合型別。W9 的空值判斷必須讀原始值（`r.months === '' || r.months == null`），不能先 `Number()` 再判斷（`Number('') === 0`，不是 `NaN`）。
- `getLastRuleDays`（`settingsValidation.js:10-29`）、`getCustomCapMin`（43-47 行）已存在，`cap-min-lastrow` 重用前者，不自己重新用 `reduce` 實作換算邏輯。
- `Settings.jsx:64-71` 的 `addCustomRule` 目前 `uuidv4()` 呼叫沒有綁定外層變數，要先提出來才能同時呼叫 `setTouched`。
- `Settings.jsx:271`、`327` 已有 `data-testid="custom-rule-row"`/`"custom-growth-row"`，既有 e2e（82、95、233 行）已經在用它們搭配 `.filter({ has: page.locator('input[value="N"]') })` 定位特定列——本輪新增/改寫的既有列/成長列相關 e2e 比照這個慣例；**本輪新增的集中清單區塊例外，見 §7.4**。
- `e2e/period-tabs.spec.js:63-92`、`e2e/carryover.spec.js:101-128` 兩支既有測試會因按鈕變 disabled 而在 `.click()` 逾時，併入 Commit 2 改寫。
- LeaveForm 用 `activePeriod.milestoneMonths` 當 key，切分頁會 remount，`touched` 會自然重置。
- `handleCancelEdit` 會同時清掉 `selectedDate`，所以 `resetForm` 之後 sync effect 不會誤把 `startDate` 標成 touched。
- App.jsx 的 `handleDeleteRecord` 是直接 `filter`，沒有 `confirm()`，不會引入新的 dialog；刪除時也不會清掉 `MainPage` 的 `selectedDate`，表單狀態會保留。

## 2. 本計畫在 concept plan 之外新增的實作細節（需要記錄理由）

concept plan 定義了「計算即時、顯示看 touched」的原則（W6/W11/§3.4/§3.5），但沒有規定「跨欄位/跨列的警示要依哪個欄位的 touched 狀態決定顯示」，也沒有規定「計算」要用事件處理常式顯式呼叫還是用衍生值。這是本計畫補上的實作細節：

**決定：`Warning` 物件額外帶三個實作用欄位 —— `touchedKeys: string[]`、`dedupeKey: string`、`field: string`**（不寫進 concept plan §3.1 公開 typedef，但兩者相容）：

- `touchedKeys`：「任一個 key 被標記過 touched 就顯示」（OR，不是 AND）。理由：W16 回歸測試要求「只透過點月曆選日期（`startDate` touched，`days` 從未 touched）就要能看到超支警示」，AND 語意會讓這條回歸測試失敗；且 `computeXxxWarnings` 已經保證「只有前置欄位都合法才會跑跨欄位檢查」（W15），所以「任一相關欄位被確認過」在實務上等於「使用者已經看過這個結果」。`touchedKeys: []` 保留給「規則清單為空」這種不對應任何欄位的表單級錯誤，語意是「不設限，永遠可見」。
- `dedupeKey`：門檻重複警示用它做 W12 的集中清單去重，語意化對應「依門檻數值去重」，不依賴訊息文字碰巧不同。**同一組重複（相同 `monthsNum`）的兩則警示共用同一個 `dedupeKey`，因此即使兩列都 touched，集中清單經過 `dedupeBy` 後也只會顯示 1 行（保留先出現的那一筆代表）——這件事在 round 3 之前的版本被寫錯（見「Reviewer 意見逐項處理」觀察 #2、#3），round 3 已在 §7.4、Commit 4 修正對應的斷言預期。**
- `field`：分派渲染位置、以及 W15 前置判斷要讀哪個來源欄位的專用鍵。`id` 只負責 React key 的唯一性與穩定性，不用來做邏輯判斷。`field` 的完整值域與對應渲染位置：

  | `field` 值 | 產生於 | 渲染位置 |
  |---|---|---|
  | `startDate` | `computeLeaveFormWarnings` | LeaveForm 日期欄位下方（`startDateWarnings`） |
  | `days` | `computeLeaveFormWarnings` | LeaveForm 天數欄位下方（`daysWarnings`）；`scope: 'form'` 的 `overspend` 例外，走集中清單 |
  | `onboardDate` | `validateSettingsInput` | Settings 到職日欄位下方（`onboardDateWarnings`） |
  | `months` | `validateSettingsInput` | Settings 逐列（`rowMonthsWarnings`）；`scope: 'form'` 的門檻重複例外，走集中清單 |
  | `days`（列） | `validateSettingsInput` | Settings 逐列（`rowDaysWarnings`） |
  | `growthPerYear` | `validateSettingsInput` | Settings 成長列的每年增加天數欄位下方（`growthPerYearWarnings`） |
  | `growthCap` | `validateSettingsInput` | Settings 成長列的天數上限欄位下方（`growthCapWarnings`，含 `cap-min-lastrow`） |

  這張表逐一核對每個會產生 `scope: 'field'`/`'row'` 警示的 `field` 值都有渲染出口，避免 round 2 阻擋項那種「算了警示卻沒地方顯示」的問題再次發生。這個 codebase 沒有元件測試框架，做不到自動化 render test，所以用這份文件內核對表取代。

**決定：門檻重複警示雖然「屬於」個別列（帶 `rowId`，`touchedKeys` 只看那一列的 `months`），但渲染時 `scope` 標成 `'form'`，讓它自然落在集中清單而不是逐列 inline。**

**決定：`scope` 除了決定「畫在哪個區塊」，也是顯示過濾的必要條件，不能只靠 `field`/`rowId` 判斷。**

- 逐欄位/逐列 inline：`scope === 'field'`（單欄位）或 `scope === 'row'`（自訂規則列），外加 `field`/`rowId` 篩到正確位置。
- 集中清單：`scope === 'form'`，依 `dedupeKey ?? id` 去重。
- 兩種顯示互斥——同一條警示只會落在其中一種。

**決定：`fieldWarnings` 用 `useMemo` 從目前的 state/props 衍生，不用事件處理常式裡顯式呼叫重算函式。**

```js
const fieldWarnings = useMemo(
  () => computeLeaveFormWarnings({ startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today }),
  [startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today]
)
```

Settings 比照辦理。這是對 concept plan §3.4 字面寫法（「在事件處理常式裡顯式呼叫重算函式」）的偏離，原因：

- concept §3.4 的目的是「計算即時、不漏掉任何一個改值路徑」，`useMemo` 衍生是達成這個目的的更嚴格手段——不需要窮舉「哪些操作會改值」，任何被讀進 `computeXxxWarnings` 的 state/props 改變都會自動觸發重算，包含「刪除記錄」這種**沒有被 concept plan §3.4 列舉到**的路徑（§6.7、§7.4 的兩個回歸測試就是在驗證這件事）。
- `useMemo` 在 render 時讀取「當下已更新」的 state，不會有 `setState` 之後同函式內立刻讀舊值的閉包問題，不需要 override 參數寫法。
- W16（顯式標記 touched）不受影響，`touched` 仍是獨立 state，由各事件處理常式在「使用者確認」時機顯式標記，跟計算完全脫鉤——這正是 concept §3.4/§3.5 的設計精神（計算跟顯示是兩個旋鈕），`useMemo` 只轉緊「計算」這顆，沒動到「顯示」那顆。
- 效能：這批檢查全是常數時間比較，每次 render 重算不會有問題（`useMemo` 依賴項若每次 render 都是新物件會讓 memo 形同虛設，但不影響正確性，本輪不處理，見「Reviewer 意見逐項處理」觀察 #1）。

**決定：`computeLeaveFormWarnings` 放在新檔 `src/utils/leaveFormValidation.js`，不放在 `.jsx` 元件檔裡 export。**

`vitest.config.js` 的 `test.include` 只收 `src/utils/**/*.test.js`，`settingsValidation.js` 檔頭註解也明講它是「extracted out of Settings.jsx so boundary cases can be covered by fast unit tests」——這是本專案已確立的先例。從 `.jsx` 元件檔 export 非元件函式也會破壞 React Fast Refresh。`warnings.js` 只保留跨檔案共用的泛用 helper（`isBlocking`/`isQuarterStep`/`isWarningVisible`/`dedupeBy`）。

**決定：`addCustomRule` 新列自動標記 touched（方案 c）是實作計畫層級記錄的、對 concept W16 的已確認例外，不是 concept plan 正式文本的規定。** 出處：round 1 review 迴圈中，Reviewer 對第二版計畫指出「新列月數可能超過 1200 上限但沒有 touched 標記」的問題，維護者在該輪確認選擇方案 (c)，記錄於本實作計畫（非 concept plan）§11。若之後要讓這條規則進 concept plan 正式文本，需要另一輪 concept plan 確認，不是這份實作計畫能單方決定的事。`removeCustomRule`、`ruleType` 切換不受影響，維持原判斷不標記 touched。

## 3. 檔案異動範圍總覽

| 檔案 | 異動類型 | Commit |
|---|---|---|
| `src/utils/warnings.js` | 新增（`isBlocking`、`isQuarterStep`、`isWarningVisible`、`dedupeBy`） | 1 |
| `src/utils/warnings.test.js` | 新增 | 1 |
| `src/components/FieldWarnings.jsx` | 新增 | 1 |
| `src/utils/leaveFormValidation.js` | 新增（`computeLeaveFormWarnings`） | 2 |
| `src/utils/leaveFormValidation.test.js` | 新增 | 2 |
| `src/components/LeaveForm.jsx` | 改寫 | 2 |
| `e2e/calendar-and-records.spec.js` | 改寫+新增測試（含 §6.7 修正後的 W16、刪除記錄測試） | 2 |
| `e2e/period-tabs.spec.js` | 改寫第 63-92 行測試 | 2 |
| `e2e/carryover.spec.js` | 改寫第 101-128 行測試 | 2 |
| `src/utils/settingsValidation.js` | 改寫 `validateSettingsInput` 回傳型別，重用 `getLastRuleDays` | 3 |
| `src/utils/settingsValidation.test.js` | 改寫（含 round 3 新增的門檻重複兩 `rowId` 單元測試） | 3 |
| `src/components/Settings.jsx` | 改寫，補上 `onboardDateWarnings`/`growthPerYearWarnings`、集中清單 testid | 3 |
| `e2e/onboarding-and-settings.spec.js` | 改寫全部 8 個 dialog 測試（7 負向+1 正向）+新增（含 round 3 修正的到職日留空、門檻重複斷言） | 3 |
| `e2e/resignation.spec.js` | 改寫第 62-71 行測試 | 3 |
| 全專案 `e2e/` | grep 殘留 `dialog` + 補測試 | 4 |

## 4. 資料流（計算 vs 顯示 vs disabled）

```
使用者操作（onChange / onClick / 點月曆 / 編輯回填 / 刪除記錄 / 新增自訂規則列 / 任何會改到
相關 state 或 prop 的操作）
        │
        ├─ setState（欄位值 / customRules / allRecords 等）        ← 一定要做，
        │                                                           就是原本就該做的那次 setState
        │
        └─ (若該操作屬於「使用者確認」，見 W16；`addCustomRule` 新列亦屬此類，見 §2 決定)
              setTouched(t => ({ ...t, [key]: true }))

渲染時（每次 render 自動衍生，不需要任何顯式重算呼叫）：
  const fieldWarnings = useMemo(
    () => computeXxxWarnings({ ...目前所有相關 state/props }),
    [...依賴清單]
  )

  disabled={fieldWarnings.some(w => isBlocking(w.tier))}      ← 永遠用未過濾陣列（W14）

  inline 子集（逐欄位/逐列） = fieldWarnings.filter(w =>
    (w.scope === 'field' || w.scope === 'row') &&
    w.field === 目標欄位 && (w.scope !== 'row' || w.rowId === 目標列id) &&
    isWarningVisible(w, touched)
  )
  集中清單子集 = fieldWarnings.filter(w => w.scope === 'form' && isWarningVisible(w, touched))
                  依 dedupeBy(w.dedupeKey ?? w.id) 去重

  <FieldWarnings warnings={對應子集} />
```

`scope === 'field'`/`'row'` 與 `scope === 'form'` 是兩個互斥的顯示管道，同一條警示只會落在其中一邊。`advisory`（合規清單）完全不進這條資料流，維持現行 `useEffect` + 直接渲染，不套用 touched、不影響 disabled（W7）。每個 `field` 值都必須對應到上面「渲染位置」的其中一格，見 §2 的核對表。

---

## 5. Commit 1 — `src/utils/warnings.js` + `<FieldWarnings />`

### 5.1 `src/utils/warnings.js`（round 3 修訂：修正 `isQuarterStep` 程式註解的機制錯誤，回應重要項 #1）

```js
/**
 * @typedef {'incomplete' | 'error' | 'advisory'} WarningTier
 * @typedef {{
 *   id: string,
 *   tier: WarningTier,
 *   scope: 'field' | 'row' | 'form',
 *   rowId?: string,
 *   field?: string,           // 分派顯示位置/W15 前置判斷用，不解析 id 字串
 *   touchedKeys?: string[],   // 見計畫 §2；空陣列或省略 = 不設限，永遠可見
 *   dedupeKey?: string,       // 僅集中清單去重用，見計畫 §2
 *   message: string,
 * }} Warning
 */

// incomplete/error 會阻擋動作按鈕；advisory 只是建議，不擋。
export function isBlocking(tier) {
  return tier === 'incomplete' || tier === 'error'
}

// 0.25 倍數判斷用 (x*4)%1 而不是 x%0.25，是既有 settingsValidation.js 的既有
// idiom（避開 %0.25 在某些十進位小數上的浮點精度問題）。
// 這個判斷跟 `x % 0.25 !== 0` 並非在所有極端值下都等價，有兩條分開的邊界
// 路徑（round 3 修訂：上一版把這兩條路徑寫混了，這裡重新分開描述）：
//   - x 本身就是 ±Infinity 或 NaN：被 `Number.isFinite(x)` 直接擋下，回傳
//     false。
//   - x 是一個非常大的有限數（例如 Number.MAX_VALUE），是 `x*4` 才會溢位成
//     Infinity：這時 `Number.isFinite(x)` 會通過，但 `(x*4) % 1` 算出
//     `Infinity % 1 === NaN`，`NaN === 0` 為 false，是在這一步被擋下，
//     不是被 isFinite 擋下。
// LeaveForm 天數欄位刻意沒有 max（#30），這個量級的輸入無論走哪條路徑，最
// 後都回報「不是 0.25 的倍數」。舊版 `x % 0.25` 在同樣極端值下的行為不完全
// 相同——例如 `Number.MAX_VALUE % 0.25 === 0`，舊版會判定合法，新版判定
// 不合法，這才是兩版真正的行為差異點。這是刻意接受的差異：這個量級的輸入
// 無論如何都會被 validateRecordsChain 的超支檢查擋下，不影響最終是否能
// 送出。
export function isQuarterStep(x) {
  return Number.isFinite(x) && (x * 4) % 1 === 0
}

export function isWarningVisible(warning, touched) {
  const keys = warning.touchedKeys
  if (!keys || keys.length === 0) return true
  return keys.some(k => touched[k])
}

// 依 keyFn(item) 去重，保留每個 key 第一次出現的項目，順序不變。
// 集中清單用它依 dedupeKey ?? id 去重（W12）。
export function dedupeBy(items, keyFn) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}
```

### 5.2 單元測試 `warnings.test.js`

- `isBlocking`：三個 tier 各自斷言。
- `isQuarterStep`：`0.25`→true、`0.3`→false、`1`→true、`-0.25`→true、`NaN`→false、`Infinity`→false（測試註解寫明：在 `Number.isFinite` 這一步就被擋下，不是溢位路徑）、`Number.MAX_VALUE`→false（`x*4` 在這裡才真的溢位成 `Infinity`，這才是程式註解描述的那條路徑；測試註解需寫明這是刻意接受的邊界行為，不是要修的 bug）。
- `isWarningVisible`：`touchedKeys` 為空/未定義 → true；有值且命中其中一個 key → true；有值但都沒命中 → false。
- `dedupeBy`：多個項目 `dedupeKey` 相同時只保留第一個且順序不變；`dedupeKey` 都不同時全部保留；用於門檻重複場景的具體案例（兩組不同數值各自保留一筆代表）。

### 5.3 `src/components/FieldWarnings.jsx`

```jsx
const TIER_CLASSNAME = {
  incomplete: 'text-xs text-stone-500',
  error: 'text-xs text-red-600',
}

export default function FieldWarnings({ warnings }) {
  if (warnings.length === 0) return null
  return warnings.map(w => (
    <p key={w.id} className={TIER_CLASSNAME[w.tier]}>{w.message}</p>
  ))
}
```

只處理 `incomplete`/`error`，不預留 `advisory` 分支。呼叫端負責先用 `isWarningVisible` 過濾好、依 `scope`/`field`/`rowId` 分派好子集才傳進來。這個 commit 完成後兩個既有測試套件應全綠（純新增）。

---

## 6. Commit 2 — `LeaveForm.jsx` 改寫成即時三層警示

不掛 issue 標籤（延伸優化，不屬於 #46 範圍）。本節內容 round 3 只修訂 §6.7，其餘沿用第四版。

### 6.1 `src/utils/leaveFormValidation.js`

```js
import { isBlocking, isQuarterStep } from './warnings.js'
import { validateRecordsChain, parseLocalDate } from './leaveCalculations.js'

export function computeLeaveFormWarnings({
  startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today,
}) {
  const warnings = []
  const daysIsEmpty = days === '' || days === null || days === undefined
  const parsedDays = daysIsEmpty ? NaN : parseFloat(days)

  if (!startDate) {
    warnings.push({
      id: 'startDate-incomplete', tier: 'incomplete', scope: 'field', field: 'startDate',
      touchedKeys: ['startDate'], message: '請選擇請假開始日期',
    })
  } else {
    const d = parseLocalDate(startDate)
    if (d < periodStart || d > periodEnd) {
      warnings.push({
        id: 'startDate-range', tier: 'error', scope: 'field', field: 'startDate',
        touchedKeys: ['startDate'], message: '日期必須在本週年度範圍內',
      })
    }
  }

  if (daysIsEmpty) {
    warnings.push({
      id: 'days-incomplete', tier: 'incomplete', scope: 'field', field: 'days',
      touchedKeys: ['days'], message: '請輸入天數',
    })
  } else {
    if (!(parsedDays > 0)) {
      warnings.push({
        id: 'days-positive', tier: 'error', scope: 'field', field: 'days',
        touchedKeys: ['days'], message: '天數必須大於 0',
      })
    }
    if (!isQuarterStep(parsedDays)) {
      warnings.push({
        id: 'days-quarter-step', tier: 'error', scope: 'field', field: 'days',
        touchedKeys: ['days'], message: '天數最小單位為 0.25（2 小時）',
      })
    }
  }

  const hasBlockingField = warnings.some(w => isBlocking(w.tier))
  if (!hasBlockingField) {
    const candidateRecords = editingRecord
      ? allRecords.map(r => r.id === editingRecord.id ? { ...r, startDate, days: parsedDays } : r)
      : [...allRecords, { startDate, days: parsedDays }]
    const chainResult = validateRecordsChain(settings, candidateRecords, today)
    if (!chainResult.valid) {
      warnings.push({
        id: 'overspend', tier: 'error', scope: 'form', field: 'days',
        touchedKeys: ['startDate', 'days'],
        message: '這筆請假超支可用額度上限，請確認天數是否正確',
      })
    }
  }

  return warnings
}
```

**邊界情境**：`-0.1` 這種值會同時觸發 `days-positive` 與 `days-quarter-step`（W4 明確允許）。`days` 非空但 `parseFloat` 出 `NaN`（理論上打不到，`<input type="number">` 對無效中繼狀態回報空字串）時，寫成 `!(parsedDays > 0)` 涵蓋 `NaN`，不特判。

### 6.2 `leaveFormValidation.test.js`

覆蓋空值/有值分岔、「只有基本欄位都合法才會跑超支檢查」的短路邏輯，以及 W4 允許的 `days-positive`/`days-quarter-step` 同時觸發案例。

### 6.3 State 改動

```js
const [touched, setTouched] = useState({})
// 不再有 error/setError，也不再有獨立的 fieldWarnings state —— 改用 useMemo 衍生：
const fieldWarnings = useMemo(
  () => computeLeaveFormWarnings({ startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today }),
  [startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today]
)
```

刪除舊 `validate()` 函式，邏輯併入 `computeLeaveFormWarnings`。

### 6.4 事件處理點（對照現有行號）

- **日期 input**（現 99 行附近）：`onChange` 只做 `setStartDate(e.target.value)`；`onBlur` 標記 `touched.startDate = true`。
- **天數 input**（現 116-124 行）：`onChange` 從 `setDays(e.target.value); setError('')` 改成單純 `setDays(e.target.value)`；新增 `onBlur` 標記 `touched.days = true`。
- **quick-pick 按鈕**（現 127-141 行）：`onClick={() => setDays(n)}` 改成 `onClick={() => { setDays(n); setTouched(t => ({ ...t, days: true })) }}`（W16）。
- **`selectedDate`/`editingRecord` 合併 effect**（現 26-36 行）：維持單一 effect，只做 `setStartDate`/`setDays`/`setTouched`：
  - `editingRecord` 分支：`setTouched({ startDate: true, days: true })`。
  - `selectedDate` 分支：`setTouched(t => ({ ...t, startDate: true }))`（`days` 重置為 1，不強制標記，靠「任一 touched」設計讓超支警示仍正確顯示）。
- **`resetForm`**（現 75-80 行）：`setStartDate('')`、`setDays(1)`、`setTouched({})`。
- **刪除記錄 / `allRecords` 因其他操作改變**：**不需要新增任何事件處理代碼**——`useMemo` 的依賴陣列已經包含 `allRecords`，`onDelete` 觸發的 prop 更新會自動讓 `fieldWarnings` 在下一次 render 重新衍生，`disabled` 自動反映最新結果。

### 6.5 送出按鈕與 `handleSubmit`

```jsx
<button
  onClick={handleSubmit}
  disabled={fieldWarnings.some(w => isBlocking(w.tier))}
  className="px-4 py-1.5 bg-teal-700 text-white text-sm font-medium rounded
             hover:bg-teal-800 transition-colors
             disabled:opacity-40 disabled:hover:bg-teal-700"
>
  {isEditing ? '儲存變更' : '新增'}
</button>
```

```js
function handleSubmit() {
  if (fieldWarnings.some(w => isBlocking(w.tier))) return // 純防禦，不依賴它當安全網
  const parsedDays = parseFloat(days)
  if (isEditing) {
    onUpdate(editingRecord.id, { startDate, days: parsedDays })
  } else {
    onAdd({ startDate, days: parsedDays })
  }
  resetForm()
}
```

### 6.6 顯示層

```js
const startDateWarnings = fieldWarnings.filter(w =>
  w.scope === 'field' && w.field === 'startDate' && isWarningVisible(w, touched))
const daysWarnings = fieldWarnings.filter(w =>
  w.scope === 'field' && w.field === 'days' && isWarningVisible(w, touched))
const formWarnings = fieldWarnings.filter(w =>
  w.scope === 'form' && isWarningVisible(w, touched))
```

`startDateWarnings`/`daysWarnings` 各自傳給對應欄位下方的 `<FieldWarnings />`；`formWarnings`（目前只會有 `overspend` 一條）放在原本 `error` 顯示的位置（兩欄 grid 下方、按鈕列之上），同樣用 `<FieldWarnings warnings={formWarnings} />`。三個子集互斥，`overspend` 不會同時出現在天數欄位下方。

### 6.7 e2e（`e2e/calendar-and-records.spec.js` + 新增兩份既有 spec）（round 3 修訂：W16 回歸測試補上前置 seed，回應次要項 #3）

- 改寫 132-139 行（日期超出範圍）：fill → `.blur()` → 斷言錯誤文字可見（`{ exact: true }`）+ 按鈕 `toBeDisabled()`，不再點按鈕。
- 改寫 141-150 行（超支）：同理。
- 新增 B1 回歸測試：天數打完合法值不 blur、直接點新增，斷言送出成功。
- **新增 W16 回歸測試（round 3 修訂）**：先 seed 一筆既有記錄用滿本期額度（例如本期額度 7 天，seed 一筆用滿全部額度的記錄，剩餘額度 0 天——沿用刪除記錄那條測試的 seed 手法）；開啟頁面後全程不對日期 input 做任何操作（不 focus、不 blur，直接不碰它），只透過點月曆選一個還沒被 seed 記錄佔用的合法日期（天數同樣不碰，維持預設值 1，剩餘額度 0 天下任何新選日期天數 1 都必然超支）→ 斷言超支警示可見、新增按鈕 `toBeDisabled()`。「日期 input 從未被 focus 過」不需要額外斷言 API，靠測試程式碼本身「全程不對它呼叫任何操作」保證，確保這條測試測的是「只透過點月曆」這條路徑。
- 新增初始狀態測試：未互動時無警示文字可見，但按鈕 disabled。
- 新增 blur 空日期測試：斷言「請選擇請假開始日期」可見。
- 新增 0.25-倍數錯誤測試。
- 刪除記錄後超支自動解除測試：seed 一筆既有記錄（本期額度 7 天，seed 一筆 5 天），開啟頁面後點月曆選一個合法日期、天數填 3（會超過剩餘 2 天）→ 斷言超支警示可見、新增按鈕 disabled；不對表單做任何其他操作，直接在記錄列表刪除那筆 seed 記錄 → 斷言警示自動消失、按鈕自動變回 enabled，不需要重新操作表單欄位（驗證 `useMemo` 依賴 `allRecords` 這條路徑，見 §2）。
- 改寫 `e2e/period-tabs.spec.js:63-92`：拿掉 `page.getByRole('button', { name: '儲存變更' }).click()`，改成 fill 完天數後直接斷言 `getByText('這筆請假超支可用額度上限，請確認天數是否正確', { exact: true })` 可見、`儲存變更` `toBeDisabled()`、`record-days` 仍是「1 天」。
- 改寫 `e2e/carryover.spec.js:101-128`，同樣拿掉 `.click()`，斷言超支文字可見（`exact: true`）、`儲存變更` disabled、`record-days` 仍是「15 天」。

---

## 7. Commit 3 — `Settings.jsx` 移除全部 `alert()`（`Fixes #46`）

必須與 e2e 改寫同一個 commit。合規清單（advisory）沿用既有變數名 `warnings`，不改成 `complianceWarnings`——W7 要求合規清單完全不動，保留原名最省事；新機制的變數統一叫 `fieldWarnings`，兩者靠命名區分。

### 7.1 `settingsValidation.js` 改寫

`validateSettingsInput` 原地改寫，簽名不變，回傳 `Warning[]`。結構沿用現有巢狀方式（到職日檢查在最外層；清單空值、逐列、門檻重複、perYear、cap 全部包在**同一個** `ruleType === 'custom'` 分支裡）。

```js
export function validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap }) {
  const warnings = []

  if (!onboardDate) {
    warnings.push({
      id: 'onboardDate-incomplete', tier: 'incomplete', scope: 'field', field: 'onboardDate',
      touchedKeys: ['onboardDate'], message: '請填寫到職日',
    })
  }

  if (ruleType === 'custom') {
    if (customRules.length === 0) {
      warnings.push({
        id: 'customRules-empty', tier: 'error', scope: 'form', field: 'months',
        touchedKeys: [], message: '請至少保留一條自訂規則',
      })
    }

    // 逐列驗證：W9 空值判斷讀「原始值」，不能先 Number() 再判斷
    // （Number('') === 0，不是 NaN，會被誤判成「非正整數」而不是「未完成」）。
    for (const r of customRules) {
      const monthsIsEmpty = r.months === '' || r.months === null || r.months === undefined
      if (monthsIsEmpty) {
        warnings.push({
          id: `row-${r.id}-months-incomplete`, tier: 'incomplete', scope: 'row', rowId: r.id,
          field: 'months', touchedKeys: [`${r.id}:months`], message: '請填寫年資門檻',
        })
      } else {
        const monthsNum = Number(r.months)
        if (!Number.isInteger(monthsNum) || monthsNum < 1 || monthsNum > MAX_MILESTONE_MONTHS) {
          warnings.push({
            id: `row-${r.id}-months-invalid`, tier: 'error', scope: 'row', rowId: r.id, field: 'months',
            touchedKeys: [`${r.id}:months`],
            message: `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`,
          })
        }
      }

      const daysIsEmpty = r.days === '' || r.days === null || r.days === undefined
      if (daysIsEmpty) {
        warnings.push({
          id: `row-${r.id}-days-incomplete`, tier: 'incomplete', scope: 'row', rowId: r.id,
          field: 'days', touchedKeys: [`${r.id}:days`], message: '請填寫天數',
        })
      } else {
        const daysNum = Number(r.days)
        if (!(Number.isFinite(daysNum) && daysNum > 0)) {
          warnings.push({
            id: `row-${r.id}-days-positive`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: '天數須大於 0',
          })
        }
        if (Number.isFinite(daysNum) && daysNum > MAX_ANNUAL_LEAVE_DAYS) {
          warnings.push({
            id: `row-${r.id}-days-max`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: `天數不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
          })
        }
        if (!isQuarterStep(daysNum)) {
          warnings.push({
            id: `row-${r.id}-days-quarter-step`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: '天數須為 0.25 的倍數',
          })
        }
      }
    }

    // 門檻重複偵測（W15：只比對「兩列都已經是合法正整數、且數值相同」的情況）
    const validMonthsRows = customRules.filter(r => {
      const n = Number(r.months)
      const monthsIsEmpty = r.months === '' || r.months === null || r.months === undefined
      return !monthsIsEmpty && Number.isInteger(n) && n >= 1 && n <= MAX_MILESTONE_MONTHS
    })
    const groups = new Map() // monthsNum -> rowId[]
    for (const r of validMonthsRows) {
      const n = Number(r.months)
      if (!groups.has(n)) groups.set(n, [])
      groups.get(n).push(r.id)
    }
    for (const [monthsNum, rowIds] of groups) {
      if (rowIds.length < 2) continue
      for (const rowId of rowIds) {
        warnings.push({
          id: `row-${rowId}-months-duplicate-${monthsNum}`, tier: 'error', scope: 'form',
          rowId, field: 'months', touchedKeys: [`${rowId}:months`],
          dedupeKey: `months-duplicate-${monthsNum}`,
          message: `年資門檻「${monthsNum} 個月」重複，請合併或刪除其中一列`,
        })
      }
    }

    const perYearIsEmpty = growthPerYear === '' || growthPerYear === null || growthPerYear === undefined
    if (perYearIsEmpty) {
      warnings.push({
        id: 'growthPerYear-incomplete', tier: 'incomplete', scope: 'field', field: 'growthPerYear',
        touchedKeys: ['growthPerYear'], message: '請填寫每年增加天數',
      })
    } else {
      const perYearNum = Number(growthPerYear)
      if (!(Number.isFinite(perYearNum) && perYearNum >= 0)) {
        warnings.push({
          id: 'growthPerYear-nonnegative', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: '每年增加天數須大於等於 0',
        })
      }
      if (Number.isFinite(perYearNum) && perYearNum > MAX_ANNUAL_LEAVE_DAYS) {
        warnings.push({
          id: 'growthPerYear-max', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: `每年增加天數不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
        })
      }
      if (!isQuarterStep(perYearNum)) {
        warnings.push({
          id: 'growthPerYear-quarter-step', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: '每年增加天數須為 0.25 的倍數',
        })
      }

      // cap 只在 perYearNum > 0 時才驗證（perYear === 0 時欄位本來就停用）。
      // 這個 gate 跟 Settings.jsx 裡 cap 輸入框的 disabled 條件
      // （growthPerYear !== '' && Number(growthPerYear) === 0）不完全對稱：
      // perYear 為空或負數時，cap 輸入框在 UI 上仍可編輯但這裡不驗證它。
      // 這是刻意接受的不對稱——perYear 本身的 incomplete/error 已經會擋住
      // 儲存，cap 驗不驗證不影響最終能不能送出。
      if (perYearNum > 0) {
        const capIsEmpty = growthCap === '' || growthCap === null || growthCap === undefined
        if (capIsEmpty) {
          warnings.push({
            id: 'growthCap-incomplete', tier: 'incomplete', scope: 'field', field: 'growthCap',
            touchedKeys: ['growthCap'], message: '請填寫天數上限',
          })
        } else {
          const capNum = Number(growthCap)
          if (Number.isFinite(capNum) && capNum > MAX_ANNUAL_LEAVE_DAYS) {
            warnings.push({
              id: 'growthCap-max', tier: 'error', scope: 'field', field: 'growthCap',
              touchedKeys: ['growthCap'], message: `天數上限不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
            })
          }
          if (!isQuarterStep(capNum)) {
            warnings.push({
              id: 'growthCap-quarter-step', tier: 'error', scope: 'field', field: 'growthCap',
              touchedKeys: ['growthCap'], message: '天數上限須為 0.25 的倍數',
            })
          }

          // cap-min-lastrow（W15：只要任何一列的 months 有 blocking 警示，整條跳過；
          // 重用既有 getLastRuleDays 取得天數）：
          const anyMonthsBlocking = warnings.some(w => w.field === 'months' && isBlocking(w.tier))
          if (!anyMonthsBlocking && customRules.length > 0) {
            const lastRow = customRules.reduce((a, b) => (Number(b.months) > Number(a.months) ? b : a))
            const lastRowDaysBlocking = warnings.some(
              w => w.rowId === lastRow.id && w.field === 'days' && isBlocking(w.tier)
            )
            if (!lastRowDaysBlocking) {
              const lastDays = getLastRuleDays(customRules)
              if (Number.isFinite(capNum) && capNum < lastDays) {
                warnings.push({
                  id: 'growthCap-min-lastrow', tier: 'error', scope: 'field', field: 'growthCap',
                  touchedKeys: ['growthCap', `${lastRow.id}:days`],
                  message: `天數上限不可低於最後一列的天數（${lastDays} 天）`,
                })
              }
            }
          }
        }
      }
    }
  }

  return warnings
}
```

`anyMonthsBlocking` 用 `field === 'months'` 判斷（不分 `scope`），因為個別列不合法（`scope: 'row'`）與門檻重複（`scope: 'form'`）都要視為「來源欄位不可靠」而跳過整條 cap-min-lastrow 檢查（W15）。`lastRow` 只負責找出「`months` 最大的那一列」（供 `touchedKeys`、`lastRowDaysBlocking` 使用）；實際天數數值改用 `getLastRuleDays(customRules)`，兩者找的是同一列，因為前置條件已經保證所有列 `months` 合法且不重複，不會有歧義。`getLastRuleDays` 已存在於同一個檔案內，不需額外 import。

### 7.2 `settingsValidation.test.js` 改寫（round 3 新增門檻重複的兩 `rowId` 覆蓋，回應觀察 #3）

既有斷言字串/null 全部改成斷言陣列內容。新增覆蓋：

- W4：三條天數條件獨立觸發（自訂規則天數、`perYear`、`cap` 各自）。
- W12：兩組不同數值重複各自產生獨立 `dedupeKey`。
- **（round 3 新增）** W12：同一組重複的兩個 `rowId` 都各自產生一則 `tier: 'error'`、`dedupeKey` 相同的 warning——這件事在 UI 上因為 `dedupeBy` 而觀察不到（集中清單最多只顯示 1 行），必須靠單元測試直接讀 `validateSettingsInput` 回傳的原始陣列驗證，不能只靠 e2e。
- W15：任一列 `months` 不合法時 `growthCap-min-lastrow` 不出現；所有列 `months` 合法但最後一列 `days` 本身不合法時，`growthCap-min-lastrow` 也不出現。
- `growthCap-min-lastrow` 的 `touchedKeys` 同時含 `growthCap` 與 `${lastRowId}:days`。
- `ruleType: 'labor'` 時，即使 `customRules`/`growthPerYear` 帶不合法的值，回傳結果只有 `onboardDate` 相關的項目。
- W9：`months`/`days` 原始值是空字串時回報 `incomplete`，不是 `error`。
- `growthCap-min-lastrow` 的天數計算改用 `getLastRuleDays` 後，結果與手動計算版本一致（用一組跨月份亂序的 `customRules` 驗證）。

### 7.3 `Settings.jsx` 改寫

- 新增 `touched` state；`fieldWarnings` 改用 `useMemo` 衍生：
  ```js
  const fieldWarnings = useMemo(
    () => validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap }),
    [onboardDate, ruleType, customRules, growthPerYear, growthCap]
  )
  ```
  移除 `alert(error)` 與 `handleSave` 裡原本呼叫 `validateSettingsInput` 的那一段。合規清單的既有 `warnings`/`setWarnings`/`useEffect` 完全不動，變數名保持 `warnings`，不改成 `complianceWarnings`（W7）。
- `onboardDate` input：`onChange={e => setOnboardDate(e.target.value)}`；`onBlur` 標記 `touched.onboardDate = true`。
- 每列的月數/天數 input（`updateCustomRule`）：`onChange` 維持現有呼叫方式不變（`updateCustomRule(id, field, e.target.value)`）；新增 `onBlur` 標記 `touched[`${rowId}:months`]`/`touched[`${rowId}:days`]` = true。
- **`addCustomRule`（落實維護者方案 (c)，出處見 §2、§11）**：
  ```js
  function addCustomRule() {
    const sorted = [...customRules].sort((a, b) => a.months - b.months)
    const lastMonths = sorted.length > 0 ? Number(sorted[sorted.length - 1].months) || 0 : 0
    const newId = uuidv4()
    setCustomRules(prev => [...prev, { id: newId, months: lastMonths + 12, days: 15 }])
    setTouched(t => ({ ...t, [`${newId}:months`]: true, [`${newId}:days`]: true }))
  }
  ```
  這是經維護者確認、覆寫 concept W16 最後一句的例外——`removeCustomRule` 和 `ruleType` 切換維持原判斷，不標記 touched。
- `removeCustomRule`：維持現有實作不變，不標記 touched。
- `RuleTypeCard` 的 `onClick`（切換 `ruleType`）：維持現有 `setRuleType` 呼叫不變，不標記 touched。
- `growthPerYear`/`growthCap` input：`onChange` 維持現有呼叫不變；新增 `onBlur` 標記 `touched.growthPerYear`/`touched.growthCap = true`。
- **顯示層**：
  ```js
  const onboardDateWarnings = fieldWarnings.filter(w =>
    w.scope === 'field' && w.field === 'onboardDate' && isWarningVisible(w, touched))
  const rowMonthsWarnings = rule => fieldWarnings.filter(w =>
    w.scope === 'row' && w.rowId === rule.id && w.field === 'months' && isWarningVisible(w, touched))
  const rowDaysWarnings = rule => fieldWarnings.filter(w =>
    w.scope === 'row' && w.rowId === rule.id && w.field === 'days' && isWarningVisible(w, touched))
  const formWarnings = fieldWarnings.filter(w => w.scope === 'form' && isWarningVisible(w, touched))
  const dedupedFormWarnings = dedupeBy(formWarnings, w => w.dedupeKey ?? w.id)
  const growthPerYearWarnings = fieldWarnings.filter(w =>
    w.scope === 'field' && w.field === 'growthPerYear' && isWarningVisible(w, touched))
  const growthCapWarnings = fieldWarnings.filter(w =>
    w.scope === 'field' && w.field === 'growthCap' && isWarningVisible(w, touched))
  ```
  `onboardDateWarnings` 渲染在到職日 input 下方（不分 `ruleType`，到職日檢查兩種規則類型都適用）；`growthPerYearWarnings` 渲染在 `custom-growth-row` 裡每年增加天數欄位下方；`growthCapWarnings`（含 `cap-min-lastrow`）渲染在同一列的天數上限欄位下方；`dedupedFormWarnings`（含門檻重複、規則清單為空）渲染在表格上方的獨立小區塊；每列旁邊只渲染 `rowMonthsWarnings`/`rowDaysWarnings`。集中清單與 inline 兩種顯示互斥。§2 的「`field` 值域 → 渲染位置」核對表已逐一確認這 7 個過濾子集涵蓋 `validateSettingsInput` 會產生的全部 `field` 值。**提醒（round 3）**：`dedupedFormWarnings` 對同一組門檻重複最多只會有 1 個元素，不要預期它會等於「觸發重複的列數」。
- **視覺與物理位置（W13）**：現有合規建議清單（琥珀框，`Settings.jsx:232` 附近）維持在原位置、原樣式（`bg-amber-50 border-amber-200 text-amber-800`，本輪不動）。新增的集中警示清單 `dedupedFormWarnings` 緊接在合規建議清單**下方**、表格**上方**，外層包一個 `<div data-testid="settings-form-warnings">`，內容用純文字清單呈現（不加背景色/邊框，沿用 `<FieldWarnings />` 的 `text-xs text-red-600`/`text-stone-500` 樣式），刻意不做成卡片/框——一個有底色邊框、一個是純文字，加上物理上下相鄰但視覺明顯不同，同時滿足「顏色」與「位置」都能分辨。`settings-form-warnings` 這個 testid 是本輪新增 UI 的例外，不違反「不新建 test hook」規則——那條規則只管既有的 `custom-rule-row`/`custom-growth-row`。
- 儲存按鈕：
  ```jsx
  <button
    onClick={handleSave}
    disabled={fieldWarnings.some(w => isBlocking(w.tier))}
    className="px-5 py-2 bg-teal-700 text-white text-sm font-medium rounded-md
               hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500
               focus:ring-offset-1 transition-colors
               disabled:opacity-40 disabled:hover:bg-teal-700"
  >
    儲存設定
  </button>
  ```
- `handleSave`：
  ```js
  function handleSave() {
    if (fieldWarnings.some(w => isBlocking(w.tier))) return // 純防禦，不依賴它當安全網
    // ...原本存檔邏輯不變
  }
  ```

### 7.4 e2e（`onboarding-and-settings.spec.js`）（round 3 修訂：門檻重複對照表列、「到職日留空」測試步驟，回應重要項 #1、次要項 #2、觀察 #2）

**8 個 dialog 測試逐一對照 HEAD 實際行號、情境、觸發值與新斷言**：

| HEAD 行號 | 情境 | 觸發值 | 新斷言 |
|---|---|---|---|
| 112-131 | 門檻重複 | 兩列 `months` 填同一個數字 | **（round 3 修訂）** error「年資門檻「X 個月」重複，請合併或刪除其中一列」的 warning 各自掛在兩列（`rowId` 各自對應）；只 blur 其中一列的 `months` 欄位後，集中清單（`settings-form-warnings`）內斷言**恰好 1 行**——兩則 warning 共用同一個 `dedupeKey`，`dedupeBy` 只會留下先出現的那一筆代表，不是「各自顯示一行」（跟下方 C3 兩組**不同數值**的重複不同，那邊 `dedupeKey` 不同才會各自保留、合計 2 行） |
| 146-163 | 門檻超過上限 | `months` 填 >1200 | error「年資門檻請填寫 1200 個月（100 年）以內的正整數」掛在該列 months 欄位旁 |
| 180-202 | 天數欄位只打負號 | `daysInput.pressSequentially('-')` | 瀏覽器層級 `.value` 回報空字串 → incomplete「請填寫天數」掛在該列 days 欄位旁 |
| 264-280 | 每年增加天數留空 | `growthPerYear` 清空 | incomplete「請填寫每年增加天數」掛在 `growthPerYearWarnings` 位置 |
| 282-297 | cap 低於最後一列 | `growthCap` 填 `10`（小於最後一列天數） | error「天數上限不可低於最後一列的天數（X 天）」掛在 `growthCapWarnings` 位置 |
| 299-314 | cap 非 0.25 倍數 | `growthCap` 填 `20.1` | error「天數上限須為 0.25 的倍數」掛在 `growthCapWarnings` 位置 |
| 349-365 | 特休天數超過上限且非倍數 | 某列 `days` 填 `365.1` | error「天數不可超過 365 天」+「天數須為 0.25 的倍數」（兩條同時，W4）掛在該列 days 欄位旁 |
| 367-391 | C4：每年增加天數改回 0 | `growthPerYear` 填 `0` | **正向測試**：儲存設定按鈕 enabled → 點擊 → 導覽到主頁（`page.getByText('到職日：')` 可見）→ `localStorage` 的 `customGrowth` 仍是 `{ perYear: 0, cap: 0 }`（既有斷言不變） |

**7 個負向測試**套用模板：觸發欄位變動 + blur → 斷言 `getByText(..., { exact: true })` 可見（涉及自訂規則列/成長列一律先用 `page.getByTestId('custom-rule-row'|'custom-growth-row')` 縮小範圍，必要時搭配 `.filter({ has: page.locator('input[value="N"]') })`）+ 儲存按鈕 `toBeDisabled()`，不再點擊儲存設定去觸發 `dialog`。**（round 3 補充）明確排除「直接點擊儲存按鈕觸發」這個路徑**——concept plan Commit 3 e2e 段落原文寫過「改成先觸發對應欄位的值變動（或直接點擊儲存按鈕），再 expect(...)」，但在 blocking 狀態下按鈕本身是 disabled，點擊既觸發不了 `.click()` 的等待（會逾時）、也不會標記任何欄位 touched，只有「改值/互動 + blur」這條路徑對三層警示都成立，實作時不要照抄 concept 那句話裡的備選寫法。**第 367-391 行（C4）是正向測試**，拿掉 `page.once('dialog', ...)`，照上表改寫。

**「到職日留空」不是既有 dialog 測試，是覆蓋缺口，獨立新增（round 3 修訂，回應次要項 #2）**：切到設定頁 → 先斷言儲存按鈕 `disabled` 且「請填寫到職日」不可見（順便覆蓋 touched 過濾的正向情境）→ 對 `input[type="date"]` 依序 `.focus()` 再 `.blur()`（不輸入值，只觸發 touched）→ 斷言「請填寫到職日」可見（`{ exact: true }`）、儲存按鈕仍 `disabled`。**不要**寫成「不填到職日直接嘗試儲存」——按鈕一開始就是 disabled，`.click()` 會等到 enabled 才觸發、最終逾時，而且點擊本身不會標記到職日的 touched。「規則清單為空」因 UI 已用「刪除鈕在剩一列時 disabled」防止正常操作走到這裡，只留單元測試涵蓋，不寫假的 e2e。

**其餘新增測試**：

- `ruleType` 雙向切換回歸（C1）：儲存按鈕 disabled 狀態與合規清單立即反映新 `ruleType`，不需要額外互動。
- 兩組不同數值的重複門檻各自顯示一行（C3）：`page.getByTestId('settings-form-warnings')` 容器內斷言有兩行不同文字，各自 `{ exact: true }`（這裡的「各自顯示一行」成立，因為兩組 `dedupeKey` 不同，跟上表 112-131 那列同一組重複只顯示 1 行不衝突）。
- B2 回歸——`anyMonthsBlocking` 分支：自訂規則某一列 `months` 目前是空值/不合法時，`growthCapWarnings` 位置不應該顯示「不可低於 X 天」這種帶著無意義數值的訊息。
- B2 回歸——concept 原版指定的 `lastRowDaysBlocking` 分支：把月數最大的那一列（例如 120 個月）的天數欄位清空（或填 `-5`），天數上限欄位填 `10`，blur 天數上限欄位後，斷言 `custom-growth-row` 容器內看不到任何以「天數上限不可低於最後一列的天數」開頭的文字（用前綴/正則比對，不能用 `{ exact: true }`，因為要驗證的是「完全不出現任何數值版本」），且儲存設定按鈕維持 disabled（天數欄位本身的 incomplete/error 仍在阻擋）。
- `ruleType: 'labor'` 時舊警示不殘留：從勞基法預設狀態切到「公司另有規定」，把某一列天數清空、把每年增加天數清空（製造 blocking 警示且儲存按鈕 disabled），接著切回「勞基法標準」，斷言儲存按鈕變回 enabled（到職日已填）、畫面上看不到任何自訂規則/成長列相關的警示文字（因為 `ruleType === 'labor'` 分支本來就不會產生這些警示，且對應欄位已 unmount）。
- 把最後一列月數改到 ≥1189 後按「新增規則」，新列的月數錯誤要立即可見（不必碰新列）。
- 「到職日留空」測試（見上）。

### 7.5 `e2e/resignation.spec.js`

第 62-71 行改寫：

```js
test('未儲存設定時「離職重來」為 disabled', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '前往設定' }).click()

  await expect(page.getByRole('button', { name: '離職重來' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '離職重來' })).toHaveCSS('cursor', 'not-allowed')
  // reverse assertion: an always-enabled control must not show the forbidden cursor
  await expect(page.getByRole('button', { name: '取消' })).toHaveCSS('cursor', 'pointer')
  await expect(page.locator('input[type="date"]')).not.toHaveCSS('cursor', 'not-allowed')
  // new: 到職日空白時屬於 incomplete，儲存設定一載入就該是 disabled（W14 回歸）
  await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '儲存設定' })).toHaveCSS('cursor', 'not-allowed')
})
```

第 185-217 行（鎖定頁合規清單測試）**維持不動**——只斷言 `table tbody tr input[type="number"]` 全部 disabled 與合規文字在載入時可見，跟本輪 `fieldWarnings`/`touched` 機制無關，因為鎖定頁「儲存設定」按鈕根本不渲染（`{!isLocked && (...)}`）。

---

## 8. Commit 4 — 收尾（`Refs #46`）

- `grep -rn "page.once('dialog'" e2e/` 確認零殘留。
- `grep -rn "alert(" src/components/` 確認零殘留。
- 文案覆核：本輪新增的所有中文使用者可見字串，沿用既有規則用全形標點「：」「，」「（」「）」——對照 §6.1、§7.1、§7.4 的訊息表逐條檢查。
- 補齊本輪新增行為、但 Commit 2/3 可能還沒覆蓋到的 e2e case：
  - touched 過濾（欄位沒 touched 過就不顯示訊息，但按鈕仍正確反映真實阻擋狀態）。
  - 兩層警示清單（blocking vs advisory）同時出現時，物理位置與樣式確實不同（可用 `settings-form-warnings` 與合規琥珀框的 bounding box 相對位置斷言）。
  - **（round 3 修訂，回應觀察 #3）**「門檻重複」的 warning 物件各自帶有正確門檻數值且各自對應到兩個不同 `rowId`——這件事在 UI 上觀察不到（集中清單因 `dedupeBy` 共用同一個 `dedupeKey`，即使兩列都 touched 也只會顯示 1 行代表）。改成兩種斷言分工：單元測試（§7.2）直接讀 `validateSettingsInput` 回傳的原始陣列，斷言兩個 `rowId` 都各自有一則 `tier: 'error'`、`dedupeKey` 相同的 warning；e2e 則分別只 blur 其中一列的 `months` 輸入框（一次一列），驗證兩種情況下訊息都能正確顯示在集中清單（各自斷言「恰好 1 行」，不要同時 blur 兩列去找 2 行）。
- 本節所有斷言比照 §7.4 的規則，一律 `{ exact: true }`（例外：§7.4 的 `lastRowDaysBlocking` 回歸測試因為要驗證「完全不出現」而用前綴/正則）+ testid 範圍限定。

---

## 9. 邊界情境彙整

1. B1 死路已被 W6 結構性解決（計算/顯示分離，`disabled` 永遠讀最新衍生結果）。
2. `fieldWarnings` 改用 `useMemo` 衍生後，任何相關 state/prop 改變（包含刪除記錄這種原本沒被 concept plan §3.4 列舉到的路徑）都會自動觸發重算，不再需要窮舉「哪些操作要顯式呼叫重算函式」。
3. W16 主流路徑（點月曆、quick-pick、Settings 非文字輸入）都要顯式呼叫 `setTouched`，漏掉會出現「按鈕 disabled 但無警示文字」的死角；round 2 阻擋項就是這個死角的另一種變體：`field` 本身沒有渲染出口，即使 touched 標記正確也看不到訊息（見 §2 的核對表）。
4. W15 跨欄位檢查前置條件：`cap-min-lastrow`、門檻重複都要先確認來源欄位（含「哪一列是最後一列」這件事本身依賴的所有列 `months`）無 blocking 警示。`lastRowDaysBlocking` 與 `anyMonthsBlocking` 是兩條不同分支，都要測。
5. `isQuarterStep(Infinity)` 與 `isQuarterStep(Number.MAX_VALUE)` 是兩條不同的邊界路徑，前者在 `Number.isFinite` 被擋、後者才是 `x*4` 真正溢位的路徑，兩者都是刻意接受的行為，不是 bug（round 3 已修正 §5.1 程式註解跟這一點自相矛盾的描述）。
6. `touchedKeys`「任一命中」規則適用所有跨欄位/跨列警示，包含 `cap-min-lastrow` 這條需要同時含 `growthCap` 與最後一列 `days` 兩個 key。
7. 門檻重複 `scope: 'form'` 但仍帶 `rowId`/`field`，`scope` 決定位置、其餘是輔助資料，不衝突。
8. 鎖定頁所有輸入框 disabled，不可能觸發 touched，這正是合規清單刻意不套用 touched 的原因（W7），`fieldWarnings`/`touched` 機制不影響鎖定頁，因為鎖定時「儲存設定」按鈕根本不渲染。
9. `resignation.spec.js:62-71` 的按鈕 cursor 反向斷言改用「取消」按鈕，「儲存設定」新增明確的 disabled 斷言。
10. `overspend`/門檻重複這類 `scope: 'form'` 的警示，顯示邏輯上跟逐欄位/逐列 inline 是兩個互斥管道，不會同時出現在兩個地方，避免同一則文字重複渲染導致 Playwright strict-mode 失敗。
11. `addCustomRule` 新列現在會自動標記 touched（維護者方案 c，出處見 §2、§11），`removeCustomRule`/`ruleType` 切換維持不標記——這是唯一覆寫 W16 最後一句的例外。
12. `cap-min-lastrow` 的天數數值透過 `getLastRuleDays` 取得，與 `getCustomCapMin`（cap 輸入框 `min` 屬性用的函式）共用同一套換算邏輯，不會出現「計算 cap 下限」跟「驗證 cap 是否低於下限」兩處各自算出不同答案的風險。
13. `period-tabs.spec.js`、`carryover.spec.js` 各有一支既有編輯超支測試，依編輯模式進入時就會標記 touched 的既有設計（§6.4），天數一改完警示就可見，不需要額外 blur，也不能再點擊已經 disabled 的「儲存變更」。
14. `onboardDate`、`growthPerYear` 這兩個 `field` 值需要對應的渲染出口 `onboardDateWarnings`、`growthPerYearWarnings`；`§2` 的核對表是為了防止這類「算了但沒地方顯示」的問題再次發生的通用機制。
15. LeaveForm 用 `activePeriod.milestoneMonths` 當 key，切分頁會 remount，`touched` 自然重置；`handleCancelEdit` 會同時清掉 `selectedDate`，`resetForm` 之後 sync effect 不會誤把 `startDate` 標成 touched——這兩點不影響任何設計決定，但實作時可以放心假設它們成立。
16. **（round 3 新增，回應 Reviewer notes 觀察 #2、#3）** 門檻重複同一組（相同 `monthsNum`）的兩則警示共用同一個 `dedupeKey`，集中清單即使兩列都 touched 也只會顯示 1 行（`dedupeBy` 保留先出現的那一筆代表）；要驗證「兩列都各自產生 warning」要用單元測試讀原始陣列，不能觀察 UI。不同 `monthsNum` 的兩組重複（C3 情境）才會各自保留、在集中清單合計顯示 2 行。

## 10. 驗證計畫

1. 單元測試全綠（`warnings.test.js`——含 `dedupeBy`、`leaveFormValidation.test.js`、改寫後的 `settingsValidation.test.js`，含 `getLastRuleDays` 一致性回歸與 round 3 新增的門檻重複兩 `rowId` 覆蓋；既有其他測試不受影響）。
2. e2e 全綠，共 5 份改動 spec：`calendar-and-records.spec.js`、`onboarding-and-settings.spec.js`、`resignation.spec.js`、`period-tabs.spec.js`、`carryover.spec.js`。
3. 手動過一次 concept plan §6 驗收清單：首次進入無警示文字但按鈕 disabled、不 blur 直接點新增能成功、點月曆觸發超支正確顯示、兩組門檻重複各自顯示、鎖定頁合規清單仍即時可見、刪除記錄後超支警示自動消失（seed 版本，見 §6.7）、編輯既有記錄改到超支值時按鈕正確變 disabled（不能再點擊）。
4. `grep -rn "alert(" src/components/` 與 `grep -rn "page.once('dialog'" e2e/` 確認零殘留。
5. 確認同一則警示訊息不會同時出現在 inline 與集中清單兩個位置（針對超支、門檻重複各手動核對一次）；針對門檻重複另外核對「同一組重複最多只顯示 1 行」這件事（round 3 新增核對項）。
6. 手動核對 §2 的「`field` 值域 → 渲染位置」表：對 `computeLeaveFormWarnings`、`validateSettingsInput` 會產生的每一個 `field` 值，逐一觸發一次，確認畫面上都能看到對應文字（不只是按鈕變 disabled）。
7. 手動核對 `settings-form-warnings` 區塊與合規琥珀框的視覺差異與相對位置，確認 W13「物理位置分開」真的成立。

## 11. 維護者決定紀錄

- **`addCustomRule` 新列月數可能超過 1200 個月上限**：維護者已選擇方案 (c)（結構性新增的列自動標記 touched，理由是這件事跟 LeaveForm 編輯模式回填既有記錄是同一種情境——「回填」而非「空白新欄位」）。**這個決定記載於本實作計畫（round 1 起），不是 concept plan 正式文本的規定**——concept plan 的 W16 原文仍寫「不用額外標記 touched」。若要讓這條規則正式進入 concept plan 文本，需要另一輪 concept plan 層級的確認，不是這份實作計畫能單方決定的事。`removeCustomRule`、`ruleType` 切換維持原判斷，不受這個例外影響。
- 對應 issue 為 [#46](https://github.com/corytu/annual-leave-calculator/issues/46)：Commit 1、4 標 `Refs #46`，Commit 3 標 `Fixes #46`；Commit 2 不掛 issue 標籤。
- 本版（第五版）處理的都是實作計畫層級的文件/測試正確性修正（程式註解機制寫錯、e2e 觸發步驟做不到、dedup 行為跟斷言預期不符），不涉及任何需要維護者重新確認的 W 決定，不需要額外記錄新的維護者決定。
- 目前沒有其他待確認事項；下一步是把本版送回 Coder/Reviewer 審閱迴圈。
