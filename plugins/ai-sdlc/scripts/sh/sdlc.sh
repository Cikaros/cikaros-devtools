#!/usr/bin/env bash
# sdlc.sh — ai-sdlc CLI 入口
#
# 用法：
#   bash sdlc.sh status           # 查看当前 SDLC 状态（首次使用自动初始化）
#   bash sdlc.sh workflow         # 查看 6 阶段全景图
#   bash sdlc.sh advance <stage>  # 强制推进
#   bash sdlc.sh accept           # 记录工程师对 plan.md 的显式接受（v0.13.11；
#                                 # 与 MCP accept_plan 同语义——MCP 工具不可用
#                                 # 时的受控回退通道；plan 模式 Bash 白名单
#                                 # 对本子命令精确豁免）
#   bash sdlc.sh reset            # 重置状态
#   bash sdlc.sh refresh          # 强制重新检测
#   bash sdlc.sh quick            # 查看临时任务队列（v0.12.0 输入分流）
#   bash sdlc.sh audit [N]        # 查看审计日志
#   bash sdlc.sh events [N]       # 查看事件流
#   bash sdlc.sh doctor           # 环境自检
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(pwd)"
SDLC_DIR="${PROJECT_ROOT}/.sdlc"

log()  { printf '\033[0;34m[ai-sdlc]\033[0m %s\n' "$*"; }
err()  { printf '\033[0;31m[ai-sdlc err]\033[0m %s\n' "$*" >&2; }

# v0.10.0 首次使用自动初始化：state.json 缺失时经 bootstrap-project.mjs 引导
# （与 SessionStart hook 同一实现：全 schema state + gitignore/codexignore 托管块）
ensure_state() {
  if [ ! -f "${SDLC_DIR}/state.json" ]; then
    log "首次使用：自动初始化（.sdlc/state.json + gitignore 托管块）"
    node "${PLUGIN_ROOT}/hooks/scripts/bootstrap-project.mjs" "${PROJECT_ROOT}" >/dev/null \
      || { err "自动初始化失败（需要 Node ≥ 18）"; exit 1; }
  fi
}

# ─────────────────────────────────────────────
# 命令实现
# ─────────────────────────────────────────────

cmd_status() {
  ensure_state
  log "当前 SDLC 状态："
  cat "${SDLC_DIR}/state.json" | python3 -m json.tool 2>/dev/null || cat "${SDLC_DIR}/state.json"
}

# v0.12.0 输入分流：临时任务队列（只读展示——增删改经 MCP quick_task 工具，会话内自然语言即可）
cmd_quick() {
  log "临时任务队列（${SDLC_DIR}/quick-tasks.json）："
  if [ ! -f "${SDLC_DIR}/quick-tasks.json" ]; then
    echo "  队列为空。登记：会话内说「记个临时任务：<描述>」（周期进行中排队，周期走完后处理）"
    return 0
  fi
  cat "${SDLC_DIR}/quick-tasks.json" | python3 -m json.tool 2>/dev/null || cat "${SDLC_DIR}/quick-tasks.json"
  echo ""
  echo "  状态语义：queued=排队中（周期走完后处理）/ in_progress=处理中 / done|dropped=终态"
  echo "  受控修改：会话内自然语言 → MCP quick_task 工具（本 CLI 只读）"
}

cmd_workflow() {
  ensure_state
  log "6 阶段全景图（基于 .sdlc/state.json 与工件存在性）："
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${PROJECT_ROOT}" <<'PY'
import json, os, sys
root = sys.argv[1]
state_path = os.path.join(root, '.sdlc', 'state.json')
state = json.load(open(state_path)) if os.path.exists(state_path) else {}

artifacts = {
    'intent.md': ['intent.md', 'docs/intent.md', 'intent/current.md'],
    'spec.md':   ['spec.md', 'docs/spec.md'],
    'plan.md':   ['plan.md', 'docs/plan.md'],
    'REVIEW.md': ['REVIEW.md'],
    'AGENTS.md': ['AGENTS.md', 'CLAUDE.md'],
}
def find(name):
    for rel in artifacts.get(name, [name]):
        if os.path.exists(os.path.join(root, rel)):
            return rel
    return None

stages = [
    ('planning',   'Stage 1 — Planning',           'intent.md'),
    ('design',     'Stage 2 — Design',             'spec.md'),
    ('build_plan', 'Stage 3a — Build / Plan',      'plan.md'),
    ('build_impl', 'Stage 3b — Build / Impl',      'diff+tests'),
    ('test',       'Stage 4 — Test',               'test-pass'),
    ('deploy',     'Stage 5 — Deploy',             'pr-merged'),
    ('maintain',   'Stage 6 — Maintain',           'intent.md (loop)'),
]

current = state.get('current_stage', 'planning')
for sid, name, art in stages:
    status = 'pending'
    if sid == current:
        status = 'current'
    elif state.get(f'{sid}_completed_at'):
        status = 'done'
    mark = {'done': '✅', 'current': '🔵', 'pending': '⬜'}[status]
    extra = ''
    if art in ('intent.md', 'spec.md', 'plan.md', 'REVIEW.md', 'AGENTS.md'):
        f = find(art)
        extra = f' — {f}' if f else ' — 未创建'
    print(f'  {mark} {name:30s} artifact: {art}{extra}')

print()
print(f'  闭环次数: {state.get("cycle_count", 0)}')
print(f'  上一阶段: {state.get("previous_stage") or "无"}')
print(f'  最后部署: {state.get("last_deployed_at") or "未部署"}')
gates = ['plan_accepted', 'test_pass', 'release_approval', 'in_fix_mode']
print(f'  门禁状态: {", ".join(f"{g}={state.get(g, False)}" for g in gates)}')
PY
  else
    cat "${SDLC_DIR}/state.json"
  fi
}

