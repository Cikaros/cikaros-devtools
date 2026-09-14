#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${CODEX_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
GIT_DIR="$PROJECT_ROOT/.git"
[[ ! -d "$GIT_DIR" ]] && echo "⚠ 未找到 .git: $GIT_DIR" && exit 1
HOOKS_DIR="$GIT_DIR/hooks"; mkdir -p "$HOOKS_DIR"
install_hook() {
  # $SCRIPT_DIR 在 heredoc 内展开并烧录为带引号的绝对路径（空格/中文路径安全）；
  # 运行时若 sf.sh 不存在（插件已卸载/迁移），退化为放行，绝不阻塞 git 操作。
  # v0.7.0（用户反馈第 3 项）：补常见解释器安装路径到 PATH —— GUI/IDE 发起的
  # git 提交走受限 PATH（如 /usr/bin:/bin），Homebrew 的 python3/node 不在其中，
  # 旧版会在这种场景下报 "py: command not found" 并中断 pre-commit。
  cat > "$HOOKS_DIR/$1" << EOF
#!/usr/bin/env bash
# specflow git hook ($1) — 由 specflow 安装；插件卸载后自动退化为放行（不阻塞提交）
SF="$SCRIPT_DIR/sf.sh"
if [[ ! -f "\$SF" ]]; then
  echo "[specflow] 未找到 sf.sh（插件可能已卸载/迁移），跳过 $1 检查"
  exit 0
fi
# v0.7.0：受限 PATH 兑底（幂等追加，不覆盖用户已有 PATH）
for _d in /opt/homebrew/bin /usr/local/bin /usr/bin; do
  case ":\$PATH:" in *":\$_d:"*) ;; *) PATH="\$PATH:\$_d" ;; esac
done
export PATH
exec bash "\$SF" "$2" "\$@"
EOF
  chmod +x "$HOOKS_DIR/$1"
  echo "✓ $1 → sf.sh $2（含防丢失守卫 + 受限 PATH 兑底）"
}
install_hook pre-commit git-pre-commit
install_hook post-checkout git-post-checkout
install_hook post-merge git-post-merge
