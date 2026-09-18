# annual-leave-calculator 修正實作計畫(v5,已納入第四輪 Reviewer 意見)

依據:審閱報告 `882e0e7-review-report.md`(審閱版本 commit 882e0e7)、後續討論結論、v2 對第一輪 Reviewer JSON 回饋的修正(`[R2]`–`[R13]`)、v3 對第二輪 Reviewer JSON 回饋的修正(`[I1]`–`[I6]`)、v4 對第三輪 Reviewer JSON 回饋的修正(`[J1]`–`[J4]`),以及本輪(第四輪)Reviewer JSON 回饋(3 條意見,標註為 `[K1]`–`[K3]`)
範圍:P0-1、P0-2、P0-3、P1-1、P2-3、P2-8,以及合規檢查缺口(#35)
對應 issue:#19、#20、#21、#22、#28、#33、#35

---

## 0. 給 Claude Code 的工作守則

1. **一個 PR、八個 commit,依本文順序進行。** 每個 commit 都要做到:
   - 先寫(或改)測試,跑一次確認它**因為預期的原因**失敗;
   - 再修改程式;
   - 最後跑完整的單元測試與 e2e(用 `package.json` 既有的 scripts),全部通過才進下一個 commit。
2. **Commit message 附 issue 關鍵字,並用英文撰寫。** 格式見各 commit 標題,例如 `Fixes #19`、`Refs #35`。
   - 第一行為英文簡述(最多 72 字元),後跟 issue 關鍵字;
   - 若需詳細說明,空一行後用英文撰寫,不用中文。
3. **不做重構。** 「不做的事」清單見第 10 節。碰到清單上的東西,即使順手也不要改。`[I3][I4]` v2 曾因 D16 的雙存檔路徑而預留一個「抽出 `validateGrowth`」的例外;v3 起 D16 改為不開放鎖定後編輯,只剩一條存檔路徑,這個例外已撤銷——成長列的驗證邏輯內聯寫在 `handleSave` 裡,不額外抽函式。`[J1]` 補充:commit 7 對 `handleSave` 的擴充,是延續 commit 3 已經開好的 `if (ruleType === 'custom') { … }` 區塊往下寫驗證,不是開第二個同條件的 `if` 區塊。
4. **命名慣例。**
   - 單元測試標題沿用現有的**英文**寫法,e2e 標題沿用現有的**中文**寫法。
   - 新的程式註解沿用現有風格:英文為主,說明「為什麼」。
   - e2e 註解沿用現有做法,把每個期望數字的來源算給讀者看。
5. **錯誤回饋沿用 `alert()`。** Settings 的驗證錯誤一律用 `alert()`,e2e 沿用 `page.once('dialog', …)` 攔截,不要改成行內錯誤訊息。
6. **沿用字串綁定。** 新增的數字輸入框沿用「state 存原始字串、用到時才 `Number()`」的寫法(先前修掉數字輸入框歸零 bug 時採用的模式),不要綁數值 state。
7. **`[J2][K3]` 本輪所有新增的、使用者可見的中文自然語言字串一律使用全形標點「：」「，」「（」「）」,比照現有程式風格,例如 `Settings.jsx:86` 的「(月數)」、`Settings.jsx:219` 的「滿 {months} 個月:您設定…,勞基法最低…」,以及 `leaveCalculations.js:399` 既有的 `calculateSummary` 訊息。** 這條規則的適用範圍是**本輪新增的所有使用者可見中文字串,不限於特定章節**——alert 訊息(§3、§4、§7)、合規警告清單文字(§9)、月曆副標(§6),都要照這條檢查一遍,不要抄到半形標點。`[K3]` v4 曾把適用範圍字面列舉成「§4/§7/§8/§9」,結果漏掉 §3(commit 2)的 `calculateSummary` message,這條就是實際踩到的例子,現已在 §3 修正,規則本身也改寫成不依賴章節列舉。**排除:`exportCsv.js` 輸出的 CSV 欄位,那裡的逗號是資料格式的分隔符,不是自然語言標點,維持半形不動。**

---

## 1. 已定案的設計決定(實作時不要更動)

以下 D1–D17 與 v3/v4 完全相同,本輪三點意見都是實作/測試層級的修正,沒有動到任何設計決定。

| # | 決定 | 理由 |
|---|---|---|
| D1 | 自訂門檻之間的切點採**往前補**:從每個門檻起每 12 個月切一期,不足一年的零頭放在下一個門檻之前。零頭期間會拿到該門檻的整年天數,不按比例折算(例如門檻 `[6,12,30]`,24~30 個月這段只有 6 個月卻領 24 個月門檻的整年天數)。 | 與「最後一個門檻之後逐年延伸」的既有邏輯一致;也符合「達到門檻即開始完整一年」的欄位語意。報告範例程式是往回補,而且註解與程式碼互相矛盾,**不要照抄**。「零頭期間不折算」是刻意的取捨:折算需要引入按日比例計算的新邏輯,屬於本輪範圍外的功能;commit 1 明確補一條測試釘住這個行為,並在 JSDoc 揭露,避免日後被誤當成 bug 修掉。 |
| D2 | 門檻重複、門檻清單為空的驗證沿用 `alert()`。報告驗證範例中的「天數須為 0.25 倍數」「不可超過 365 天」**不納入**。 | 那兩條屬於 P2-5,不在本輪範圍。這個既有立場也是「成長列上限(cap)不設數值上界」的理由:天數本身沒有上界驗證,cap 卻設上界會造成不一致的政策。 |
| D3 | `calculateSummary` 遇到「自訂規則但沒有任何有效門檻」時,回傳 `hasLeave: false` 並附明確訊息。 | 修正前已存進 localStorage 的空規則資料,因設定鎖定而無法從 UI 修改。 |
| D4 | P1-1、P2-3 都用 `key={activePeriod.milestoneMonths}` 讓元件重建(報告的修法 A),不採用受控 `activeStartDate` 的修法 B。 | 這是 React 慣用的狀態重置方式,改動最小。前提是 `milestoneMonths` 唯一,由 commit 1 的去重保證。 |
| D5 | 點擊「目前已選取的分頁」時什麼都不做(`handleSelectPeriod` 開頭直接 return)。 | 修掉報告未提到的 bug:編輯中點目前分頁會讓表單退回新增模式但保留舊值,再按「新增」會產生重複記錄。 |
| D6 | P2-8 揭露文案為「**圓點只跳過週六日,未考慮國定假日與補班日**」。 | 補班日是「該標卻沒標」,不是「該扣卻沒扣」。 |
| D7 | 新增「成長列」:固定顯示在自訂規則表最下方。左欄唯讀,顯示「滿 {最後門檻+12} 個月起」;右欄為「每年加 X 天,上限 Y 天」。資料存成設定層級的 `customGrowth: { perYear, cap }`,**不放進** `customRules` 陣列。 | 讓照勞基法逐年遞增的公司不必手打十幾列;也讓預設自訂規則在合規檢查修正後不會一打開就出現警告。 |
| D8 | `customGrowth` 的預設值分兩種:**新使用者**在 Settings 預填 `{ perYear: 1, cap: 30 }`;**既有資料**(localStorage 沒有此欄位)載入時補成 `{ perYear: 0, cap: 0 }`,代表「不再增加」。 | 不默默改變既有使用者的天數。這個保守回填會跟 D11 的合規檢查產生交互作用:若既有使用者的自訂門檻剛好等於預設六列(很常見,那組本來就是勞基法對照表),D11 修正後會判定「滿 132 個月起永久不合規」。本輪的因應方式見 D16——不透過打開設定鎖來解,而是把警告改成純資訊性文字。 |
| D9 | `perYear` 為 0 時,上限欄位停用,儲存時 `cap` 一律存成 0。這條只在設定「未鎖定」(新使用者填寫中)時才有意義;鎖定後兩個輸入框一律因 `isLocked` 停用,`perYear===0` 這個額外條件變成多餘但無害。 | `cap` 在不增加時沒有意義。 |
| D10 | `perYear` 須為 ≥ 0、且為 0.25 倍數的數字,不可留空;`perYear > 0` 時,`cap` 不可低於最後一列的天數,且 `cap` 本身也須為 0.25 的倍數。 | 0.25 倍數用浮點數表示沒有誤差,也與請假單位一致。cap 若不是 0.25 倍數,`D + perYear × k` 算出的最終天數(觸頂那一階)可能出現如 16.3 這種不合單位的數字。三個條件(留空/非數字、低於最後一列天數、非 0.25 倍數)各自對應獨立的錯誤訊息,不合併成一句——合併會在「cap 已經 ≥ 最後一列天數、只是精度不合」時,讓使用者看到「不可低於 X 天」這種不成立的錯誤描述。 |
| D11 | 合規檢查改為在「勞基法切點 ∪ 自訂切點」的每一點比較天數,跳過勞基法最低天數為 0 的檢查點(即少於 6 個月的門檻),檢查範圍到兩邊天數都不再變化為止,或到 `MAX_MILESTONE_MONTHS` 為止(見 D14);連續不足的點合併成一個區間,不相鄰的區間各自獨立、不合併。 | 兩邊的天數都只在各自的切點上改變,所以檢查聯集等於檢查所有時間點。恢復「最低天數為 0 就跳過」是延續舊版 `checkLaborLawCompliance` 就有的過濾條件(`legalMin > 0`),新版重寫時不小心漏掉了。因為 `horizon` 有 `MAX_MILESTONE_MONTHS` 上限,「檢查到 horizon 就足夠」不再是嚴格意義的「兩邊都已收斂」,而是「檢查到這裡為止,收斂與否已不重要」的保守夾住——`untilMonths: null` 的正確理解因此是「在 horizon 之內我們沒看到它變合規」,不是「數學上證明它永遠不合規」。commit 8 的 JSDoc 與這裡的措辭要保持一致。 |
| D12 | 成長參數用**尾端可省略參數**(預設為 `NO_CUSTOM_GROWTH`)逐層傳遞,不改成傳入整個設定物件。 | 既有呼叫與測試不需修改;避免變成報告 R5 那種結構重構。 |
| D13 | 勞基法天數上限在滿 **288 個月**(24 年)才達到 30 天,不是報告附錄所寫的 240 個月。 | 以 `getLaborLawDays` 現有實作為準(`leaveCalculations.js:89-99`):120 個月為 16 天,之後每年加 1 天。 |
| D14 | 新增安全上限常數 `MAX_MILESTONE_MONTHS = 1200`(100 年)。套用在三處:(a) `normalizeCustomThresholds` 的門檻過濾條件加上 `m <= MAX_MILESTONE_MONTHS`;(b) `checkLaborLawCompliance` 算出的 `horizon` 用 `Math.min(MAX_MILESTONE_MONTHS, …)` 夾住上限;(c) Settings 的月數輸入框加 `max={1200}`(僅為 UX 提示),並在 `handleSave` 對超過 1200 的門檻月數丟出明確錯誤訊息。 | 已核對現有程式碼確認兩個真實風險都存在:① `getMilestones` 自訂分支在兩個門檻之間往前補的迴圈沒有上界,距離極遠的兩個門檻會造成數千萬次迭代;② 月數輸入框只有 `min={1}`,沒有任何上限,`type="number"` 的 `max` 屬性不會阻止使用者直接打字打超過該值,真正的防線是①的正規化過濾。③ commit 8 讓合規檢查的 `useEffect` 在每次按鍵都重算,若 `perYear` 被打成極小的正小數而 `cap` 是 30,`stableAt` 會暴增,連帶讓檢查點列表爆炸,導致分頁在使用者打字時凍結。用同一個常數同時夾住①②③,是最小改動、且不影響任何既有測試期望值的做法。**本次修法只堵住這一輪新增迴圈造成的攻擊面,不處理既有的、與到職日輸入範圍相關的迴圈次數問題——那是修正前就存在、且本輪沒有觸碰到的既有行為,不在範圍內。** |
| D15 | 新增私有 helper `normalizeCustomGrowth(customGrowth)`,把 `perYear`/`cap` 轉成「非負有限數,否則視為 0」。`getDaysForMilestone` 在比對到自訂規則的 `days` 時,一律先 `Number()` 轉型再參與運算。 | 已核對現有程式碼確認三個缺口都存在:① `getDaysForMilestone` 目前原樣回傳 `rule.days`,不做任何轉型,成長公式 `D + perYear * k` 可能變成字串串接而非數字加總;② `storage.js` 的 `loadSettings` 是淺層合併,若舊資料只存了 `customGrowth: { perYear: 1 }`(缺 `cap`),整個巢狀物件會被淺層覆蓋,導致 `cap` 變成 `undefined`;③ `customGrowth` 也可能整個是 `null`,裸用 `customGrowth.perYear` 會直接丟例外把整個頁面炸掉。這個經過強化轉型的 `getDaysForMilestone` 在本輪也被 Settings.jsx 重複利用來算成長列驗證所需的「最後一列天數」,見 D16 與 §8。 |
| D16 | 成長列(每年增加天數/上限)兩個輸入框跟其他自訂規則欄位一樣,`isLocked` 時一併停用,**不**提供任何鎖定後的編輯路徑。commit 8 的合規警告區塊改成依鎖定狀態顯示不同的結尾文字:未鎖定維持「仍可儲存,但請確認是否符合規定。」;已鎖定改成「如需調整請使用「離職重來」重新設定。」,不再顯示「仍可儲存」這種在鎖定狀態下不成立的措辭。 | v2 的原始方案(開放鎖定後單獨編輯成長設定)引入了三個新問題:(a) 對應的 e2e 測試 fixture 跟情境描述矛盾;(b) `onSave` 存檔後會導覽回首頁(`App.jsx` 的 `handleSaveSettings` 內部呼叫 `setPage('main')`),要嘛得新增「存檔但留在本頁」的 App 介面,要嘛測試斷言變成假通過;(c) 鎖定後把 `perYear`/`cap` 調小,會讓過去每一期已經算出的 `entitledDays` 跟著變小,而 `validateRecordsChain` 只在新增/編輯記錄時跑,這條「growth-only」存檔路徑完全不會檢查既有記錄是否因此變成帳面超支。改用「鎖定後這個警告本來就不可行動,只把措辭改成誠實反映『只能離職重來』」是成本低得多的替代方案,一次解掉三個問題,且不需要新增任何 App.jsx 介面或新存檔路徑。已核對 `Settings.jsx:213`(警告區塊只看 `ruleType === 'custom' && warnings.length > 0`,不受 `isLocked` 影響)與 `Settings.jsx:349`(`儲存設定`/`取消` 早就用 `{!isLocked && …}` 整組隱藏),確認「鎖定版結尾文字」這個修法可行,且與現況一致,不需要額外改動按鈕顯示邏輯。 |
| D17 | #19 的切點改變會讓既有請假記錄被重新分配到不同期間,可能讓原本合法的記錄變成帳面超支(例如原本落在「跨兩年」大期間內的合法記錄,被拆進去年較短的小期間後總量超支)。**本輪只保證這種情況下首頁不會拋錯、正常顯示(可能出現負數剩餘)**,不做記錄搬遷或找回向後相容的期間邊界策略,也不強制使用者修正。這個保證由 commit 1 的一條單元測試與一條 e2e 測試直接釘住,不再只是文字承諾。 | 完整修法(重新對帳、記錄搬遷、或讓既有使用者延用舊邊界)是一個獨立且不小的功能,牽涉到要幫使用者決定「哪些歷史記錄該怎麼算」這種產品判斷,超出本輪「不重構、不擴大範圍」的原則,也不是本輪新引入的計算錯誤(是 #19 這個既有 bug 修正後才會暴露的既有資料一致性問題)。只保證不崩潰是本輪能負責任地做到的最小承諾;完整修法應開一張新 issue 由使用者/PO 決定策略。 |

---

## 2. Commit 1 — 自訂門檻正規化與年度切點補齊(`Fixes #19`, `Fixes #20`)

### 網頁程式碼:`src/utils/leaveCalculations.js`

**新增私有常數與 helper(不 export)。加入 `MAX_MILESTONE_MONTHS` 上限(D14):**

```js
// Sanity ceiling for any month-threshold value. Bounds the gap-fill loop
// below (a huge gap between two thresholds would otherwise iterate millions
// of times) and is reused by checkLaborLawCompliance's horizon clamp (#20).
const MAX_MILESTONE_MONTHS = 1200; // 100 years

/**
 * Clean user-entered thresholds into sorted, de-duplicated positive integers
 * within a sane range.
 * Duplicates must be removed here: getPeriodInfo() looks up the next
 * milestone by position, so a repeated value would make a period end
 * before it starts (#20).
 */
function normalizeCustomThresholds(customRules) {
  return [...new Set(
    (customRules ?? [])
      .map(r => Number(r?.months))
      .filter(m => Number.isInteger(m) && m >= 1 && m <= MAX_MILESTONE_MONTHS)
  )].sort((a, b) => a - b);
}
```

**改寫 `getMilestones()` 的自訂規則分支(D1)。** 勞基法分支不動。示意如下:

```js
export function getMilestones(ruleType, customRules, upToMonths = 360) {
  if (ruleType !== 'custom') return buildLaborLawMilestones(upToMonths);

  const thresholds = normalizeCustomThresholds(customRules);
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
      // Any sub-year remainder therefore sits just before `next`, and that
      // remainder still gets the full-year entitlement of `current` (not
      // prorated) — this is intentional, see the design doc (D1).
      for (let m = current; m < next; m += 12) milestones.push(m);
    }
  });
  return milestones;
}
```

**更新 `getMilestones` 的 JSDoc**,說明四件事:
- 自訂規則的期間永遠不超過 12 個月;
- 採往前補,零頭放在下一個門檻之前;
- 門檻會先去重,且門檻值會被限制在 `[1, MAX_MILESTONE_MONTHS]` 內;
- 零頭期間不按比例折算天數:它拿到的是它所屬那個門檻的完整年度天數,即使該期間實際不滿 12 個月。

`getDaysForMilestone`、`getPeriodInfo` 在這個 commit **不改**。原本「取 ≤ milestone 的最高門檻」的邏輯,會讓補進來的切點自動沿用下層門檻的天數。

### 單元測試:`src/utils/leaveCalculations.test.js`

在 `describe('getMilestones …')` 附近新增 `describe('getMilestones (custom rules yearly grid)')`。下列測試會用到「與 `Settings.jsx` 的 `DEFAULT_CUSTOM_RULES` 相同的門檻與天數」這組資料,請在測試檔宣告成常數,並加註解說明它對應 `Settings.jsx`(`[6:3, 12:7, 24:10, 36:14, 60:15, 120:16]`)。

- `produces the same milestones as labor law for the default custom thresholds`
- `fills yearly cut points forward from each threshold, leaving any short remainder just before the next threshold`(門檻 `[6, 12, 30]` → `[6, 12, 24, 30, 42, …]`)
- `never produces a gap longer than 12 months between consecutive milestones`
- `deduplicates repeated thresholds`
- `ignores thresholds that are not positive integers`
- `ignores thresholds beyond the sanity ceiling and does not hang on a huge gap`(門檻 `[12, 999999999]`,結果等同只有 `[12]` 往後延伸,呼叫在正常 timeout 內完成)
- 既有的 `returns [6] fallback for empty custom rules` 與 `extends custom rules annually past the last defined rule` **保持不變**。

在 `describe('getDaysForMilestone')` 新增:
- `gives a gap-filled milestone the days of the highest threshold at or below it`(預設值,48 個月為 14 天、72 個月為 15 天)

在 `describe('getPeriodInfo')` 新增:
- `spans exactly 12 months at milestone 36 under the default custom thresholds`
- `never ends before it starts when custom thresholds are duplicated`
- `keeps a short remainder period's days at the threshold it falls under, without proration`(門檻 `[6:3, 12:7, 30:14]`,milestone 24 的期間為 2022-01-01~2022-06-30〔6 個月〕,`entitledDays` 仍是 7)

在 `describe('calculateSummary')` 新增:
- `starts a new 12-month period every year under the default custom thresholds`(到職日 2020-01-01、today 2024-01-01,共 5 期,最新一期 milestone 48,期間 2024-01-01~2024-12-31,`entitledDays` 14)
- `[K2]` `does not throw and reports negative remaining when re-gridded periods make a previously-valid record look overspent (#19)`
  - 沿用本 commit 已經在用的門檻組合 `[6:3, 12:7, 30:14]`。
  - 到職日 2020-01-01,`allowCarryover: false`,一筆記錄 `{ startDate: '2022-02-01', days: 10 }`(落在 milestone 24 的 2022-01-01~2022-06-30 零頭期間內,`entitledDays` 為 7)。
  - **`[K2]` 這個 `it(...)` 區塊要在內部自己宣告一個區域變數 `const today = d('2022-03-01')`,不要沿用 `describe('calculateSummary')` 開頭那個共用的 `const today = d('2025-06-15')`(`leaveCalculations.test.js:351`),也不要寫成裸的 `new Date('2022-03-01')`。** v4 曾寫 `new Date('2022-03-01')`:這是 UTC 午夜起算,在 UTC 負偏移時區下的本地時間會落到 2022-02-28,雖然這條測試不論落在 2/28 或 3/1 都同樣位於 milestone 24 那期、算出來仍是 `-3`,結果不會變紅,但沿用裸字串是壞示範,同檔案其他所有日期(含 describe 層那個 `today`)全部經過 `d()`(即 `parseLocalDate`,`leaveCalculations.test.js:22`)轉本地時間,這條沒理由當例外。
  - 斷言 `calculateSummary` 不拋出例外、`hasLeave` 為 `true`,取 `milestoneMonths === 24` 的那一期,`remaining` 為 `-3`(7 − 10)。
  - 註解說明:這模擬「#19 修正前用較寬鬆的期間邊界存下的記錄,修正後被重新分配進較短的期間而超支」的既有資料情境(D17)——本輪只保證計算不崩潰,不修復超支本身。

### 網頁程式碼:`src/components/MainPage.jsx`(僅為測試新增選擇器)

在「本年度週年制區間」那個 `div` 加上 `data-testid="period-range"`。

### e2e:`e2e/onboarding-and-settings.spec.js`,`describe('特休規則設定')` 內新增

- `公司另有規定使用預設門檻時,滿 4 年後仍是 12 個月一期`
  - **為什麼走 UI 而不 seed 資料:** 預設門檻定義在 `Settings.jsx`,seed 等於把它抄一份進測試,日後改預設值時守不到。這點要寫成註解。
  - **步驟:** 點「公司另有規定」,不改任何規則;到職日填 `2021-06-15`(凍結的 today 為 2025-06-15,年資正好 48 個月);儲存。
  - **斷言:** `period-range` 包含 `2025-06-15` 與 `2026-06-14`;`summary-entitled` 為 14;期別分頁共 5 個,第一個是 `2025–26`。
  - 註解寫明:修正前會落在 milestone 36,期間是 2024-06-15 ~ 2026-06-14,橫跨兩年。

### e2e:`e2e/onboarding-and-settings.spec.js`,`[K1]` **新增獨立的 `test.describe`(不掛在 `特休規則設定` 底下)**

```js
// A separate top-level describe on purpose: '特休規則設定' navigates
// straight to the settings page in its beforeEach with no seeded settings
// (that describe's own comment says so), so seedAppStorage() called inside
// one of its tests would run too late for page.addInitScript() to take
// effect, and the page wouldn't even be on '/' to read summary-* from.
// This test needs its own explicit freeze -> seed -> navigate order instead.
test.describe('既有資料相容性（#19 切點重新分配）', () => {
  test('既有請假記錄因切點重新分配而超支時，首頁仍正常顯示且不拋錯', async ({ page }) => {
    await freezeTime(page, '2022-03-01T03:00:00')
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2020-01-01',
        ruleType: 'custom',
        customRules: [
          { id: 'c1', months: 6, days: 3 },
          { id: 'c2', months: 12, days: 7 },
          { id: 'c3', months: 30, days: 14 },
        ],
        allowCarryover: false,
      },
      records: [{ id: 'r1', startDate: '2022-02-01', days: 10 }],
    })
    await page.goto('/')

    await expect(page.getByTestId('summary-entitled')).toBeVisible()
    await expect(page.getByTestId('summary-remaining')).toContainText('-3')
  })
})
```

- **`[K1]` 需要把 `seedAppStorage` 加進這個檔案原本只有 `freezeTime` 的 import(`import { freezeTime, seedAppStorage } from './helpers.js'`)。**
- 與上面單元測試相同數字(門檻 `[6:3, 12:7, 30:14]`、到職日 2020-01-01、記錄 `2022-02-01` 請 10 天、`today = 2022-03-01`)。
- **`[J4]` 沿用凍結時間慣例:`freezeTime(page, '2022-03-01T03:00:00')`,不要傳裸日期字串**(`playwright.config.js` 未設定 `timezoneId`,裸日期會被當 UTC 午夜解析,在 UTC 負偏移時區下會少一天)。
- 斷言:首頁正常渲染(`summary-entitled` 可見),`summary-remaining`(`MainPage.jsx:119`)顯示負數 `-3`(`formatDays` 對 `-3` 原樣回傳 `-3`,見 `MainPage.jsx:300`)。
- 註解說明對應 D17,並註明這是刻意驗證「不崩潰」而非「不超支」。

---

## 3. Commit 2 — 無有效門檻時的首頁防線(`Refs #21`)

### 網頁程式碼:`src/utils/leaveCalculations.js`

在 `calculateSummary()` 的「未填到職日」檢查之後、計算帳本之前加入:

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

**`[K3]` 標點改為全形逗號(`，`),比照 `leaveCalculations.js:399` 既有 `calculateSummary` 訊息的風格,不要沿用 v4 誤植的半形逗號。**

`MainPage` 本來就有顯示 `!summary.hasLeave` 訊息的分支,不需要修改。

### 單元測試

在 `describe('calculateSummary')` 新增:
- `reports hasLeave: false with a reset hint when custom rules have no valid thresholds`
- `treats custom rules whose thresholds are all invalid the same as an empty rule set`

### e2e:`e2e/resignation.spec.js`

- `自訂規則為空的舊資料:首頁提示改用離職重來`
  - seed `{ onboardDate: '2023-06-15', ruleType: 'custom', customRules: [], allowCarryover: false }`。
  - 斷言首頁出現「離職重來」提示文字,且 `period-tabs` 不存在。

---

## 4. Commit 3 — Settings 輸入驗證與刪除下限(`Fixes #20`, `Fixes #21`)

### 網頁程式碼:`src/components/Settings.jsx`

**`handleSave()` 的自訂規則驗證,全部包在 `if (ruleType === 'custom') { … }` 區塊內。訊息一律用全形標點:**

```js
if (ruleType === 'custom') {
  // This whole block — including the empty-list guard — must stay inside
  // the `ruleType === 'custom'` branch. A user who deleted every custom
  // rule and then switched back to 'labor' has an empty customRules array
  // that is irrelevant once ruleType is 'labor'; if the guard ran
  // unconditionally, they could never save again.
  if (normalizedRules.length === 0) {
    alert('請至少保留一條自訂規則')
    return
  }

  const sorted = [...normalizedRules].sort((a, b) => a.months - b.months)
  const seenMonths = new Set()
  for (const r of sorted) {
    // Reject months beyond the sanity ceiling used by
    // normalizeCustomThresholds (D14), so a silently-dropped threshold
    // doesn't look like a successful save.
    if (!Number.isInteger(r.months) || r.months < 1 || r.months > 1200) {
      alert('年資門檻請填寫 1200 個月（100 年）以內的正整數')
      return
    }
    if (seenMonths.has(r.months)) {
      alert(`年資門檻「${r.months} 個月」重複，請合併或刪除其中一列`)
      return
    }
    seenMonths.add(r.months)
    if (!r.days || r.days <= 0) {
      alert('特休天數請填寫大於 0 的數字')
      return
    }
  }
  // Commit 7 appends the growth-row validation to the end of this same
  // block (see §8), rather than opening a second
  // `if (ruleType === 'custom')`.
}
```

**刪除按鈕:** 改為 `disabled={isLocked || customRules.length <= 1}`;至少只剩一列時加上 `title="至少需保留一條規則"`(e2e 不依賴這個 title)。

**表格列:** 自訂規則的 `<tr>` 加上 `data-testid="custom-rule-row"`。

**月數輸入框:** 加上 `max={1200}`(純 UX 提示,真正的防線是儲存驗證與 `normalizeCustomThresholds`)。

**警告清單的 `key`:** 這個 commit **不動**,commit 8 會整段改寫。

### e2e:`e2e/onboarding-and-settings.spec.js`,`describe('特休規則設定')` 內

**既有測試 `刪除自訂規則後列表更新`:** 列數計算改用 `getByTestId('custom-rule-row')`。

**新增:**
- `自訂門檻重複時無法儲存並顯示明確錯誤`(alert 為 `年資門檻「12 個月」重複，請合併或刪除其中一列`)
- `自訂規則只剩一列時刪除按鈕為 disabled`
- `年資門檻超過安全上限時無法儲存`(alert 為 `年資門檻請填寫 1200 個月（100 年）以內的正整數`)

### e2e:`e2e/resignation.spec.js`

**調整 fixture:** `LOCKED_SETTINGS.customRules` 改成兩列。**調整 `儲存後欄位變唯讀,「離職重來」變 enabled`:** 刪除按鈕現在有兩個,改成逐一斷言所有「刪除此規則」按鈕都是 disabled。

---

## 5. Commit 4 — 切換期別分頁時重置月曆與表單(`Fixes #22`, `Fixes #28`)

本 commit 內容與 v3/v4 完全相同,本輪三點意見都不影響這個 commit。

### 網頁程式碼:`src/components/MainPage.jsx`

**`handleSelectPeriod()` 開頭加上早退(D5):**

```js
// Re-selecting the current tab must be a no-op. Clearing editingRecord
// here without remounting LeaveForm would leave the old values in an
// "add" form, and submitting it would duplicate the record.
if (milestoneMonths === activePeriod.milestoneMonths) return
```

**`LeaveCalendar` 與 `LeaveForm` 都加上 `key={activePeriod.milestoneMonths}`(D4)**,並在第一個 key 旁加註解說明重掛載的原因(react-calendar 只在 mount 時讀 `defaultActiveStartDate`;`LeaveForm` 把半打的輸入存在 local state)。`LeaveCalendar.jsx`、`LeaveForm.jsx` 本身**不改**。

### e2e:`e2e/period-tabs.spec.js`,`describe('期別分頁')` 內新增

以下皆使用 `SETTINGS_WITH_CARRYOVER` 與預設凍結日 2025-06-15,每個新 `test` 自己呼叫 `freezeTime(page)`(這個檔案沒有 describe 層級的 `beforeEach` 凍結時間)。

- `切換到較舊分頁後,月曆顯示該期間內的月份`
- `切換分頁後,表單中尚未送出的輸入被清空`
- `編輯中切換分頁後,表單回到新增模式且欄位清空`
- `點擊目前已選取的分頁不會中斷編輯`
- `切換分頁後點月曆日期仍能正確帶入表單`(驗證 `key` 重掛載不會弄壞既有「點月曆帶入表單」功能的事件綁定)

---

## 6. Commit 5 — 揭露國定假日限制(`Fixes #33`)

本 commit 內容與 v3/v4 完全相同,本輪三點意見都不影響這個 commit。

### 網頁程式碼

**`src/components/MainPage.jsx`:** 在月曆卡片副標下方新增:

```jsx
<p data-testid="calendar-holiday-note" className="text-xs text-stone-400">
  圓點只跳過週六日，未考慮國定假日與補班日
</p>
```

**`src/utils/leaveCalculations.js`:** 在 `getLeaveRecordDates` 的 JSDoc 補一句不處理國定假日與補班日的限制(#33)。

### e2e:`e2e/calendar-and-records.spec.js`

- `月曆說明揭露圓點未考慮國定假日與補班日`(只比對關鍵詞「國定假日」,避免文案微調就讓測試失敗)

---

## 7. Commit 6 — 成長規則的計算核心、儲存與 CSV(`Refs #35`)

本 commit 內容與 v3/v4 完全相同,本輪三點意見都不影響這個 commit。

### 網頁程式碼:`src/utils/leaveCalculations.js`

**新增並 export 常數,以及防禦性正規化 helper:**

```js
/** customGrowth value meaning "no growth after the last custom threshold". */
export const NO_CUSTOM_GROWTH = Object.freeze({ perYear: 0, cap: 0 });

/**
 * Coerce a possibly-partial or malformed customGrowth object into safe
 * numbers. Needed because settings loaded from storage may predate this
 * field, or customGrowth may be `null` from a hand-edited localStorage blob.
 */
function normalizeCustomGrowth(customGrowth) {
  const perYear = Number(customGrowth?.perYear);
  const cap = Number(customGrowth?.cap);
  return {
    perYear: Number.isFinite(perYear) && perYear > 0 ? perYear : 0,
    cap: Number.isFinite(cap) && cap > 0 ? cap : 0,
  };
}
```

**改寫 `getDaysForMilestone(milestoneMonths, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH)`:**
- 勞基法分支不變。
- **基本天數:** 只看有效門檻,取 ≤ milestone 的最高門檻;找到的 `days` 一律先 `Number()` 轉型。
- **成長:** 用 `normalizeCustomGrowth(customGrowth)` 取得安全的 `perYear`/`cap`。令 L 為最高有效門檻、D 為 L 的天數。當 `milestoneMonths > L` 且 `perYear > 0` 時:
  ```js
  const k = Math.floor((milestoneMonths - L) / 12);
  return Math.min(D + perYear * k, Math.max(cap, D));
  ```

**逐層傳遞 `customGrowth`(D12),一律作為尾端可省略參數:** `getPeriodInfo`、`getPeriodContainingDate`、`computePeriodLedger` 都加上這個參數並往下傳;`validateRecordsChain`/`calculateSummary` 只在 `ruleType === 'custom'` 時把 `customGrowth` 傳下去,`labor` 分支一律用 `NO_CUSTOM_GROWTH`。`getMilestones` 不需要這個參數。

### 網頁程式碼:`src/utils/storage.js`

`loadSettings` 對 `customGrowth` 做專屬的深一層合併,而不是整包淺層覆蓋:

```js
export const DEFAULT_SETTINGS = {
  // …
  customGrowth: { perYear: 0, cap: 0 },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      customGrowth: { ...DEFAULT_SETTINGS.customGrowth, ...(parsed.customGrowth ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
```

### 網頁程式碼:`src/utils/exportCsv.js`

`ruleType === 'custom'` 時輸出 `之後每年加,${perYear}`,`perYear > 0` 時再輸出 `天數上限,${cap}`(CSV 半形逗號不受 §0 規則 7 限制)。讀取時用 `settings.customGrowth ?? { perYear: 0, cap: 0 }` 防禦。

### 單元測試

`getDaysForMilestone`、`calculateSummary`、`validateRecordsChain`、`storage.test.js`、`exportCsv.test.js` 各自補齊成長計算、null/malformed 防禦、字串轉型、back-fill、CSV 輸出的測試案例(內容與 v4 完全相同,詳見各章節)。

---

## 8. Commit 7 — 成長列 UI 與驗證(`Refs #35`)

### 網頁程式碼:`src/components/Settings.jsx`

**`[J1]` import 補上 `getDaysForMilestone`。**

**預設值、State、成長列呈現:** 與 v4 相同——`DEFAULT_CUSTOM_GROWTH = { perYear: 1, cap: 30 }`;`growthPerYear`/`growthCap` 兩個字串 state;成長列放在 `tbody` 最後,`data-testid="custom-growth-row"`,左欄唯讀顯示「滿 {L+12} 個月起」,右欄兩個 number input(`step={0.25}`、`min={0}`,`aria-label` 分別為「每年增加天數」「天數上限」),都在 `isLocked` 時停用,上限欄另外在 `perYear === 0` 時停用(D9)。

**`[J1]` `handleSave()` 完整重寫,`growthPerYearNum`/`growthCapNum` 宣告在函式頂層(與 `normalizedRules` 同層),供驗證與最終 payload 共用:**

```js
function handleSave() {
  if (!onboardDate) {
    alert('請填寫到職日')
    return
  }

  const normalizedRules = customRules.map(r => ({
    ...r,
    months: Number(r.months),
    days: Number(r.days),
  }))

  // growthPerYearNum/growthCapNum are declared here, outside every branch,
  // because both the validation below and the onSave(...) payload at the
  // bottom of this function need them in scope.
  const growthPerYearNum = Number(growthPerYear)
  const growthCapNum = Number(growthCap)

  if (ruleType === 'custom') {
    if (normalizedRules.length === 0) {
      alert('請至少保留一條自訂規則')
      return
    }

    const sorted = [...normalizedRules].sort((a, b) => a.months - b.months)
    const seenMonths = new Set()
    for (const r of sorted) {
      if (!Number.isInteger(r.months) || r.months < 1 || r.months > 1200) {
        alert('年資門檻請填寫 1200 個月（100 年）以內的正整數')
        return
      }
      if (seenMonths.has(r.months)) {
        alert(`年資門檻「${r.months} 個月」重複，請合併或刪除其中一列`)
        return
      }
      seenMonths.add(r.months)
      if (!r.days || r.days <= 0) {
        alert('特休天數請填寫大於 0 的數字')
        return
      }
    }

    // Growth row validation, appended to the same custom-rules branch.
    const perYearValid = growthPerYear !== '' && Number.isFinite(growthPerYearNum) &&
      growthPerYearNum >= 0 && (growthPerYearNum * 4) % 1 === 0
    if (!perYearValid) {
      alert('每年增加天數請填寫大於等於 0、且為 0.25 的倍數的數字')
      return
    }
    if (growthPerYearNum > 0) {
      const lastDays = getDaysForMilestone(
        Math.max(...sorted.map(r => r.months)), 'custom', customRules
      )
      if (growthCap === '' || !Number.isFinite(growthCapNum)) {
        alert('天數上限請填寫數字')
        return
      }
      if (growthCapNum < lastDays) {
        alert(`天數上限不可低於最後一列的天數（${lastDays} 天）`)
        return
      }
      if ((growthCapNum * 4) % 1 !== 0) {
        alert('天數上限請填寫 0.25 的倍數')
        return
      }
    }
  }

  onSave({
    onboardDate,
    ruleType,
    customRules: ruleType === 'custom'
      ? [...normalizedRules].sort((a, b) => a.months - b.months)
      : DEFAULT_SETTINGS.customRules,
    allowCarryover,
    customGrowth: ruleType === 'custom'
      ? { perYear: growthPerYearNum, cap: growthPerYearNum > 0 ? growthCapNum : 0 }
      : DEFAULT_SETTINGS.customGrowth,
  })
}
```

三個 cap 錯誤各自獨立判斷、各自的訊息只描述真正不成立的那個條件,不合併成一句話(D10)。

**合規警告:** 計算警告的 `useEffect` 暫時不動,commit 8 才會接上成長參數與鎖定狀態文字。

### e2e:`e2e/onboarding-and-settings.spec.js` 與 `e2e/resignation.spec.js`

與 v4 相同:成長列門檻顯示與更新、`perYear=0` 停用上限欄、留空/低於最後一列天數/非 0.25 倍數各自無法儲存並顯示對應訊息、成長設定儲存後在首頁生效(到職日 `2014-06-15` → `summary-entitled` 為 17);`LOCKED_SETTINGS` 加上 `customGrowth: { perYear: 1, cap: 30 }`,鎖定後兩個成長列輸入框都是 disabled。

---

## 9. Commit 8 — 合規檢查改用聯集切點比對(`Fixes #35`)

### 網頁程式碼:`src/utils/leaveCalculations.js`

```js
/** getLaborLawDays() first reaches its 30-day cap at 288 months (24 years). */
const LABOR_LAW_CAP_MONTHS = 288;
```

**改寫 `checkLaborLawCompliance(customRules, customGrowth = NO_CUSTOM_GROWTH)`(D11):**

1. `thresholds = normalizeCustomThresholds(customRules)`。若為空回傳 `[]`。
2. 用 `normalizeCustomGrowth(customGrowth)` 取得安全的 `perYear`/`cap`。令 L 為最後一個門檻、D 為 `getDaysForMilestone(L, 'custom', customRules)`:
   ```js
   let stableAt = L;
   if (perYear > 0 && cap > D) stableAt = L + 12 * Math.ceil((cap - D) / perYear);
   const horizon = Math.min(MAX_MILESTONE_MONTHS, Math.max(LABOR_LAW_CAP_MONTHS, stableAt) + 12);
   ```
3. 檢查點取 `getMilestones('labor', [], horizon)` 與 `getMilestones('custom', customRules, horizon)` 的聯集,去重、排序,過濾掉大於 `horizon` 的值。
4. 先過濾掉 `getLaborLawDays(m) === 0` 的檢查點,對剩下每一點算 `custom`/`legal`:`custom < legal` 算不足,連續點合併成一段;不相鄰的兩段缺口各自獨立輸出;結束時仍在缺口內則 `untilMonths = null`。
5. `@returns` JSDoc 註明 `untilMonths: null` 是「在 horizon 之內沒看到收斂」的保守夾住,不是數學上的永遠不合規證明。

### 網頁程式碼:`src/components/Settings.jsx`

計算警告的 `useEffect` 傳入 `{ perYear: Number(growthPerYear), cap: Number(growthCap) }`,加進依賴陣列。警告清單標題改為 `⚠ 以下年資區間的天數低於勞基法最低標準`,`key={w.fromMonths}`,文字全部用全形標點:

```
「滿 {from} 個月起」或「滿 {from} 個月至未滿 {until} 個月」：您的規則 {min~max} 天，勞基法最低 {min~max} 天
```

結尾提示文字依鎖定狀態分岔:鎖定時「如需調整請使用「離職重來」重新設定。」;未鎖定時「仍可儲存，但請確認是否符合規定。」

### 單元測試:`describe('checkLaborLawCompliance')` 整段改寫

與 v4 相同:預設規則+成長 `{1,30}` 無缺口;無成長時滿 132 個月起開放式缺口;第一門檻晚於 6 個月的缺口;門檻間落差的缺口;連續缺口合併成一段(含 min/max);缺口在中途收斂就結束;空門檻回傳 `[]`;兩段不相鄰缺口不合併;極小 `perYear`(如 `0.001`)時 horizon 被夾住不掛住、不超過 1200。`getLaborLawDays` 補一條 `first reaches the 30-day cap at 288 months`。

### e2e:`e2e/onboarding-and-settings.spec.js` 與 `e2e/resignation.spec.js`

與 v4 相同:改寫既有的低於標準警告測試(全形標點);新增「滿 132 個月起開放區間」「第一個門檻晚於 6 個月」「兩段不相鄰缺口同時顯示」;`resignation.spec.js` 新增「既有資料鎖定後若因未設定成長規則而不合規,警告文字改為提示離職重來」,沿用 `[J3]` 修正過的前提與斷言(只需 seed `onboardDate` 即鎖定;結尾斷言自訂規則表所有 number input 皆 disabled,且 `儲存設定` 按鈕不存在)。

---

## 10. 本輪不做的事

- **報告的重構建議 R1–R12**(`buildPeriods` 重寫、持久化改用 `useEffect`、MainPage 的兩個 effect、`formatDays` 抽出、拆檔、Settings 拆元件、移除 `uuid`、清除死碼、`storage` 資料淨化、JSDoc typedef、ESLint、訊息常數集中)。**(R1–R12 是原審閱報告的重構建議編號,與本文件標註的 `[R2]`–`[R13]`(第一輪)、`[I1]`–`[I6]`(第二輪)、`[J1]`–`[J4]`(第三輪)、`[K1]`–`[K3]`(第四輪)是四套不同的編號,不要混淆。)**
- **把 `alert()` 改成行內錯誤訊息。**
- **P1-2**(跨期間請假)、**P1-3**(修正設定流程,D16 明確決定不再為成長列破例)、**P1-4**(JSON 備份、ErrorBoundary)。
- **P2-1**(`today` 凍結)、**P2-2**(遞延 0 天的卡片)、**P2-4**(迴圈上限,注意 D14 的 `MAX_MILESTONE_MONTHS` 只是本輪新增迴圈自帶的必要防線,不算是在做 P2-4 那個更廣泛的既有迴圈上限清理項目)、**P2-5**(天數上限與 0.25 倍數,成長列的精度驗證見 D10,不算擴大 P2-5 既有範圍)、**P2-6**(結清明細)、**P2-7**(圓點無障礙文字)。
- **修改 `LeaveCalendar.jsx` 與 `LeaveForm.jsx` 的內部邏輯**(本輪只在 MainPage 加 `key`)。
- **修改 `DEFAULT_CUSTOM_RULES` 的門檻或天數。**
- **既有請假記錄因 #19 切點改變而重新分配、進而變成帳面超支的完整修復**(記錄搬遷、期間邊界相容策略)。本輪只保證首頁不拋錯,並以測試釘住(見 D17、commit 1),完整修法應開新 issue。
- **成長列 `cap` 的數值上界。** 沿用 D2 對「天數不設上限」的既有立場,只加 0.25 倍數的精度驗證。
- **任何形式的「鎖定後單獨編輯某個欄位」機制**(不限於成長列)。D16 的立場是:鎖定就是鎖定,唯一出路是離職重來,不為任何欄位破例。
- **本輪不修改 repo 內的 `annual-leave-calculator-fix-plan-882e0e7.md`。** 該檔目前仍是最初的概念計畫(沒有 D14–D17 及後續各輪修正)。Reviewer 在 notes 中建議把最新版計畫存回該檔以便下一輪 diff,這是合理的建議但屬於選擇性動作,不是本輪計畫修正的一部分,留給使用者決定是否要另外要求執行。

---

## 11. 驗收清單

- [ ] 八個 commit 依序完成,每個 commit 單獨都能通過全部單元測試與 e2e。
- [ ] 選「公司另有規定」且不改預設值時,任何年資下的期間都不超過 12 個月,而且完全沒有合規警告。
- [ ] 重複門檻、空規則、成長列不合法的值都無法儲存,並跳出明確、且不互相混淆原因的訊息。
- [ ] 自訂規則最後一列的刪除按鈕為 disabled;成長列沒有刪除按鈕。
- [ ] 切換期別分頁後,月曆落在該期間的月份,表單清空;點擊目前分頁不影響編輯;點月曆日期仍能正確帶入表單。
- [ ] 月曆副標顯示國定假日限制的說明。
- [ ] 既有的 localStorage 資料(沒有 `customGrowth`,或 `customGrowth` 欄位不完整)載入後,天數與修正前相同(除了 #19 修正所造成的期間切分改變),且不會拋錯。
- [ ] 在門檻月數、成長列 `perYear`/`cap` 打入極端值時,設定頁不會卡死或凍結,且儲存會被明確擋下並提示訊息;`checkLaborLawCompliance` 在極端成長參數下也不會掛住(horizon 夾在 1200 以內)。
- [ ] 既有自訂規則使用者(設定已鎖定)若因合規檢查而出現警告,設定頁不提供任何欄位(含成長列)的編輯路徑,`儲存設定` 按鈕不存在;警告文字明確提示只能透過「離職重來」調整。
- [ ] 既有請假記錄若因 #19 的切點改變而變成帳面超支,首頁仍正常顯示(可能出現負數剩餘),不會拋出例外;這由 commit 1 的單元測試與**獨立 describe** 的 e2e 直接釘住(`[K1]`),是已知限制,不在本輪修復範圍內。
- [ ] `[J1]` commit 7 的 `handleSave` 能正常編譯執行:`growthPerYearNum`/`growthCapNum` 在函式頂層宣告,驗證區塊與 `onSave(...)` payload 共用同一組變數,沒有作用域錯誤。
- [ ] `[J2][K3]` 本輪新增的所有中文使用者可見字串(含 §3 的 `calculateSummary` message)標點與既有程式風格一致,全部用全形「：」「，」「（」「）」;CSV 輸出的半形逗號不受影響。
- [ ] `[J4][K2]` commit 1 新增的單元測試與 e2e 都不使用裸日期字串:單元測試用 `d(...)`(即 `parseLocalDate`)在 `it(...)` 區塊內宣告區域 `today`,不沿用或覆蓋 describe 層共用的 `today`;e2e 一律用 `freezeTime(page, '…T03:00:00')` 的格式凍結時間。
- [ ] `[K1]` commit 1 新增的 #19 既有資料相容性 e2e 位在自己獨立的 `test.describe`,不沿用 `特休規則設定` 那個會先導覽到設定頁、且明確聲明「不 seed」的 `beforeEach`;測試本體內依序完成「凍結時間 → seed → `page.goto('/')`」。
- [ ] 本輪沒有修改第 10 節列出的任何項目。