cmd_advance() {
  local from="${1:-}"
  if [ -z "${from}" ]; then
    err "用法: sdlc.sh advance <from-stage>"
    err "  stage: planning|design|build_plan|build_impl|test|deploy|maintain"
    exit 1
  fi
  ensure_state
  log "强制推进：${from} → next（跳过产出检查；需要门禁校验请用 MCP advance）"
  # v0.5.1 修复：去除对 ~/.codex/plugins 的无效路径依赖检查（marketplace 安装路径
  # 不在那里，检查误报直接令命令失败）；门禁语义对齐 advanceStage（清 override、
  # 重置下一阶段门禁、maintain 闭环计数）；错误信息不再被 stderr 重定向吞没。
  node - "${SDLC_DIR}/state.json" "${from}" <<'EOF'
const fs = require('fs');
const [statePath, from] = process.argv.slice(2);
const NEXT = { planning:'design', design:'build_plan', build_plan:'build_impl', build_impl:'test', test:'deploy', deploy:'maintain', maintain:'planning' };
const next = NEXT[from];
if (!next) { console.error(`未知阶段: ${from}`); process.exit(1); }
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
state.previous_stage = from;
state.current_stage = next;
state[`${from}_completed_at`] = new Date().toISOString();
if (next === 'build_plan') state.plan_accepted = false;
if (next === 'test') state.test_pass = false;
if (next === 'deploy') state.release_approval = false;   // v0.10.0：与 hooks/MCP 推进语义对齐（deploy_approved 死字段退役）
if (state.stage_override) state.stage_override = null;
if (from === 'maintain' && next === 'planning') state.cycle_count = (state.cycle_count || 0) + 1;
state.updated_at = new Date().toISOString();
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(`已推进: ${from} → ${next}`);
EOF
}

cmd_accept() {
  # v0.13.11 受控接受入口：与 MCP 工具 accept_plan 同语义（plan_accepted=true +
  # build_plan→build_impl 锁内幂等推进 + 事件/审计留痕）。实现位于
  # hooks/scripts/accept-plan.mjs（与 hooks/MCP 共用同一把跨进程锁）。
  # PreToolUse 规则 1b 对本子命令精确豁免（仅 accept——advance/reset 会跳过
  # 门禁，不接受经 Bash 通道代劳，仍拦）。
  node "${PLUGIN_ROOT}/hooks/scripts/accept-plan.mjs" "${PROJECT_ROOT}"
}

