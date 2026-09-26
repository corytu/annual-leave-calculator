#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# agent-loop.sh — Coder / Reviewer 自動化審查迴圈
# ============================================================
#
# 用法:
#   ./agent-loop.sh plan <concept-plan-file> [seed-plan-file]
#       Plan 審查迴圈:Coder 產出實作計畫 -> Reviewer 審查 -> 迴圈直到核准
#       seed-plan-file(可省略):一份既有的實作計畫(例如上一次跑到輪數上限時,
#       Coder 最後一版還沒被審過的計畫)。有給的話就跳過 Round 0(不讓 Coder 從頭
#       產生初版),直接拿它當起點送 Reviewer 審查。用途是「接續」一次沒收斂的
#       plan 迴圈,避免從零重來把已經收斂的討論重新打開。
#
#   ./agent-loop.sh diff <base-ref> [approved-plan-file] [concept-plan-file]
#       Diff 覆核迴圈:對 <base-ref> 做 git diff(含新增的 untracked 檔案) -> Reviewer 覆核 -> 迴圈直到核准
#       approved-plan-file、concept-plan-file 都可省略、都可獨立給。
#       approved-plan-file(plan 迴圈核准的實作計畫)是主要核對依據——diff 該不該通過,
#       主要看有沒有照這份做,因為它是比概念計畫更精確、已經來回討論定案的執行契約。
#       concept-plan-file(最初的概念計畫)是安全網,不是主要核對依據:用來檢查 diff
#       或 approved plan 本身有沒有偷偷偏離原始設計決策/「不做的事」清單——避免
#       Coder/Reviewer 在 plan 迴圈裡剛好一起誤解了同一個地方,diff 覆核卻因為只看
#       approved plan 而檢查不出來。
#
# 前置需求:
#   - bash 4.4+、jq、git、claude CLI(已用訂閱 OAuth token 完成認證)
#   - 在 git repo 根目錄底下執行
#
# 設計重點:
#   - Coder 跟 Reviewer 都是完全 stateless:每一輪都是全新 session,不 --resume。
#     這是實測後的結論,不是預設立場:這個 devcontainer 環境下,headless 模式的
#     --resume 不只偶爾「找不到 session」,連新開的 session 有時候連基本工具
#     (例如 ExitPlanMode)都不完整,說明連續呼叫之間的狀態延續本身不可信任——
#     與其一直修補這件事,不如整個繞開它:雙方需要的脈絡,全部由腳本明確組進
#     每一輪的 prompt 裡,不依賴 CLI 自己記得任何東西。
#   - Plan 迴圈每一輪(包含 revise 輪)都會重新附上完整的概念計畫,因為不能假設
#     Coder 記得上一輪看過的內容。Coder 的計畫輸出用 --json-schema 強制放進
#     structured_output.plan 這個欄位,不依賴 .result——.result 只反映回應裡
#     最後一段文字,如果 Coder 在吐出完整計畫後又習慣性地呼叫工具(例如把計畫另外
#     存成檔案,就算被告知不需要也可能還是會做),.result 就只會剩下工具呼叫之後
#     的收尾文字,完整計畫反而被截斷在外;structured_output 是整個流程結束後另外
#     產生的最終答案,不受這個問題影響,這也是 Reviewer 從一開始就穩定的原因。
#   - plan 迴圈的 revise 輪有防呆:如果 Coder 回傳的新計畫長度明顯比上一輪短很多,
#     視為疑似「只回摘要、沒吐完整計畫」而直接中止,而不是讓退化默默發生。
#   - diff 迴圈用 `git add -N .`(intent-to-add)把新增的 untracked 檔案也納入 diff,
#     擷取完一定會把 index 復原,不留痕跡。擷取範圍會排除腳本自己(agent-loop.sh)
#     跟 `.agent-log/`,不管這兩者有沒有被修改過,都不會混進被審查的 diff 裡——
#     這是工具本身的狀態,不是要審查的程式碼。diff 迴圈的 Coder 修正也是無狀態的,
#     它靠讀取目前的實際檔案內容(它有 Read/Edit 工具)加上每輪重新附上的 diff
#     文字來掌握現況,不依賴記得自己之前做過什麼。
#   - Coder/Reviewer 收到的資料(概念計畫、實作計畫、diff)不是塞進命令列參數,而是寫成
#     檔案後叫它們用自己的 Read 工具去讀。這是為了閃避 Linux 對單一個命令列參數長度的
#     硬限制(MAX_ARG_STRLEN,常見 128KB)——這個限制遠低於一般人以為的 ARG_MAX 總量
#     上限(~2MB),這份審查資料很容易就超過,一旦超過會直接讓 claude 執行失敗、丟出
#     "Argument list too long",不是能靠腳本內部的檢查攔下來的軟性錯誤。
#   - 實際「實作」刻意不放進這支腳本:計畫核准後,你自己開一個
#     全新的互動 session(不是 --resume),把 approved-plan.md 的內容貼給它當起點,
#     互動著看它實作。這支腳本只自動化「審查來回」的部分。
#
# ============================================================

