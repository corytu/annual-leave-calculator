#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# agent-loop.sh — Coder / Reviewer 自動化審查迴圈
# ============================================================
#
# 用法:
#   ./agent-loop.sh plan <concept-plan-file>
#       步驟 3–5:Coder 產出實作計畫 -> Reviewer 審查 -> 迴圈直到核准
#
#   ./agent-loop.sh diff <base-ref>
#       步驟 7:對 <base-ref> 做 git diff(含新增的 untracked 檔案) -> Reviewer 覆核 -> 迴圈直到核准
#
#   ./agent-loop.sh reset
#       清除目前 git branch 對應的 Coder session 記錄,下次 plan/diff 會開全新 session。
#
# 前置需求:
#   - bash 4.4+、jq、git、claude CLI(已用訂閱 OAuth token 完成認證)
#   - 在 git repo 根目錄底下執行
#
# 設計重點:
#   - Coder 是唯一會跨輪、跨 plan/diff 兩個階段延續記憶的 session:狀態存在
#     `.agent-log/.state/<目前 git branch>/coder-session-id`,跟 branch 綁定。
#     想重新開始就跑 `./agent-loop.sh reset`。
#   - Reviewer 完全 stateless:每一輪都是全新 session,不 --resume。它對「自己
#     上一輪說過什麼」的記憶,是靠腳本把上一輪的 verdict 文字附進這一輪的 prompt
#     裡做到的,避免 token 隨輪數疊代式膨脹,也避免對自己先前的判斷產生錨定效應。
#   - plan 迴圈的 revise 輪有防呆:如果 Coder 回傳的新計畫長度明顯比上一輪短很多,
#     視為疑似「只回摘要、沒吐完整計畫」而直接中止,而不是讓退化默默發生。
#   - diff 迴圈用 `git add -N .`(intent-to-add)把新增的 untracked 檔案也納入 diff,
#     擷取完一定會把 index 復原,不留痕跡。
#   - 大檔案在送進 claude 前會先做 byte 數檢查,避免觸發 shell 的
#     "Argument list too long"。
#   - 實際「實作」(原本流程的步驟 6)刻意不放進這支腳本:計畫核准後,你自己在
#     terminal 用 `claude --resume $(cat .agent-log/.state/<branch>/coder-session-id)`
#     接續那個 Coder session、互動著看它實作。這支腳本只自動化「審查來回」的部分。
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
REVIEWER_MODEL="claude-opus-5"
CODER_EFFORT="high"
REVIEWER_EFFORT="high"
MAX_ROUNDS=5
LOG_ROOT=".agent-log"
MAX_PROMPT_BYTES=800000
# revise 輪的新計畫長度若低於上一輪的這個比例,視為疑似退化並中止(0.0–1.0)
PLAN_SHRINK_GUARD=0.6

BRANCH="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
STATE_DIR="${LOG_ROOT}/.state/${BRANCH}"
CODER_SESSION_FILE="${STATE_DIR}/coder-session-id"
mkdir -p "${STATE_DIR}"

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

save_session_id() {
  local resp="$1" file="$2"
  local sid
  sid="$(echo "${resp}" | jq -r '.session_id // empty')"
  if [[ -n "${sid}" && "${sid}" != "null" ]]; then
    echo "${sid}" >"${file}"
  else
    echo "⚠️ 這次回應沒有取得有效的 session_id,下一輪可能無法正確 --resume。" >&2
  fi
}

