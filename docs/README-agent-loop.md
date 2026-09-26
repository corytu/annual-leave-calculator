# `agent-loop.sh` 使用說明

[`agent-loop.sh`](../agent-loop.sh) 是這輪開發過程中用來自動化「Coder ⇄ Reviewer」多輪審查流程的輔助腳本，與特休計算機本身的功能沒有直接關聯。它透過 Claude Code CLI 分別呼叫兩個角色互相審查「實作計畫」或「程式碼 diff」，直到審查者核准，或達到輪數上限為止。

## 這是什麼

腳本會扮演兩個角色：

- **Coder**（`claude-sonnet-5`，effort `high`）：產出或修改實作計畫，或依審查意見直接修改程式碼
- **Reviewer**（`claude-opus-5`，effort `high`）：唯讀審查 Coder 的產出，回傳結構化的核准結果

兩者輪流審查，直到 Reviewer 回傳 `verdict: approved`，或執行輪數達到上限（預設 5 輪）為止。

## 前置需求

- `bash` 4.4+、`jq`、`git`
- 已完成認證的 `claude` CLI（例如透過訂閱 OAuth token）
- 需在 git repo 根目錄下執行（腳本會用 `git rev-parse --is-inside-work-tree` 檢查）

若使用本專案的 [Dev Container](../README.md#使用-dev-container建議)，`claude` 與 `jq` 已經預先安裝好；若在本機手動安裝環境，需自行確認上述工具都已就緒。

## 使用方式

```shell
./agent-loop.sh plan <concept-plan-file> [seed-plan-file]
./agent-loop.sh diff <base-ref> [approved-plan-file] [concept-plan-file]
```

### `plan`：Plan 審查迴圈

Coder 先以 `--permission-mode plan`（不會修改任何檔案）依據給定的概念計畫（concept plan）產出一份實作計畫，透過 `--json-schema` 放進結構化回應的 `plan` 欄位。接著 Reviewer 逐輪審查：

- 若核准，最終計畫會寫入本次執行的 log 目錄下的 `approved-plan.md`
- 若要求修改，Coder 必須重新吐出**完整**的修改後計畫（而非摘要或差異說明）；腳本有一個防呆機制（`PLAN_SHRINK_GUARD`，預設 0.6）：如果新計畫的字數明顯低於上一版的 60%，會判定疑似只回了摘要而中止執行，避免這種退化悄悄發生

**`seed-plan-file`（可省略）**：一份既有的實作計畫（例如上一次跑到輪數上限時，Coder 最後一版還沒被審過的計畫）。有給的話會跳過 Round 0（不讓 Coder 從頭產生初版），直接拿它當起點送 Reviewer 審查。用途是「接續」一次沒收斂的 plan 迴圈，避免從零重來把已經收斂的討論重新打開。

### `diff`：Diff 覆核迴圈

對 `<base-ref>` 做 `git diff`（透過 `git add -N .` 暫時把新增的 untracked 檔案也納入，擷取完一定會復原 index，不留痕跡），排除腳本自身與 log 目錄後交給 Reviewer 覆核。若要求修改，Coder 會以 `--permission-mode auto` **直接修改工作目錄裡的檔案**。

`approved-plan-file` 與 `concept-plan-file` 都是選填、可以只給其中一個：

- **`approved-plan-file`**：`plan` 迴圈核准的實作計畫，是這一輪的**主要核對依據**——diff 該不該通過，主要看有沒有照這份做，因為它是比概念計畫更精確、已經來回討論定案的執行契約
- **`concept-plan-file`**：最初的概念計畫，是**安全網、不是主要核對依據**，用來檢查 diff 或 approved plan 本身有沒有偷偷偏離原始設計決策，避免 Coder 跟 Reviewer 在 plan 迴圈裡剛好一起誤解了同一個地方，diff 覆核卻因為只看 approved plan 而檢查不出來

## 這支腳本涵蓋的範圍

這支腳本只自動化「審查來回」，**不包含實際動手「實作」**：`plan` 迴圈核准之後，你需要自行開一個全新的互動 `claude` session（不是 `--resume`），把 `approved-plan.md` 的內容貼給它當起點，互動著看它實作。實作完成後，再用 `diff` 子指令對這次的變更跑覆核迴圈。

## 可調整的設定值

腳本開頭的設定區列出以下常數，可依需求調整：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `CODER_MODEL` | `claude-sonnet-5` | Coder 使用的模型 |
| `REVIEWER_MODEL` | `claude-opus-5-5` | Reviewer 使用的模型 |
| `CODER_EFFORT` | `high` | Coder 的 reasoning effort |
| `REVIEWER_EFFORT` | `high` | Reviewer 的 reasoning effort |
| `MAX_ROUNDS` | `5` | 單次執行最多跑幾輪還沒核准就放棄 |
| `LOG_ROOT` | `.agent-log` | 執行紀錄的根目錄（已加入 `.gitignore`） |
| `MAX_PROMPT_BYTES` | `3000000` | 單一 prompt 檔案的大小上限，純粹是防止把 model 的 context 灌爆的鬆散上限，並非 shell 參數長度限制（見下方設計取捨說明） |
| `PLAN_SHRINK_GUARD` | `0.6` | `plan` 迴圈 revise 輪的新計畫長度低於上一版的這個比例時，視為疑似退化並中止 |

## 輸出內容

每次執行會在 `.agent-log/<YYYYMMDD-HHMMSS>/` 底下建立一個目錄（已加入 `.gitignore`，不會進版控），內含：

- 每一輪送給 Coder／Reviewer 的完整 prompt 檔（例如 `round-1-coder-prompt.txt`、`round-1-reviewer-prompt.txt`）
- 每一輪的審查紀錄（`round-N.md`、`round-N-diff.md`）
- `diff` 模式下每一輪擷取到的 diff 內容（`round-N-diff.patch`）
- `plan` 模式核准後的最終計畫（`approved-plan.md`）

## 設計上的重要取捨

- **Coder／Reviewer 都是完全 stateless，不用 `--resume`**：每一輪都是全新的 session，需要的脈絡（概念計畫、目前進度、上一輪審查意見）全部由腳本明確組進當輪的 prompt 檔案裡。這是實測後的結論：在 Dev Container 裡，headless 模式的 `--resume` 不只偶爾「找不到 session」，連新開的 session 有時候連基本工具（例如 `ExitPlanMode`）都不完整，說明連續呼叫之間的狀態延續本身不可信任；後續（commit `df615fc`）發現這個現象也有可能不是 `--resume` 本身的問題，而是容器裡的 `node` 使用者一開始無法存取自己 home 目錄下的 `.claude` 資料夾所致（該 commit 已修正 `devcontainer.json` 的檔案權限），但因為 stateless 版本當時已經成功跑完一輪 plan 審查迴圈，就沒有立即改回使用 `--resume`，所以維持 stateless 至今
- **資料透過檔案 + `Read` 工具傳遞，而不是塞進命令列參數**：Linux 對單一個命令列參數本身的長度有一個硬限制（`MAX_ARG_STRLEN`，常見是 128KB），遠低於一般人以為的 `ARG_MAX` 總量上限（約 2MB），審查資料（概念計畫 + 實作計畫 + diff）很容易就超過這個限制，一旦超過會直接讓 `claude` 執行檔啟動失敗、丟出 `"Argument list too long"`，這是無法靠腳本內部檢查攔下來的錯誤，因此腳本改成把資料寫成檔案，只傳一句「請讀取這個檔案」的短指令，交由 Coder／Reviewer 自己用 `Read` 工具讀取完整內容
- **`diff` 擷取範圍會動態排除腳本自身與 log 目錄**：不論 `agent-loop.sh` 或 `.agent-log/` 有沒有被修改過，都不會混進被審查的 diff 裡，因為這些是工具本身的狀態，不是要審查的程式碼
- **Coder 在 plan 迴圈的輸出也走 `--json-schema`，不讀 `.result`**：`.result` 只反映回應裡「最後一段文字」，如果 Coder 在吐出完整計畫後又習慣性地呼叫了工具（例如把計畫另外存成檔案，就算被告知不需要也可能還是會做），`.result` 就只會剩下工具呼叫之後的收尾文字，完整計畫反而被截斷在外；結構化輸出的 `plan` 欄位是整個推理／工具呼叫流程結束後另外產生的最終答案，不受這個問題影響，這也是 Reviewer 的 `verdict` 一開始就採用相同做法的理由（見下方「Reviewer 輸出格式」）

## Reviewer 輸出格式

Reviewer 透過 `--json-schema` 被強制輸出結構化 JSON：

```json
{
  "verdict": "approved 或 revise",
  "issues": ["具體問題列表"],
  "notes": "補充說明"
}
```

且僅被授權使用唯讀工具（`Read`、`Grep`、`Glob`），不會修改任何檔案。
