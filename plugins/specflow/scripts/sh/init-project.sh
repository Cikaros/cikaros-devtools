#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CODEX_PLUGIN_ROOT="$PLUGIN_ROOT"
# v1.2.1 P2-4：与 sf.sh 同语义的 python 探测链
SF_PY=""
if [[ -n "${SPECFLOW_PY:-}" ]]; then
  SF_PY="$SPECFLOW_PY"
elif command -v python3 >/dev/null 2>&1; then
  SF_PY="python3"
elif command -v python >/dev/null 2>&1; then
  SF_PY="python"
elif command -v py >/dev/null 2>&1; then
  SF_PY="py -3"
else
  echo "[err] 未找到 python3 / python / py（初始化必需）" >&2
  exit 1
fi
$SF_PY "$PLUGIN_ROOT/scripts/lib/init-project.py" "$@"
