# 實作計畫：警示／警告機制統一改版

> 本計畫由 Claude Chat 與維護者討論定案，交由 Claude Code 實作。
> 開始前請先比對最新 HEAD 的 `src/components/LeaveForm.jsx`、`src/components/Settings.jsx`、
> `src/utils/leaveCalculations.js`、`src/utils/settingsValidation.js`（若已存在，視 #45 的實作進度而定）、
> `e2e/onboarding-and-settings.spec.js`、`e2e/resignation.spec.js`、`e2e/calendar-and-records.spec.js`。
> 若與本文描述的現況不符，請先回報，不要自行推測。
>
> 對應 issue：[#46](https://github.com/corytu/annual-leave-calculator/issues/46)
>
> 本文件是 **concept plan**（沿用這個 repo 既有的 concept → approved 兩階段慣例）。

## 修訂說明（第二版）

第一版送進 Coder/Reviewer 審閱迴圈跑了一輪（round 0 覆核 HEAD 並產出實作計畫，round 1 審閱），
Reviewer 抓到一個結構性死路（見下方 B1）與若干真實缺口，維護者已逐條核對並同意修正方向。本版是
把這些修正收斂回 concept plan 之後的結果，迴圈會從 round 0 重新開始（迴圈本身無狀態，不會記得上一
輪的討論）。異動摘要：

- **W6、W7 全面修訂**：
  - W6——「計算」與「顯示」拆成兩個獨立時機（見 §3.4），修掉一個真實可重現的死路：使用者把欄位改
    到合法、手還沒離開就直接點動作按鈕，按鈕會卡在 disabled 永遠解不開。
  - W7——合規警告清單維持現行計算與顯示方式完全不動，不套用 touched、不改觸發時機。原版 W7 想把它
    也改成 blur 觸發，但那個問題其實已經被更早的 `MAX_MILESTONE_MONTHS` 上界解決過；改 blur 反而會
    讓它跟 fieldWarnings 的即時計算第一次出現分岔（完整推導見新增的 §1.1）。
- **W12 修訂**：門檻重複的訊息保留門檻數值，集中清單依數值去重（原措辭矯枉過正，會讓兩組不同的
  重複被誤併成一行）。
- 新增 **W15**（跨欄位相依檢查要先確認來源欄位本身合法）、**W16**（非文字輸入的設值路徑要顯式標記
  touched，不能只重算）。
- 新增 **§1.1**：完整記錄「touched（W11）為什麼不套用在 advisory」的推導過程，供之後想重新考慮這個
  取捨的人接續思考，不用重新從頭辯證。
- Commit 2、Commit 3 補上數個具體修法（見 §4），§2、§3、§6 也跟著更新。

以下 W1–W16 都已由維護者確認，Claude Code 不需要再回頭跟維護者確認這些決定本身，但仍要先對照
HEAD 覆核現況（例如 `settingsValidation.js` 目前的實際狀態、e2e 裡 `page.once('dialog', …)` 的實際
數量與行號），現況落差照樣要回報。

---

## 0. 背景

現況的警示/告知機制實際上有四種並存，彼此呈現方式、觸發時機、是否阻擋動作互不一致：

1. **LeaveForm 的 inline 警示**：`error` state，submit-time 觸發，一次只顯示一則訊息，會阻擋新增/更新。
2. **Settings 的瀏覽器原生 `alert()`**：submit-time 觸發，一次只顯示一則訊息，會阻擋儲存，且 e2e 得靠
   `page.once('dialog', …)` 這種脆弱寫法攔截。
3. **離職重來的兩層 Modal**：使用者主動觸發危險動作時的確認流程，本質不是輸入驗證。**本輪不動。**
4. **Settings 的合規警告清單**（`checkLaborLawCompliance`）：目前隨 `useEffect` 每次按鍵即時重算，
   不阻擋儲存，可同時列出多筆。**本輪完全不碰（理由見 §1 W7、完整推導見 §1.1）。**

本輪目的：把 1、2 統一成「即時重算、可同時顯示多筆、依語意分層」的機制。4 維持現行行為不變。

---

## 1. 已定案設計決定（W1–W16）

| # | 決定 | 理由 |
|---|---|---|
| W1 | 離職重來的兩層 Modal 維持不動，本輪完全不碰。 | 觸發時設定已鎖定，跟輸入驗證無關。 |
| W2 | 移除 Settings 所有 `alert()`。 | `alert()` 會阻塞 UI、無法樣式化、互卡不同輸入的驗證規則。 |
| W3 | 自訂規則表是陣列型欄位，拆驗證訊息時**不**塞進置頂集中清單，改成貼在每一列輸入框旁邊的 inline 錯誤；只有「門檻重複」「規則清單為空」這種跨列關聯性錯誤才留在集中清單。 | 集中清單無法定位是表格中的哪一列出錯；per-row inline 沿用第一類 LeaveForm 既有的呈現慣例。 |
| W4 | 三個天數欄位（自訂規則天數／`perYear`／`cap`）的驗證訊息**拆開**成獨立條件，各自判斷、各自顯示、各自在條件滿足時消失，不再合成一句。 | 推翻 `83e5a17` 輪 C6 的原決定。C6 的理由是「避免使用者修好一個條件又跳出下一個 alert」，這個理由在「即時清單、全部同時顯示」的模式下已不成立——沒有「跳下一個」的問題了。 |
| W5 | 「門檻重複」「規則清單為空」這兩條驗證，這次一併從 `alert()` 搬進即時機制。 | 收尾 `882e0e7` 輪 D2 當時特意延後的項目——當時是為了先求有功能，這次是在做 UX，範圍自然不同。 |
| W6 | **（本輪修訂，取代原版）** 「計算」跟「顯示」拆成兩個獨立時機：**（a）計算**——只要追蹤欄位的值改變就重新算一次，這份即時、真實的結果同時是「按鈕能不能按」的唯一依據；文字輸入框用 `onChange`，任何不經過文字輸入框 `onChange` 的值變動（quick-pick 按鈕、點月曆選日期、`addCustomRule`/`removeCustomRule`、`ruleType` 切換等）都要顯式呼叫同一個重算函式並帶上 override。**（b）顯示**——欄位對應的文字要不要印出來，仍然看 touched（見 W11、W16），不受計算頻率影響。 | 原版「計算」跟「顯示」共用 blur 這一個時機，會在「使用者把欄位改到合法、手還沒離開就直接點動作按鈕」時卡死：disabled 的按鈕在瀏覽器層級完全不會分派 click 事件，這個時序不受 React 狀態更新影響，是結構性問題，不是實作疏漏；「點擊時完整重跑」原本設計成安全網，卻剛好在最需要它的那個瞬間打不到（按鈕本身就是 disabled）。拆開後 disabled 永遠反映真實狀態，這個死路不會發生，也不再需要那個打不到的安全網。 |
| W7 | **（本輪修訂，取代原版）** 合規警告清單維持現行行為完全不動：不改計算觸發時機（還是每次按鍵都重算），也不套用 touched 過濾——跟現在一樣，只要算出來有東西就顯示，鎖定頁一載入也要能看到。 | 原版想解決的「打極端值時清單閃一下」，其實是 `882e0e7` 輪 D14③ 那次效能事故的殘留印象；但那次真正的修法是加 `MAX_MILESTONE_MONTHS` 這個上界，跟「多久重算一次」無關——即時重算從來不是問題所在，原版是在解一個已經被獨立解決過的問題。合規清單是 advisory、不阻擋任何動作，維持不動同時讓這部分的 e2e 完全不用改。完整推導（含鎖定頁的限制）見 §1.1。 |
| W8 | 三層語意分層：**incomplete**（未完成前提，中性色，仍阻擋）／**error**（值不合法，紅色，阻擋）／**advisory**（建議、不擋，沿用現有琥珀色）。 | 呼應「使用者還沒做任何動作就被噴錯誤」的問題：同樣一句「請選擇日期」，用中性色呈現時讀起來是「還沒做」，用紅色呈現時讀起來是「做錯了」。 |
| W9 | **「空值 → incomplete；有值但不合法 → error」作為判斷兩層語意的通用規則**，一體適用於全部欄位（LeaveForm 的日期／天數，Settings 的到職日／自訂規則天數／月數／`perYear`／`cap`）。 | 給 Claude Code 一條可以無腦套用的規則，不用逐欄位另外決定語意，且跟 W8 的分層精神一致：「還沒填」永遠是未完成，不是錯誤。 |
| W10 | 顏色映射：incomplete 用 `text-stone-500`（沿用既有中性色系）；error 沿用現有 `text-red-600`（LeaveForm 目前就是這個 class，不用改）；advisory 沿用現有 `bg-amber-50 border-amber-200 text-amber-800`（合規清單目前就是這組 class，不用改）。 | 三色都是這個 codebase 裡已經在用的既有色票（stone 貫穿全站的中性色、red 用在刪除／離職等危險動作、amber 已經是合規清單的顏色），不引入新色票，維持視覺一致性。 |
| W11 | 「touched」概念：欄位被標記 touched **之後**，才顯示該欄位對應的即時警示文字；但動作按鈕的 `disabled` 狀態**不受** touched 影響，永遠反映「現在送出會不會被擋下」的真實狀態。只套用在 incomplete/error，不套用在 advisory（完整推導見 §1.1）。 | 讓「按鈕能不能按」跟「畫面要不要顯示解釋」分開判斷：前者要永遠正確（W14），後者要避免使用者還沒做任何事就被文字轟炸，兩者用不同機制達成，互不牽制。 |
| W12 | **（本輪修訂）** 「門檻重複」的警示掛在**所有**涉及重複的列上（原意不變）；但訊息**保留門檻數值**（沿用既有 alert 原文「年資門檻「X 個月」重複，請合併或刪除其中一列」），集中清單依**門檻數值**去重，不是依訊息文字去重。 | 原措辭「不點名列號」被誤讀成「連數值也不能提」：如果同時存在兩組不同的重複（例如 12 個月重複一次、24 個月重複一次），四條一模一樣的泛用文字會被去重成一行，反而看不出有兩組衝突。數值不是「列的位置」，不會因排序改變而跟丟，跟原本想避免的「第 2 列」那種脆弱寫法是兩回事，保留數值沒有違背 W12 原本的精神。 |
| W13 | 「會 disable 的清單」與「不會 disable 的合規清單」在視覺與物理位置上都要分開，不能用同一種外觀。 | 兩者外觀相同的話，使用者無法從外觀分辨「這個會擋我存檔」跟「這個只是建議」。 |
| W14 | **核心行為**：只要目前存在任何一條 incomplete 或 error 警示（W8），對應的動作按鈕（LeaveForm 的新增／儲存變更、Settings 的儲存設定）就維持 disabled；等所有 incomplete/error 都被清除，按鈕才恢復可點。advisory 警示不影響按鈕狀態。 | 現有 `alert()`／inline error 模式是「送出才知道擋下」，這次改成「還沒送出就先讓使用者知道不能送出」，是本次改版最根本的行為變化，值得獨立寫清楚而不是散落在 W8、W6 的字裡行間。 |
| W15 | **（新增）** 任何檢查如果需要讀取「另一個欄位或另一列的值」做判斷（例如 cap 不可低於最後一列天數、門檻重複判斷兩列是否相等），都要先確認那個來源欄位本身沒有 blocking（incomplete/error）警示，沒有才進行衍生判斷，否則整條跳過不顯示。 | 「蒐集所有錯誤」拿掉了原本短路驗證隱含的「前面的欄位已經合法」這個保證，任何讀別人值的檢查都可能讀到還在編輯中途的無意義值（例如最後一列天數是空的或負的、或兩個都還沒填的門檻被誤判成重複）。與其逐一 patch，不如訂一條通用規則。 |
| W16 | **（新增）** 任何「不經過使用者在該欄位打字」但直接設定欄位值的路徑（LeaveForm 點月曆選日期、quick-pick 天數按鈕、編輯模式回填既有記錄），都要在設值的同時把對應欄位標記為 touched，不能只呼叫重算、漏了標 touched。Settings 的結構性變更（`addCustomRule`/`removeCustomRule`/`ruleType` 切換）只需要重算，不用額外標 touched——新出現的欄位維持「未觸碰前不顯示」的一般規則。 | touched 原本假設「使用者離開輸入框」＝「欄位已確認」，但點月曆、點 quick-pick 這些操作本身就是一種確認方式，只是沒有經過那個 DOM input 的 blur 事件。如果不顯式補標，這些路徑產生的警示（尤其是跨欄位的超支檢查）就永遠不會被使用者看到，變成一個沒有理由的 disabled 按鈕。 |

### 1.1 附註：為什麼 touched（W11）不套用在 advisory，W7 選擇維持現狀

這一節記錄 W7／W11 這個取捨怎麼推導出來的，之後如果有人想重新考慮「要不要讓 advisory 也套用
touched」，可以直接從這裡接著想，不用重新從頭辯證一次。

**起點**：曾經考慮過把 touched 這個「先互動過才顯示」的規則，同時套用到 incomplete、error、advisory
三種 tier，理由是這樣一來 advisory（合規清單）也不會在使用者還沒開始編輯自訂規則前就搶先跳出來，介
面看起來更統一。

**第一個硬性阻礙——鎖定頁**：`resignation.spec.js` 有一個既有測試，種好一組已經設定過的 localStorage，
導覽到到職日已設定的鎖定畫面。這個畫面上**所有輸入框都是 disabled**（到職日、規則類型卡片、每一列
的天數/月數、成長列⋯⋯全部），而這個測試斷言：鎖定頁一載入，合規清單就要立刻看得到。問題是 touched
目前唯一的觸發方式是「欄位被 blur」，**一個 disabled 的輸入框不可能被 focus，自然也不可能被
blur**——這跟 B1 死路是同一種機制問題，只是這次發生在「顯示」而不是「按鈕能不能按」。如果 touched
套用到 advisory，鎖定頁上不會有任何欄位變成 touched，合規清單會永遠不出現，直接弄壞這個既有測試，
也弄壞「鎖定後想確認既有設定合不合規」這個清單存在的意義之一。這個功能維護者明確表示要保留，所以
「touched 套用到 advisory」這條路本身先被排除。

**就算解決了鎖定頁，也達不到原本想要的效果**：假設另外處理鎖定頁的問題（例如「一開始就有值的欄位」
直接視為 touched，不需要真的 blur 過），touched 管的仍然只是「使用者完全還沒碰過這個欄位之前，要不
要顯示」，管不到「使用者正在編輯這個欄位的過程中，畫面要不要一直跟著變」。也就是說，這樣做能解決
「還沒開始編輯就搶先跳出來」，但解決不了「打字時一直閃爍變動」——後者是**計算**的觸發頻率造成的，
不是**顯示**規則能解的問題，這兩件事在整份計畫裡一直是刻意拆開的兩個旋鈕（見 §3.4），touched 只轉
得動其中一個。

**如果真的想解決編輯中的閃爍**：唯一辦法是把 advisory 的計算也改成 blur 觸發——這正是原版 W7 想做的
事。但這樣做會產生一個新的不一致：目前 fieldWarnings（incomplete/error）的計算時機是「即時」，
advisory 的計算時機也是「即時」，兩者剛好一致——但這個一致其實是巧合，不是刻意設計出來的：advisory
從頭到尾都是即時計算，從未被這次改版動過；fieldWarnings 則是繞了一圈（原本設計成 blur，因為 B1 死
路才改回即時）之後剛好跟 advisory 對上。如果現在為了解決一個次要的視覺閃爍，反過來把 advisory 改成
blur，就是主動打破這個現在剛好一致的狀態，讓兩種警示的計算時機第一次出現分岔。

**結論**：維護者權衡後選擇維持現狀——W7 維持現行行為（合規清單的計算與顯示都不變），接受既有的
「編輯中會即時跟著變動」的行為。理由是：鎖定頁的正確性是既有功能、必須保留；「編輯中會閃」只是次要
的視覺瑕疵，用「讓兩種警示的計算時機分岔」去換，不划算。

W11 因此只套用在 incomplete/error。

---

## 2. 效能：這批新驗證會不會重演舊雷？

`882e0e7` 輪 D14③ 記載過：合規警告的 `useEffect` 在每次按鍵都重算，`perYear` 打成極小正小數、`cap` 是
30 時，`stableAt = L + 12 × Math.ceil((cap - D) / perYear)` 會暴增，連帶讓檢查點列表爆炸，導致分頁在
使用者打字時凍結；最後靠 `MAX_MILESTONE_MONTHS` 夾住上限才解決。

**核對過本輪要新增的即時驗證，結論是：不會重演。** 那次出事的根因是「用使用者輸入的數字去建一個長度
不定的陣列、或跑一個次數不定的迴圈」。本輪新增的驗證（每列天數 >0／≤365／0.25 倍數、門檻月數是正整
數／≤1200、門檻重複偵測、`perYear`／`cap` 的範圍與倍數檢查）全部都是單純比較或 `Set` 查重，沒有一個
會依使用者輸入建構長度不定的結構。

**唯一該延續的通用防線**：任何新驗證函式，只要內部出現迴圈或陣列建構、且其長度／次數是從使用者輸入
直接推導出來的，就要重新檢查有沒有上界。本輪没有這種結構，故不需要新增額外常數。

**補充（round 1 review 後）**：這裡原本多寫了一句「W6 已經把觸發時機從『每個按鍵』改成『blur』，即
使某條檢查意外變重，也不會在打字過程中被逐鍵觸發」——這句話在 W6 修訂後不再成立（計算改回每次按鍵
都重算），但上面的結論本身不受影響：`MAX_MILESTONE_MONTHS` 這個防線本來就跟「多久重算一次」無關，
即使沒有 blur 當額外保護，也不會復發。原 W7 當初想靠「改成 blur」處理的「打字閃一下」，其實是顯示
時機問題，不是效能問題，這一版改用 touched 解決顯示時機，跟計算頻率脫鉤（見 §3.4）。

---

## 3. 架構設計

### 3.0 命名

改版後有兩種概念不同的警示陣列，命名上要區分清楚，避免混用：

| 概念 | 變數名建議 | 內容 | 觸發/顯示規則 |
|---|---|---|---|
| 阻擋清單（incomplete/error） | `fieldWarnings` | `Warning[]`（見 §3.1） | 計算即時、顯示看 touched（W6/W11/W16） |
| 合規／建議清單（advisory） | `complianceWarnings` | `checkLaborLawCompliance` 現有回傳形狀，不轉型 | 計算即時、顯示不設限（W7） |

### 3.1 共用型別

```js
/**
 * @typedef {'incomplete' | 'error' | 'advisory'} WarningTier
 * @typedef {{
 *   id: string,                          // React list key，須穩定
 *   tier: WarningTier,
 *   scope: 'field' | 'row' | 'form',
 *   rowId?: string,                      // scope === 'row' 時，對應 custom-rule 的 id
 *   message: string,
 * }} Warning
 *
 * incomplete/error 會阻擋動作按鈕；advisory 不會。
 */
export function isBlocking(tier) {
  return tier === 'incomplete' || tier === 'error';
}

// 0.25 倍數判斷的共用 helper。用 (x*4)%1 而不是 x%0.25，是既有
// settingsValidation.js 的既有 idiom（避開 %0.25 在某些十進位小數上的浮點
// 精度問題），三個天數欄位（LeaveForm 天數、Settings 自訂規則天數、
// perYear、cap）都改用這個共用版本，不要各自重寫一次。
// 注意：這個判斷跟 `x % 0.25 !== 0` 並非在所有極端值下都等價——LeaveForm
// 天數欄位刻意沒有 max（#30），若 x*4 溢位成 Infinity，這裡會回報「不是
// 0.25 的倍數」，跟舊版 %0.25 的行為可能不同。這是刻意接受的差異：這個量
// 級的輸入無論如何都會被 validateRecordsChain 的超支檢查擋下，不影響最終
// 是否能送出。
export function isQuarterStep(x) {
  return Number.isFinite(x) && (x * 4) % 1 === 0;
}
```

放在新檔 `src/utils/warnings.js`（純函式，方便單元測試）。

### 3.2 共用呈現元件

新增（路徑依現有慣例；若 codebase 目前已有 `src/components/ui/` 目錄，比照既有的離職重來 Modal 放進
去，否則就近放在 `src/components/`）：

- `<FieldWarnings warnings={Warning[]} />`：**只處理 `incomplete`/`error` 兩種 tier**，依 tier 套色、
  逐行列出，用於單一欄位下方（0～N 條）。都用單行 `<p className="text-xs ...">` 疊放，取代 LeaveForm
  現有的 `{error && <p className="text-xs text-red-600">{error}</p>}`。**樣式對照表不要預留
  `advisory` 分支**：advisory 永遠只走合規清單自己的 bespoke JSX，不會流經這個元件；預留一個永遠用
  不到、且套色方式（背景/邊框類的 class 套在無 padding 的純文字段落上會渲染成怪色條）沒設計過的分
  支，只會變成死碼。
- 合規警告清單（advisory）的既有 JSX 結構**不用**包成元件，本輪完全不動它（見 W7）。

### 3.3 「空值 vs 有值」的判斷（W9）

任何字串綁定的欄位（呼應 Bug 2 修法：state 存原始字串，用到時才 `Number()`/`parseFloat()`），一律先判
斷是否為空字串／`null`／`undefined`：

- 空 → `tier: 'incomplete'`，文案用「請填寫／請選擇 X」。
- 非空 → 才跑實際的格式/範圍檢查，失敗一律 `tier: 'error'`。

### 3.4 觸發時機：計算即時、顯示看 touched（W6）

「計算」跟「顯示」是兩個獨立的時機，不要共用同一個觸發點。

**計算**（`computeXxxWarnings(...)` 這類純函式的呼叫時機，決定 `fieldWarnings` 這份真實狀態）：

- 文字輸入框：每次 `onChange` 都呼叫（不是 blur，也不用 debounce；§2 已核對過這批驗證都是單純比較，
  效能上沒問題）。
- 任何不經過文字輸入框 `onChange` 的值變動，都要在對應的事件處理常式裡**顯式呼叫**同一個重算函式，
  並帶上剛剛改變的值（不能依賴 state 的舊 closure，見下方 override 寫法）。這包含：
  - LeaveForm 的 quick-pick 天數按鈕。
  - LeaveForm 點月曆選日期（`selectedDate` 觸發的 sync effect）。
  - LeaveForm 編輯模式回填既有記錄（`editingRecord` 觸發的 sync effect）。
  - Settings 的 `addCustomRule`/`removeCustomRule`。
  - Settings 的 `ruleType` 切換。

這樣「按鈕能不能按」永遠讀取最新、真實的計算結果，不需要再靠「點擊當下重新驗證一次」當安全網——
disabled 的按鈕在瀏覽器層級本來就不會分派 click 事件，任何依賴「點擊時重跑」才能解除阻擋的設計，在
按鈕已經是 disabled 的那一刻就已經打不到了。

**顯示**（畫面上要不要把某條警示的文字印出來，決定 `touched` 過濾後的可見清單）：

- 只套用在 `tier: 'incomplete'`／`'error'`。用 `touched` 集合過濾（見 §3.5）。
- `tier: 'advisory'`（合規清單）完全不套用這個過濾，維持現行行為（見 W7）：只要算出來有東西就顯
  示，不管有沒有互動過——鎖定頁一載入也要能看到，不能靠任何互動觸發。

動作按鈕的 `disabled` 永遠用**未過濾**的計算結果判斷（W14），不受 `touched` 影響。

### 3.5 顯示的 touched 過濾（W11、W16）

`touched` 只影響「顯示」，不影響「計算」與 `disabled`（見上）。一個欄位被標記 touched 的時機：

1. 該欄位對應的 DOM 元素 `onBlur`。
2. 該欄位的值透過非文字輸入的路徑被設定時（§3.4 列出的那些路徑，`ruleType` 切換除外），在呼叫重算
   的**同時**顯式標記，不能只呼叫重算、漏了標 touched（W16）——LeaveForm 主流路徑是點月曆選日期，這
   個路徑完全不經過 `<input type="date">` 的 blur，如果沒有顯式標記，超支這種跨欄位警示即使算出來
   也永遠不會顯示，使用者只會看到一個沒有理由的 disabled 按鈕。

`resetForm`／各種 sync effect 呼叫重算時，要用明確的 override 參數（例如
`computeLeaveFormWarnings({ startDate: '', days: 1, ... })`），不能依賴呼叫當下 state 變數的閉包
值——`setStartDate('')` 之後立刻在同一個函式裡讀 `startDate`，讀到的還是修改前的舊值。

---

## 4. Commit 拆分

### Commit 1 — 共用型別與呈現元件（純新增，不影響任何現有畫面／行為）（`Refs #46`）

- 新增 `src/utils/warnings.js`（`Warning` typedef、`isBlocking`、`isQuarterStep`，見 §3.1）。
- 新增 `<FieldWarnings />`（見 §3.2；只處理 incomplete/error，不預留 advisory 分支）。
- 單元測試：`isBlocking`、`isQuarterStep` 的特徵測試即可（`isQuarterStep` 記得測 `Infinity`/超大值的
  行為，並在測試註解裡註明這是刻意的邊界行為，不是要修的 bug）；元件本身不強制寫 render test（這個
  codebase 目前沒有元件測試框架，只有純函式單元測試 + Playwright e2e，靠後續 commit 的 e2e 覆蓋）。
- 這個 commit 完成後，兩個既有測試套件應該全綠（沒有任何行為改變）。

### Commit 2 — LeaveForm 改寫成即時三層警示

這個 commit 不掛 issue 標籤：#46 描述的是 Settings 的 alert() 問題，LeaveForm 原本就是 inline 呈現，
這次的改動是這幾輪討論延伸出來的優化，不屬於 #46 的範圍，commit message 不用 `Refs`/`Fixes`。

**`src/components/LeaveForm.jsx`**

- 把現有 `validate()` 拆成純函式 `computeLeaveFormWarnings({ startDate, days, periodStart, periodEnd,
  allRecords, editingRecord, settings, today })`，回傳 `Warning[]`：
  - `startDate` 空 → incomplete「請選擇請假開始日期」；有值但超出 `periodStart`/`periodEnd` → error
    「日期必須在本週年度範圍內」。
  - `days` 空 → incomplete「請輸入天數」；有值但 `<= 0` → error「天數必須大於 0」；有值但
    `!isQuarterStep(...)` → error「天數最小單位為 0.25（2 小時）」（兩條可能同時出現，例如 `-0.1`）。
  - 只有在 `startDate`／`days` 都沒有 blocking warning 時，才呼叫 `validateRecordsChain(...)`，失敗回
    傳 `scope: 'form'` 的 error「這筆請假超支可用額度上限，請確認天數是否正確」。
- `error` state 改成 `fieldWarnings` state（見 §3.0 命名）+ `touched` state（見 §3.5）。
- 兩個輸入框加 `onChange`（每次改變就重算，見 §3.4；取代原本的樂觀清空邏輯）以及 `onBlur`（標記
  touched）。
- quick-pick 天數按鈕的 `onClick`：同步標記 `days` 為 touched + 重算（帶 `{ days: n }` override，
  W16）。
- 月曆點選日期觸發的 sync effect（`selectedDate`）：設定 `startDate` 的同時，把 `startDate` 標記為
  touched（W16，修掉「主流路徑下超支警示永遠不顯示」的問題）。
- 編輯模式的 sync effect（`editingRecord`）：回填 `startDate`/`days` 的同時，把兩者都標記 touched。
- 送出按鈕 `disabled={fieldWarnings.some(w => isBlocking(w.tier))}`（永遠用未過濾的陣列，W14）。
- `handleSubmit`：因為計算已經是即時的，這裡不再需要「先全部標 touched、重算一次」這個步驟；直接讀
  目前的 `fieldWarnings`，若仍有 blocking warning 理論上按鈕本來就該是 disabled、不會被點到，這裡保
  留一個 `if (fieldWarnings.some(w => isBlocking(w.tier))) return` 純粹當防禦（不依賴它、不把它當成
  安全網）。
- `resetForm`／各 sync effect 重算時，一律用明確 override 參數呼叫（見 §3.5），不要依賴閉包值。

**測試**

- 單元測試：`computeLeaveFormWarnings` 的特徵測試，覆蓋 §3.3 的空值/有值分岔、以及「只有基本欄位都合
  法才會跑超支檢查」這條短路邏輯。
- e2e（`e2e/calendar-and-records.spec.js`）：
  - 新增：一進頁面（尚未點任何欄位）時，任何警示文字都不可見，但送出按鈕是 disabled。
  - 新增：在天數欄位打完合法值後，**不 blur、直接把滑鼠移到新增按鈕點擊**，新增要能成功（這是
    round 1 review 抓到的死路，B1 的回歸測試，務必補上）。
  - 新增：只透過點月曆選日期（不曾手動聚焦過日期輸入框），天數維持預設值即可構成超支時，超支警示
    文字要能正確顯示（W16 的回歸測試）。
  - 新增：blur 空日期欄位後，出現「請選擇請假開始日期」，樣式為中性色（可斷言 class 或直接斷言文字
    可見即可，不強求斷言確切顏色 class）。
  - 新增 0.25-倍數錯誤測試（既有覆蓋缺口）。
  - 既有「天數最小單位為 0.25」「超支」等測試：斷言方式不變（原本就是 `getByText`），確認觸發路徑
    改成「值一變就看得到」而不是「點送出才驗證」。

### Commit 3 — Settings 移除全部 `alert()`（`Fixes #46`）

**這個 commit 會讓大量既有 `page.once('dialog', …)` 測試失效，必須在同一個 commit 內把它們全部改寫**
（不能拆成兩個 commit，否則中間態會是「一半用 alert 一半用 inline」，無法通過完整測試）。

**`src/utils/settingsValidation.js`**（若尚未從 `handleSave` 抽出，這個 commit 一併做）

改寫成回傳 `Warning[]`（不再是 `string | null`）：

- 到職日空 → incomplete「請填寫到職日」。
- 逐列（`customRules`）：
  - `months` 空 → incomplete；非正整數或 >1200 → error「年資門檻請填寫 1200 個月（100 年）以內的正
    整數」；與其他列數值相同 → error「年資門檻「${months} 個月」重複，請合併或刪除其中一列」（沿用既
    有 alert 原文；掛在所有重複的列上，集中清單依門檻數值去重，見 W12 修訂版）。**兩列的 `months` 都
    還沒填時不算重複**（W15）——只比對「兩列都已經是合法正整數、且數值相同」的情況。
  - `days` 空 → incomplete；`<= 0` → error「天數須大於 0」；`> MAX_ANNUAL_LEAVE_DAYS` → error「天數不
    可超過 365 天」；`!isQuarterStep(...)` → error「天數須為 0.25 的倍數」（W4：三條獨立判斷，不合成
    一句）。
  - 每條都帶 `scope: 'row'` 與對應的 `rowId`。
- 規則清單為空 → error（集中顯示在表格上方；UI 已用「刪除鈕在剩一列時 disabled」防止正常操作走到這
  裡，這條算防禦性殘留邏輯，不用特別做精美呈現）。
- 成長列：
  - `perYear` 空 → incomplete；`< 0` → error「須大於等於 0」；`> MAX_ANNUAL_LEAVE_DAYS` → error「每
    年增加天數不可超過 365 天」；`!isQuarterStep(...)` → error「須為 0.25 的倍數」。
  - `cap`（僅 `perYear > 0` 時才驗證，`perYear === 0` 時欄位本來就停用）：空 → incomplete；
    `> MAX_ANNUAL_LEAVE_DAYS` → error「天數上限不可超過 365 天」；`!isQuarterStep(...)` → error「須為
    0.25 的倍數」；**低於最後一列天數 → error「天數上限不可低於最後一列的天數（X 天）」，但僅在最後
    一列的 `days` 本身沒有 blocking 警示時才做這個比較**（W15：最後一列天數當下若是空的或不合法，直
    接跳過這條檢查，不要拿無意義的值組訊息，例如「不可低於 -5 天」）。

**`src/components/Settings.jsx`**

- 移除所有 `alert(...)` 呼叫，改成套用 `settingsValidation.js` 回傳的 `Warning[]`（命名為
  `fieldWarnings`，見 §3.0）。
- 到職日輸入框、每一列的月數/天數輸入框、成長列的兩個輸入框都加 `onChange`（重算，§3.4）與 `onBlur`
  （標記 touched）；各自用 `<FieldWarnings />` 顯示該欄位對應的 warnings（依 touched 過濾）。
- 「門檻重複」「清單為空」這種跨列/跨表的錯誤，因為不屬於單一欄位，改成表格上方一個獨立的小區塊顯
  示（W3：不進合規清單那個大方框，是另一個、樣式同樣是 error tier 的小清單）。
- **`RuleTypeCard` 的 `onClick`（切換 `ruleType`）必須顯式呼叫重算並帶 `{ ruleType: next }`
  override**——這不是文字輸入，不會自動觸發任何重算。custom→labor 時舊的自訂列 warnings 需要因為這
  次重算而正確消失（該欄位已經 unmount，不可能再靠 blur 補救）；labor→custom 時合規清單需要因為這次
  重算而正確出現。不需要額外標記 touched——新出現的自訂列維持「未觸碰前不顯示」的一般規則。
- `addCustomRule`/`removeCustomRule` 同理，必須顯式呼叫重算並帶上變更後的 `customRules`。
- 合規警告清單（advisory）維持現行行為完全不動：不套用 touched 過濾，計算時機也不變（見 W7）。
- 「儲存設定」按鈕 `disabled={fieldWarnings.some(w => isBlocking(w.tier))}`（永遠用未過濾的陣列；只
  看 `ruleType === 'custom'` 時相關的欄位，`ruleType === 'labor'` 時不驗證自訂規則區塊，因為畫面上根
  本不會顯示那些欄位）。
- `handleSave`：計算已經是即時的，不再需要「送出時強制重跑」當安全網；保留一個
  `if (fieldWarnings.some(w => isBlocking(w.tier))) return` 純粹當防禦，不依賴它。

**視覺（W13）**：blocking 清單（跨列錯誤那個小區塊）跟 advisory 清單（合規警告）要在外觀上明顯不同
——沿用 W10 的色票，一個是中性/紅色系、一個是既有的琥珀色，且物理位置分開放（不要疊在同一個框裡）。

**e2e（`e2e/onboarding-and-settings.spec.js`、`e2e/resignation.spec.js`）**

- 全面搜尋 `page.once('dialog'` 並逐一改寫：原本斷言 `alertMessage` 的地方，改成先觸發對應欄位的值
  變動（或直接點擊儲存按鈕），再 `expect(page.getByText(...)).toBeVisible()`；原本「斷言 alert 出現
  後仍停留在設定頁」的邏輯改成「斷言儲存按鈕 disabled 或點擊後 `onSave` 沒被呼叫（頁面沒跳轉）」。
- 合規警告清單相關的既有測試**不需要修改**（W7 維持現行行為，計算與顯示時機都不變）。
- 新增：切換 `ruleType` 後（雙向），儲存按鈕的 disabled 狀態與合規清單要立即反映新的 ruleType，不需
  要額外互動才更新（C1 的回歸測試）。
- 新增：同時存在兩組不同數值的重複年資門檻時，集中清單要各自顯示一行，不能被去重成一行（C3 的回歸
  測試）。
- 新增：自訂規則最後一列天數目前是空值或不合法時，天數上限欄位不應該顯示「不可低於 X 天」這種帶著
  無意義數值的訊息（B2 的回歸測試）。
- 新增「到職日留空」的覆蓋缺口測試。「刪光所有列」的驗證因 UI 已用 disabled 刪除鈕擋住、正常操作碰
  不到，只留單元測試涵蓋，不寫假的 e2e。

### Commit 4 — 收尾（`Refs #46`）

- 全域搜尋 `dialog`/`page.once('dialog'` 確認 e2e 目錄裡沒有殘留。
- 文案覆核：本輪新增的所有中文使用者可見字串，沿用既有規則用全形標點「：」「，」「（」「）」。
- 補齊本輪新增行為、但 Commit 2/3 可能還沒覆蓋到的 e2e case：
  - touched 過濾（欄位沒 touched 過就不顯示訊息，但按鈕仍正確反映真實阻擋狀態）。
  - 兩層警示清單（blocking vs advisory）同時出現時，物理位置與樣式確實不同。
  - 「門檻重複」同時掛在兩列上，且訊息各自帶有正確的門檻數值。

---

## 5. 本輪不做的事

- 不改離職重來的 Modal 流程與外觀（W1）。
- 不改 `checkLaborLawCompliance` 的計算邏輯，也不改它的觸發時機與顯示位置——合規清單本輪完全不碰
  （見 W7、§1.1）。
- 不順便做 `882e0e7` 審閱報告裡的其他重構建議（R1–R12），包括 Settings.jsx 拆元件——除非本輪改動後單
  一檔案長度已經嚴重影響可維護性，否則不因為這次「順便」拆檔，是否要拆留給另一個獨立 issue 決定。
- 不做 P1-3（設定解鎖修正流程）、P2-6（離職結清明細化）等既有 backlog 項目。
- 不新增 `cap` 欄位的數值上界（沿用 D2/D10；`cap` 本身仍不設比 `MAX_ANNUAL_LEAVE_DAYS` 更嚴格的上
  界，只是這次補上原本就該有的 `≤ MAX_ANNUAL_LEAVE_DAYS` 訊息，不是新增更嚴格的限制）。
- 不改 `resignSummary` 的 `useMemo` 化等其他既有已知瑕疵。

---

## 6. 驗收清單

- [ ] Settings.jsx 與 LeaveForm.jsx 內都不再有任何 `alert(...)` 呼叫。
- [ ] 一進首頁／設定頁，在使用者做任何互動之前，畫面上不會出現任何 **incomplete／error** 警示文字
      （advisory 的合規建議清單不受此限，本來就會照現況顯示，包含鎖定頁一載入就要看到）；但若當下狀
      態本來就無法送出，動作按鈕仍是 disabled。
- [ ] 欄位值一變（`onChange`）就重算完畢，`disabled` 永遠反映最新結果；欄位 touched 之後，對應的警
      示文字（若有）即時出現，修正後即時消失，不需要點送出。
- [ ] **在任何欄位打完合法值後，不 blur、直接把滑鼠移到動作按鈕點擊，都能正確送出，不會卡在
      disabled 解不開**（B1 死路的回歸測試）。
- [ ] 只透過點月曆選日期（未曾手動聚焦過日期輸入框）就足以觸發超支時，超支警示文字要能正確顯示，不
      能因為日期欄位「沒被 touched」而被隱藏（W16 的回歸測試）。
- [ ] 自訂規則表格中，任兩列以上的驗證錯誤可以同時、各自顯示在各自列旁邊，不會互相覆蓋或需要「修好
      一個才看得到下一個」。
- [ ] 「天數須大於 0」「不可超過 365」「須為 0.25 的倍數」三條在自訂規則天數／`perYear`／`cap` 上都各
      自獨立判斷、獨立顯示。
- [ ] 同時存在兩組不同數值的重複年資門檻時，集中清單要各自顯示一行（各自帶正確的門檻數值），不能被
      去重成一行。
- [ ] 自訂規則最後一列天數是空值或不合法時，天數上限欄位不會顯示「不可低於 X 天」這種帶無意義數值
      的訊息。
- [ ] 切換 `ruleType`（雙向）後，儲存按鈕的 disabled 狀態與合規清單立即反映新狀態，不需要額外互動。
- [ ] 合規警告清單的計算時機、顯示規則維持現行行為完全不變（不套用 touched，不會 disable 儲存按
      鈕）。
- [ ] 會 disable 儲存的清單與合規警告清單在視覺上（顏色/標題）與物理位置上都能被分辨。
- [ ] 既有的「日期必須在本週年度範圍內」「這筆請假超支可用額度上限」「年資門檻重複」等判斷邏輯本身
      維持不變，數值結果與修改前一致——**唯一刻意接受的例外**：LeaveForm 天數欄位無上限，共用的
      `isQuarterStep` 在 `x*4` 溢位成 `Infinity` 時的判斷結果，與舊版 `x % 0.25` 在同樣極端值下可能不
      完全等價，這個差異已在 §3.1 的程式註解與此處明講。
- [ ] `e2e/` 目錄下沒有任何 `page.once('dialog', …)`。
- [ ] 本輪新增的所有中文使用者可見字串使用全形標點，與既有風格一致。
- [ ] 本輪沒有修改第 5 節列出的任何項目。

---

## 7. 確認紀錄

- W1–W14 由維護者於第一版全數確認；本版新增/修訂的 W6、W7、W12、W15、W16 已由維護者確認（round 1
  review 討論後）。
- Round 1 review 提出的 B1（死路）、B2（cap-vs-lastRow 未定義行為）、C1（ruleType 切換不重算）、C3
  （門檻重複去重丟失資訊）、C4（超支警示 AND 條件永遠不顯示）、D1（FieldWarnings 死碼）、D2
  （isQuarterStep 邊界差異）、D3（閉包陳舊值）、D4（perYear/cap 上界訊息缺稿）、D5（驗收清單措辭歧
  義）都已在本版處理，對應位置：B1/W16 → §1、§3.4、§3.5、Commit2；B2/W15 → §1、Commit3；C1 →
  Commit3；C3/W12 → §1、Commit3；D1 → §3.2、Commit1；D2 → §3.1；D3 → §3.5；D4 → Commit3；D5 → §6。
- C2（e2e 數量/行號爭議）在 W7 維持現行行為後不再適用：合規清單完全不動，相關 e2e 不需要任何修改。
- 文件審閱另外提出兩點措辭建議：（1）W7 的標籤從「已撤銷」改成與 W6 對等的「本輪修訂，取代原版」，
  避免 stateless 的 Coder/Reviewer 第一次讀到時，誤把「撤銷」當成整句決定內容都不算數；（2）新增
  §1.1，完整記錄「touched 為什麼不套用在 advisory」的推導（鎖定頁限制 → touched 管不到編輯中閃爍 →
  改 blur 會讓 advisory 與 fieldWarnings 的計算時機第一次分岔 → 維持現狀），W7、W11 都指回這裡。兩點
  都已處理。
- 對應 issue 為 [#46](https://github.com/corytu/annual-leave-calculator/issues/46)：Commit 1、4 標
  `Refs #46`，Commit 3 標 `Fixes #46`；Commit 2 不掛 issue 標籤（見該 commit 開頭的說明）。
- 目前沒有其他待確認事項；下一步是把本版送回 Coder/Reviewer 審閱迴圈（round 0 重新開始）。