### ---- 前置檢查 ----

for bin in claude jq git; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "❌ 找不到 ${bin},請先安裝後再執行。" >&2
    exit 1
  fi
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 目前不在 git repo 底下,請切換到專案根目錄再執行。" >&2
  exit 1
fi

### ---- 設定區 ----

CODER_MODEL="claude-sonnet-5"
REVIEWER_MODEL="claude-opus-5-5"
CODER_EFFORT="high"
REVIEWER_EFFORT="high"
MAX_ROUNDS=5
LOG_ROOT=".agent-log"
# 資料是靠 Read 工具讀檔案,不是塞進命令列參數,不受 shell 參數長度限制;這個
# 門檻純粹是防止離譜過大的輸入把 model 的 context 灌爆的鬆散上限。
MAX_PROMPT_BYTES=3000000
# revise 輪的新計畫長度若低於上一輪的這個比例,視為疑似退化並中止(0.0–1.0)
PLAN_SHRINK_GUARD=0.6

TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${LOG_ROOT}/${TS}"
mkdir -p "${RUN_DIR}"

VERDICT_SCHEMA='{
  "type": "object",
  "properties": {
    "verdict": {"type": "string", "enum": ["approved", "revise"]},
    "issues": {"type": "array", "items": {"type": "string"}},
    "notes": {"type": "string"}
  },
  "required": ["verdict", "issues", "notes"]
}'

# Coder 在 plan 迴圈的輸出也走 schema,理由跟 VERDICT_SCHEMA 一樣:.result 這個欄位
# 似乎只反映回應裡「最後一段文字」,如果 Coder 在吐出完整計畫文字之後又呼叫了
# 工具(例如把計畫存進 /home/node/.claude/plans/,這是它即使被告知不需要、仍然會
# 做的習慣動作),.result 就只會剩下工具呼叫之後的收尾文字,完整計畫反而被截斷在外。
# structured_output 是整個推理/工具呼叫流程結束後另外產生的最終答案,不受這個問題影響。
PLAN_SCHEMA='{
  "type": "object",
  "properties": {
    "plan": {"type": "string"}
  },
  "required": ["plan"]
}'

### ---- 工具函式 ----

log() {
  local suffix="$1" role="$2" content="$3"
  local file="${RUN_DIR}/${suffix}.md"
  {
    echo "## ${role} — $(date +%H:%M:%S)"
    echo
    echo "${content}"
    echo
  } >>"${file}"
  echo "  [log] ${role} -> ${file}"
}

require_success() {
  local resp="$1" label="$2"
  if [[ "$(echo "${resp}" | jq -r '.is_error')" == "true" ]]; then
    echo "❌ ${label} 執行失敗:" >&2
    echo "${resp}" | jq -r '.result' >&2
    exit 1
  fi
}

assert_reasonable_size() {
  # 這裡的門檻不是為了閃避 shell 的參數長度限制(現在資料是靠 Read 工具讀檔案,
  # 不再塞進命令列參數,不會撞到那個限制了),純粹是防止離譜過大的輸入把 model
  # 的 context 灌爆、或不小心整個 repo 誤觸,不是精算過的臨界值。
  local file="$1" label="$2"
  local size
  size="$(wc -c <"${file}")"
  if ((size > MAX_PROMPT_BYTES)); then
    echo "❌ ${label} 有 ${size} bytes,超過安全上限 ${MAX_PROMPT_BYTES} bytes。" >&2
    echo "   請縮小審查範圍(例如只 diff 特定路徑,或拆成多次審查)後再試一次。" >&2
    exit 1
  fi
}