assert_reasonable_size() {
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
  # coder_call <prompt-file> <permission-mode> [recovery-context-file]
  # recovery-context-file(可省略):如果 --resume 失敗且是已知的「session 遺失」問題
  # (Claude Code headless 模式下的已知 bug,在 devcontainer 這類非標準環境更容易觸發),
  # 就用這份內容重新開一個新 session、手動把進度接回去,而不是讓整支腳本崩潰、
  # 白費前面幾輪的工。
  local prompt_file="$1" perm_mode="$2" recovery_file="${3:-}"
  assert_reasonable_size "${prompt_file}" "Coder prompt"

  local resume_args=()
  if [[ -f "${CODER_SESSION_FILE}" ]]; then
    resume_args=(--resume "$(cat "${CODER_SESSION_FILE}")")
  fi

  local resp
  resp="$(claude -p "$(cat "${prompt_file}")" \
    --model "${CODER_MODEL}" \
    --effort "${CODER_EFFORT}" \
    --permission-mode "${perm_mode}" \
    --output-format json \
    "${resume_args[@]}")"

  if ((${#resume_args[@]} > 0)) && \
     echo "${resp}" | jq -e '.is_error == true and (.result | test("No conversation found"))' >/dev/null 2>&1; then
    echo "⚠️ 偵測到已知的 Claude Code --resume 問題(session 遺失),自動開新 session 接續進度。" >&2
    rm -f "${CODER_SESSION_FILE}"
    local recovered_prompt="${prompt_file}.recovered"
    {
      echo "(注意:因為 Claude Code 已知的 --resume 問題,你先前的 session 遺失了,"
      echo "這是一個全新的 session。以下先提供你目前的進度作為基準,再接原本的請求。)"
      echo
      if [[ -n "${recovery_file}" && -f "${recovery_file}" ]]; then
        echo "## 目前進度"
        cat "${recovery_file}"
        echo
      fi
      echo "## 原本的請求"
      cat "${prompt_file}"
    } >"${recovered_prompt}"

    resp="$(claude -p "$(cat "${recovered_prompt}")" \
      --model "${CODER_MODEL}" \
      --effort "${CODER_EFFORT}" \
      --permission-mode "${perm_mode}" \
      --output-format json)"
  fi

  echo "${resp}"
}

reviewer_call() {
  # 故意不 --resume。Reviewer 每輪都是全新 session,見檔頭說明。
  local prompt_file="$1"
  assert_reasonable_size "${prompt_file}" "Reviewer prompt"
  claude -p "$(cat "${prompt_file}")" \
    --model "${REVIEWER_MODEL}" \
    --effort "${REVIEWER_EFFORT}" \
    --allowedTools "Read,Grep,Glob" \
    --output-format json \
    --json-schema "${VERDICT_SCHEMA}"
}

capture_diff_including_untracked() {
  # capture_diff_including_untracked <base-ref> <output-file>
  # 用 --intent-to-add 把新增的 untracked 檔案暫時標記進 index,讓 git diff 抓得到,
  # 完成後不管成功失敗都會把 index 復原。不用 trap,直接手動控制 set -e,確保
  # 復原這一步不會因為中途出錯而被跳過。
  local base_ref="$1" out_file="$2"

  set +e
  git add -N . 2>/dev/null
  local add_rc=$?
  local diff_rc=0
  if [[ ${add_rc} -eq 0 ]]; then
    git diff "${base_ref}" >"${out_file}"
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

### ---- 步驟 3–5:Plan 審查迴圈 ----

run_plan_review_loop() {
  local concept_plan_file="$1"
  if [[ ! -f "${concept_plan_file}" ]]; then
    echo "❌ 找不到概念計畫檔案: ${concept_plan_file}" >&2
    exit 1
  fi

  echo "=== Round 0: Coder 產出初版實作計畫(plan mode) ==="
  local prompt_file="${RUN_DIR}/round-0-coder-prompt.txt"
  {
    echo "以下是已經敲定的概念計畫。請以 plan mode 產出一份詳細的程式實作計畫(不要修改任何檔案),"
    echo "內容要包含具體的檔案異動範圍、資料流、以及你認為需要特別注意的邊界情境。"
    echo
    echo "## 概念計畫"
    cat "${concept_plan_file}"
  } >"${prompt_file}"

  local resp
  resp="$(coder_call "${prompt_file}" "plan")"
  require_success "${resp}" "Coder(round 0)"
  save_session_id "${resp}" "${CODER_SESSION_FILE}"
  local plan_text
  plan_text="$(echo "${resp}" | jq -r '.result')"
  log "round-0" "Coder(plan)" "${plan_text}"

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
      echo "Coder session id: $(cat "${CODER_SESSION_FILE}")"
      return 0
    fi

    echo "=== Round ${round}: Coder 修改計畫中 ==="
    local cprompt="${RUN_DIR}/round-${round}-coder-prompt.txt"
    {
      echo "Reviewer 對你的實作計畫提出以下意見(JSON 格式)。請逐項評估是否接受、"
      echo "說明理由,並據此修改你的實作計畫。"
      echo
      echo "**重要:請重新輸出「完整」的修改後計畫,不要只回覆修改摘要或差異說明——"
      echo "下一輪 Reviewer 只會看到這次的完整輸出,沒看過你之前說過的內容。**"
      echo
      echo "${verdict_json}"
    } >"${cprompt}"

    local plan_snapshot="${RUN_DIR}/round-${round}-plan-snapshot.txt"
    echo "${plan_text}" >"${plan_snapshot}"

    local cresp
    cresp="$(coder_call "${cprompt}" "plan" "${plan_snapshot}")"
    require_success "${cresp}" "Coder(round ${round} revise)"
    save_session_id "${cresp}" "${CODER_SESSION_FILE}"
    local new_plan_text
    new_plan_text="$(echo "${cresp}" | jq -r '.result')"

    local prev_len=${#plan_text}
    local new_len=${#new_plan_text}
    # 用整數運算比較 new_len / prev_len 是否低於 PLAN_SHRINK_GUARD,避免 bash 不支援浮點數
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

### ---- 步驟 7:Diff 覆核迴圈 ----

run_diff_review_loop() {
  local base_ref="$1"

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
      echo "是否符合原計畫、有沒有邊界情境或錯誤處理被遺漏。"
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
      echo "Reviewer 對這次實作提出以下意見(JSON 格式)。請逐項評估是否接受、"
      echo "說明理由,並據此直接修改程式碼。"
      echo
      echo "${verdict_json}"
    } >"${cprompt}"

    local cresp
    cresp="$(coder_call "${cprompt}" "bypassPermissions" "${diff_file}")"
    require_success "${cresp}" "Coder(diff round ${round} fix)"
    save_session_id "${cresp}" "${CODER_SESSION_FILE}"
    log "round-${round}-diff" "Coder(fix)" "$(echo "${cresp}" | jq -r '.result')"

    round=$((round + 1))
  done

  echo "=== ⚠️ 已達 ${MAX_ROUNDS} 輪上限仍未核准,請手動檢查 ${RUN_DIR} ===" >&2
  return 1
}

### ---- 進入點 ----

case "${1:-}" in
plan)
  run_plan_review_loop "${2:?請提供概念計畫檔案路徑,例如: docs/plan-concept.md}"
  ;;
diff)
  run_diff_review_loop "${2:?請提供要比較的 base ref,例如: master 或某個 commit hash}"
  ;;
reset)
  rm -rf "${STATE_DIR}"
  echo "已清除 branch「${BRANCH}」的 Coder session 記錄。"
  ;;
*)
  echo "用法: $0 plan <concept-plan-file> | diff <base-ref> | reset" >&2
  exit 1
  ;;
esac