cmd_reset() {
  log "重置 .sdlc/state.json 到初始状态（保留 artifact_history 与 cycle_count，对齐 MCP reset 默认语义）"
  if [ ! -f "${SDLC_DIR}/state.json" ]; then
    err "state.json 不存在，无需重置"
    exit 1
  fi
  cp "${SDLC_DIR}/state.json" "${SDLC_DIR}/state.json.bak.$(date +%s)" 2>/dev/null || true
  # v0.5.1 修复：此前 cat 一个固定 JSON（artifact_history: []）——声称保留实际清空。
  node - "${SDLC_DIR}/state.json" <<'EOF'
const fs = require('fs');
const p = process.argv[2];
let old = {};
try { old = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
const fresh = {
  version: 1,
  current_stage: 'planning',
  previous_stage: null,
  created_at: old.created_at || new Date().toISOString(),
  updated_at: new Date().toISOString(),
  sdlc_engaged: false,
  sdlc_engaged_at: null,
  plan_accepted: false,
  test_pass: false,
  release_approval: false,
  in_fix_mode: false,
  change_ticket: null,
  last_deployed_at: null,
  stage_override: null,
  artifact_history: old.artifact_history || [],
  fix_loop_resolutions: old.fix_loop_resolutions || [],
  cycle_count: old.cycle_count || 0,
  cycle_id: null,
};
fs.writeFileSync(p, JSON.stringify(fresh, null, 2));
EOF
  log "✅ 已重置（备份见 state.json.bak.*）"
}

cmd_audit() {
  local n="${1:-20}"
  if [ ! -f "${SDLC_DIR}/hook-audit.json" ]; then
    log "无审计日志"
    return
  fi
  log "最近 ${n} 条审计日志："
  # v0.9.0 安全加固：路径与条数经 argv 传入（此前内插进 python 源码，
  # 含引号的项目路径 / 非数字的 n 参数会破坏甚至注入内嵌代码）
  python3 -c '
import json, sys
try:
    n = int(sys.argv[2])
except ValueError:
    n = 20
arr = json.load(open(sys.argv[1], encoding="utf-8"))
for e in arr[-n:]:
    ts = str(e.get("ts", "?"))[:19]
    hook = str(e.get("hook", "?"))
    result = str(e.get("result", "?"))
    print("  " + ts + " " + hook.ljust(25) + " " + result)
' "${SDLC_DIR}/hook-audit.json" "${n}" 2>/dev/null || tail -n "${n}" "${SDLC_DIR}/hook-audit.json"
}

cmd_events() {
  local n="${1:-20}"
  if [ ! -f "${SDLC_DIR}/events.jsonl" ]; then
    log "无事件流"
    return
  fi
  log "最近 ${n} 条事件："
  tail -n "${n}" "${SDLC_DIR}/events.jsonl" | python3 -c "
import json, sys
for line in sys.stdin:
    try:
        e = json.loads(line)
        ts = e.get('ts', '?')[:19]
        t = e.get('type', '?')
        detail = e.get('detail', '')[:80]
        print(f'  {ts} {t:25s} {detail}')
    except: pass
" 2>/dev/null || tail -n "${n}" "${SDLC_DIR}/events.jsonl"
}

cmd_doctor() {
  log "环境自检："
  echo ""
  echo "  Node:        $(node -v 2>/dev/null || echo '未找到')"
  echo "  Python3:     $(python3 --version 2>/dev/null || echo '未找到（可选）')"
  echo "  Codex CLI:   $(codex --version 2>/dev/null || echo '未找到')"
  echo ""
  echo "  项目目录:    ${PROJECT_ROOT}"
  echo "  .sdlc/:      $([ -d "${SDLC_DIR}" ] && echo '存在' || echo '未初始化（首次会话/命令时自动初始化）')"
  echo "  state.json:  $([ -f "${SDLC_DIR}/state.json" ] && echo '存在' || echo '未创建（首次使用自动创建）')"
  echo "  bands.yaml:  $([ -f "${SDLC_DIR}/bands.yaml" ] && echo '存在' || echo '未创建（init-project.sh 或手动复制模板）')"
  echo ""
  echo "  工件检测："
  for f in intent.md spec.md plan.md REVIEW.md AGENTS.md CLAUDE.md; do
    if [ -f "${PROJECT_ROOT}/${f}" ]; then
      echo "    ✅ ${f}"
    else
      echo "    ⬜ ${f}"
    fi
  done
}

# ─────────────────────────────────────────────
# 路由
# ─────────────────────────────────────────────

case "${1:-help}" in
  status)   cmd_status ;;
  workflow) cmd_workflow ;;
  advance)  shift; cmd_advance "$@" ;;
  accept)   cmd_accept ;;
  reset)    cmd_reset ;;
  refresh)  log "强制重新检测——启动 codex 会话时 SessionStart hook 会自动检测" ;;
  quick)    cmd_quick ;;
  audit)    shift; cmd_audit "$@" ;;
  events)   shift; cmd_events "$@" ;;
  doctor)   cmd_doctor ;;
  help|--help|-h)
    cat <<EOF
ai-sdlc CLI — SDLC 工作流控制

用法：
  bash sdlc.sh status           查看当前 SDLC 状态（首次使用自动初始化）
  bash sdlc.sh workflow         查看 6 阶段全景图
  bash sdlc.sh advance <stage>  强制推进（stage: planning|design|build_plan|build_impl|test|deploy|maintain）
  bash sdlc.sh accept           记录工程师对 plan.md 的显式接受（与 MCP accept_plan 同语义；MCP 不可用时的受控回退）
  bash sdlc.sh reset            重置状态到 planning（保留 artifact_history 与周期计数，备份原文件）
  bash sdlc.sh refresh          强制重新检测（提示）
  bash sdlc.sh quick            查看临时任务队列（v0.12.0 输入分流；增删改经 MCP quick_task）
  bash sdlc.sh audit [N]        查看最近 N 条审计日志（默认 20）
  bash sdlc.sh events [N]       查看最近 N 条事件流（默认 20）
  bash sdlc.sh doctor           环境自检
  bash sdlc.sh help             显示本帮助

更可靠的控制方式：通过 MCP 工具 mcp__sdlc-orchestrator__*
EOF
    ;;
  *) err "未知命令: ${1}（用 help 查看可用命令）"; exit 1 ;;
esac