coder_call() {
  # coder_call <prompt-file> <permission-mode> [schema]
  # 完全 stateless:每次都是全新 session,不 --resume。需要的脈絡(概念計畫、
  # 目前進度、Reviewer 意見)全部由呼叫端組進 prompt_file 這個檔案裡,見檔頭說明。
  #
  # 注意:-p 只傳一句短指令,叫它自己用 Read 工具去讀 prompt_file,不把檔案內容
  # 塞進命令列參數。Linux 對單一個參數本身的長度有一個遠低於總參數量上限的
  # 硬限制(MAX_ARG_STRLEN,常見是 128KB),這份審查資料(概念計畫+實作計畫+diff)
  # 很容易就超過,一旦超過會直接讓 claude 這個執行檔啟動失敗、丟出
  # "Argument list too long",不是 assert_reasonable_size 那種軟性的、可控的錯誤。
  #
  # schema(可省略):有給的話會加上 --json-schema,回應改從 .structured_output
  # 讀,不受 .result 只反映「最後一段文字」這個限制影響。plan 迴圈用這個;diff
  # 迴圈的修正呼叫不需要結構化輸出,不傳這個參數。
  local prompt_file="$1" perm_mode="$2" schema="${3:-}"
  assert_reasonable_size "${prompt_file}" "Coder prompt"

  local abs_path
  abs_path="$(cd "$(dirname "${prompt_file}")" && pwd)/$(basename "${prompt_file}")"
  local instruction="請完整閱讀 ${abs_path} 這個檔案的內容,裡面包含你這次需要的完整任務說明與所有背景資料,並依照裡面的指示執行。"

  local schema_args=()
  if [[ -n "${schema}" ]]; then
    schema_args=(--json-schema "${schema}")
  fi

  local err_file="${RUN_DIR}/.last-coder-stderr"
  local resp
  resp="$(claude -p "${instruction}" \
    --model "${CODER_MODEL}" \
    --effort "${CODER_EFFORT}" \
    --permission-mode "${perm_mode}" \
    --output-format json \
    "${schema_args[@]}" 2>"${err_file}")"
  local err_text
  err_text="$(cat "${err_file}" 2>/dev/null || true)"
  rm -f "${err_file}"
  if [[ -n "${err_text}" ]]; then
    echo "${err_text}" >&2
  fi

  echo "${resp}"
}

reviewer_call() {
  # 完全 stateless。同樣改用「讀檔案」而不是「塞進參數」,理由見 coder_call 的註解。
  local prompt_file="$1"
  assert_reasonable_size "${prompt_file}" "Reviewer prompt"

  local abs_path
  abs_path="$(cd "$(dirname "${prompt_file}")" && pwd)/$(basename "${prompt_file}")"
  local instruction="請完整閱讀 ${abs_path} 這個檔案的內容,裡面包含你這次需要審查的完整資料,並依照裡面的指示執行審查。"

  claude -p "${instruction}" \
    --model "${REVIEWER_MODEL}" \
    --effort "${REVIEWER_EFFORT}" \
    --allowedTools "Read,Grep,Glob" \
    --output-format json \
    --json-schema "${VERDICT_SCHEMA}"
}

capture_diff_including_untracked() {
  # capture_diff_including_untracked <base-ref> <output-file>
  # 用 --intent-to-add 把新增的 untracked 檔案暫時標記進 index,讓 git diff 抓得到,
  # 完成後不管成功失敗都會把 index 復原。diff 範圍會排除腳本自己(靠 $0 動態算出
  # 相對路徑)跟 LOG_ROOT,避免這支腳本自己的異動或執行紀錄混進被審查的 diff。不用
  # trap,直接手動控制 set -e,確保復原這一步不會因為中途出錯而被跳過。
  local base_ref="$1" out_file="$2"

  set +e
  git add -N . 2>/dev/null
  local add_rc=$?
  local diff_rc=0
  if [[ ${add_rc} -eq 0 ]]; then
    local repo_root self_path
    repo_root="$(git rev-parse --show-toplevel)"
    self_path="$(realpath --relative-to="${repo_root}" "$0" 2>/dev/null || true)"
    if [[ -n "${self_path}" ]]; then
      git diff "${base_ref}" -- . ":(exclude)${self_path}" ":(exclude)${LOG_ROOT}" >"${out_file}"
    else
      git diff "${base_ref}" -- . ":(exclude)${LOG_ROOT}" >"${out_file}"
    fi
    diff_rc=$?
  fi
  if ! git restore --staged . >/dev/null 2>&1; then
    echo "⚠️ git restore --staged . 失敗,index 可能殘留 intent-to-add 標記,請自行檢查 git status。" >&2
  fi
  set -e

  if [[ ${add_rc} -ne 0 ]]; then
    echo "❌ 無法將新檔案標記進 index(git add -N .),中止這一輪 diff 擷取。" >&2
    return 1
  fi
  if [[ ${diff_rc} -ne 0 ]]; then
    echo "❌ git diff 失敗(exit ${diff_rc})。" >&2
    return 1
  fi
  return 0
}

### ---- Plan 審查迴圈 ----

run_plan_review_loop() {
  local concept_plan_file="$1"
  local seed_plan_file="${2:-}"
  if [[ ! -f "${concept_plan_file}" ]]; then
    echo "❌ 找不到概念計畫檔案: ${concept_plan_file}" >&2
    exit 1
  fi

  local plan_text
  if [[ -n "${seed_plan_file}" ]]; then
    # 接續模式:跳過 Round 0,直接用既有計畫當起點。
    if [[ ! -s "${seed_plan_file}" ]]; then
      echo "❌ 找不到起始計畫檔案,或檔案是空的: ${seed_plan_file}" >&2
      exit 1
    fi
    echo "=== Round 0: 略過 Coder 初版產出,以 ${seed_plan_file} 作為起始實作計畫 ==="
    cp "${seed_plan_file}" "${RUN_DIR}/seed-plan.md"
    plan_text="$(cat "${seed_plan_file}")"
    log "round-0" "Seed plan(來源:${seed_plan_file})" "${plan_text}"
  else
    echo "=== Round 0: Coder 產出初版實作計畫(plan mode) ==="
    local prompt_file="${RUN_DIR}/round-0-coder-prompt.txt"
    {
      echo "以下是已經敲定的概念計畫。請以 plan mode 產出一份詳細的程式實作計畫(不要修改任何檔案),"
      echo "內容要包含具體的檔案異動範圍、資料流、以及你認為需要特別注意的邊界情境。"
      echo
      echo "**請把完整的實作計畫放進回覆的結構化 plan 欄位裡。不需要另外把計畫存成"
      echo "檔案或使用任何工具——就算你習慣這麼做,這次也不需要,plan 欄位裡的內容"
      echo "才是唯一會被後續流程讀取的地方。**"
      echo "**對於比較關鍵的設計決策,請在計畫裡順手註記簡短理由(為什麼這樣做、"
      echo "排除了哪些替代方案)——這是全新的 session,理由如果沒有寫進計畫文字本身,"
      echo "之後就再也看不到了。**"
      echo
      echo "## 概念計畫"
      cat "${concept_plan_file}"
    } >"${prompt_file}"

    local resp
    resp="$(coder_call "${prompt_file}" "plan" "${PLAN_SCHEMA}")"
    require_success "${resp}" "Coder(round 0)"
    plan_text="$(echo "${resp}" | jq -r '.structured_output.plan // empty')"
    log "round-0" "Coder(plan)" "${plan_text}"
  fi

  local prev_verdict_text=""
  local round=1
  while ((round <= MAX_ROUNDS)); do
    echo "=== Round ${round}: Reviewer 審查中 ==="
    local rprompt="${RUN_DIR}/round-${round}-reviewer-prompt.txt"
    {
      echo "以下是概念計畫與 Coder 提出的實作計畫,請檢查是否符合概念計畫、是否有遺漏、"
      echo "邏輯錯誤、或沒考慮到的邊界情境。"
      if [[ -n "${prev_verdict_text}" ]]; then
        echo
        echo "## 你上一輪提出的意見(請檢查這一版是否已經處理)"
        echo "${prev_verdict_text}"
      fi
      echo
      echo "## 概念計畫"
      cat "${concept_plan_file}"
      echo
      echo "## Coder 提出的實作計畫"
      echo "${plan_text}"
    } >"${rprompt}"

    local rresp
    rresp="$(reviewer_call "${rprompt}")"
    require_success "${rresp}" "Reviewer(round ${round})"
    local verdict_json
    verdict_json="$(echo "${rresp}" | jq -c '.structured_output')"
    log "round-${round}" "Reviewer" "${verdict_json}"
    prev_verdict_text="${verdict_json}"

    local verdict
    verdict="$(echo "${verdict_json}" | jq -r '.verdict')"

    if [[ "${verdict}" == "approved" ]]; then
      echo "=== ✅ Reviewer 核准,共 ${round} 輪 ==="
      echo "${plan_text}" >"${RUN_DIR}/approved-plan.md"
      echo "最終計畫已存到 ${RUN_DIR}/approved-plan.md"
      return 0
    fi

    echo "=== Round ${round}: Coder 修改計畫中 ==="
    local cprompt="${RUN_DIR}/round-${round}-coder-prompt.txt"
    {
      echo "以下是概念計畫,以及你上一版的實作計畫,還有 Reviewer 對它提出的意見(JSON 格式)。"
      echo "請逐項評估是否接受、說明理由,並據此修改你的實作計畫。"
      echo
      echo "**重要:請把「完整」的修改後計畫放進回覆的結構化 plan 欄位裡,不要只放"
      echo "修改摘要或差異說明——這是全新的 session,沒看過你之前說過的內容,只看得到"
      echo "以下提供的資訊。對於關鍵設計決策(不管是沿用上一版的,還是這次因應意見"
      echo "調整的),請保留或補上簡短理由在計畫文字裡,不要讓理由只存在於你這輪的"
      echo "思考過程裡卻沒寫進去。**"
      echo
      echo "## 概念計畫"
      cat "${concept_plan_file}"
      echo
      echo "## 你上一版的實作計畫"
      echo "${plan_text}"
      echo
      echo "## Reviewer 的意見"
      echo "${verdict_json}"
    } >"${cprompt}"

    local cresp
    cresp="$(coder_call "${cprompt}" "plan" "${PLAN_SCHEMA}")"
    require_success "${cresp}" "Coder(round ${round} revise)"
    local new_plan_text
    new_plan_text="$(echo "${cresp}" | jq -r '.structured_output.plan // empty')"

    local prev_len=${#plan_text}
    local new_len=${#new_plan_text}
    local guard_pct
    guard_pct="$(awk -v g="${PLAN_SHRINK_GUARD}" 'BEGIN{printf "%d", g*100}')"
    if ((prev_len > 200)) && ((new_len * 100 < prev_len * guard_pct)); then
      log "round-${round}" "Coder(revise, 疑似不完整)" "${new_plan_text}"
      echo "❌ Coder 這輪回覆(${new_len} 字元)比上一版計畫(${prev_len} 字元)短很多,懷疑它" >&2
      echo "   只回了摘要式的修改說明,而不是完整計畫。已停止,請檢查:" >&2
      echo "   ${RUN_DIR}/round-${round}.md 裡的內容,確認後可以手動要求 Coder 重新吐出完整計畫。" >&2
      exit 1
    fi

    plan_text="${new_plan_text}"
    log "round-${round}" "Coder(revise)" "${plan_text}"

    round=$((round + 1))
  done

  echo "=== ⚠️ 已達 ${MAX_ROUNDS} 輪上限仍未核准,請手動檢查 ${RUN_DIR} ===" >&2
  return 1
}

### ---- Diff 覆核迴圈 ----

run_diff_review_loop() {
  local base_ref="$1"
  local approved_plan_file="${2:-}"
  local concept_plan_file="${3:-}"

  local prev_verdict_text=""
  local round=1
  while ((round <= MAX_ROUNDS)); do
    local diff_file="${RUN_DIR}/round-${round}-diff.patch"
    if ! capture_diff_including_untracked "${base_ref}" "${diff_file}"; then
      return 1
    fi

    if [[ ! -s "${diff_file}" ]]; then
      echo "⚠️ 對 ${base_ref} 的 diff 是空的,先確認變更是否已存在工作目錄裡再重跑。" >&2
      return 1
    fi

    echo "=== Round ${round}: Reviewer 覆核 diff 中 ==="
    local rprompt="${RUN_DIR}/round-${round}-reviewer-diff-prompt.txt"
    {
      echo "以下是這次實作相對於 ${base_ref} 的 git diff(含新增檔案),請檢查施工品質、"
      echo "是否符合計畫、有沒有邊界情境或錯誤處理被遺漏。"
      if [[ -n "${approved_plan_file}" && -f "${approved_plan_file}" ]]; then
        echo
        echo "## 已核准的實作計畫(主要核對依據:diff 該不該通過,主要看有沒有照這份做)"
        cat "${approved_plan_file}"
      fi
      if [[ -n "${concept_plan_file}" && -f "${concept_plan_file}" ]]; then
        echo
        echo "## 概念計畫(安全網,不是主要核對依據:如果發現 diff 或上面的實作計畫本身"
        echo "跟這份文件的設計決策/「不做的事」清單有出入,這件事本身要當成一個 issue"
        echo "提出來,不要因為實作計畫這樣寫就假設一定是對的)"
        cat "${concept_plan_file}"
      fi
      if [[ -n "${prev_verdict_text}" ]]; then
        echo
        echo "## 你上一輪提出的意見(請檢查這一版是否已經處理)"
        echo "${prev_verdict_text}"
      fi
      echo
      cat "${diff_file}"
    } >"${rprompt}"

    local rresp
    rresp="$(reviewer_call "${rprompt}")"
    require_success "${rresp}" "Reviewer(diff round ${round})"
    local verdict_json
    verdict_json="$(echo "${rresp}" | jq -c '.structured_output')"
    log "round-${round}-diff" "Reviewer" "${verdict_json}"
    prev_verdict_text="${verdict_json}"

    local verdict
    verdict="$(echo "${verdict_json}" | jq -r '.verdict')"

    if [[ "${verdict}" == "approved" ]]; then
      echo "=== ✅ diff 已核准,共 ${round} 輪 ==="
      return 0
    fi

    echo "=== Round ${round}: Coder 修正實作中(會直接改檔案) ==="
    local cprompt="${RUN_DIR}/round-${round}-coder-fix-prompt.txt"
    {
      if [[ -n "${approved_plan_file}" && -f "${approved_plan_file}" ]]; then
        echo "## 已核准的實作計畫(你這次修正時的主要依據)"
        cat "${approved_plan_file}"
        echo
      fi
      if [[ -n "${concept_plan_file}" && -f "${concept_plan_file}" ]]; then
        echo "## 概念計畫(原始設計決策,修正時不要違反)"
        cat "${concept_plan_file}"
        echo
      fi
      echo "## 這次實作目前相對於 ${base_ref} 的 diff"
      cat "${diff_file}"
      echo
      echo "Reviewer 對這次實作提出以下意見(JSON 格式)。請逐項評估是否接受、"
      echo "說明理由,並據此直接修改程式碼。這是全新的 session,你需要的脈絡都在"
      echo "上面提供了,不需要依賴任何先前的對話記憶。"
      echo
      echo "${verdict_json}"
    } >"${cprompt}"

    local cresp
    cresp="$(coder_call "${cprompt}" "auto")"
    require_success "${cresp}" "Coder(diff round ${round} fix)"
    log "round-${round}-diff" "Coder(fix)" "$(echo "${cresp}" | jq -r '.result')"

    round=$((round + 1))
  done

  echo "=== ⚠️ 已達 ${MAX_ROUNDS} 輪上限仍未核准,請手動檢查 ${RUN_DIR} ===" >&2
  return 1
}

### ---- 進入點 ----

case "${1:-}" in
plan)
  run_plan_review_loop "${2:?請提供概念計畫檔案路徑,例如: docs/plan-concept.md}" "${3:-}"
  ;;
diff)
  run_diff_review_loop "${2:?請提供要比較的 base ref,例如: master 或某個 commit hash}" "${3:-}" "${4:-}"
  ;;
*)
  echo "用法: $0 plan <concept-plan-file> [seed-plan-file] | diff <base-ref> [approved-plan-file] [concept-plan-file]" >&2
  exit 1
  ;;
esac
