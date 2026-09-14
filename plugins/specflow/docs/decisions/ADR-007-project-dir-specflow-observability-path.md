---
title: 项目级目录统一 .specflow/
type: adr
status: accepted
decided_at: 2026-09-02
deciders: [specflow]
---

# ADR-007: 项目级目录统一 `.specflow/` + 拦截可观测 + git hook 环境鲁棒性

## 背景（用户实测反馈三项）

① 项目叫 specflow 但生成的项目级目录叫 `.codex-plugin/`（配置）与 `.codex/`
（运行时），品牌不一致且与全局 `~/.codex/` 混淆；② PreToolUse 拒绝理由只报
模式名（`*.log`）不报具体文件；③ macOS GUI/IDE 发起的 git 提交走受限 PATH，
Python 探测链兜底的 `py -3` 是 Windows 专属启动器 → `command not found`。

## 决策

### D1 — 项目级目录统一为 `.specflow/`（配置 + 运行时同目录）

新布局：config.md / config.default.md / vars.yaml / todo.version（配置）+
agents/ / languages/（可编辑）+ workflow-state/ / events.jsonl / todo-*.json /
hooks-state.json / loaded-sections.json / env-scan.json / hook-audit.json /
test-executor.json 等（运行时）。

**兼容策略（旧项目零动作照常工作）**——三处路径层（`scripts/lib/sfpaths.py`、
`hooks/scripts/lib/common.mjs`、`mcp/lib/sf-paths.js` 同语义）：

- `.specflow` 存在 → 新布局
- 存在旧布局痕迹（`.codex-plugin/` 目录，或 `.codex/` 内含 specflow 已知运行时
  文件——避免误吞其他工具的同名目录）→ legacy：配置读 `.codex-plugin/`，
  运行时读写 `.codex/`
- 否则默认新布局

**迁移**：重跑 `sf.sh init` 自动把旧目录内容拍平移入 `.specflow/`（非破坏：
目标存在则保留并警告；迁移后旧目录空壳删除）；`--no-migrate` 跳过、`--refresh`
不迁移；迁移后自动给旧 `.gitignore` 追加 `.specflow/`（幂等）。

**不改名的两类路径**：插件树 `.codex-plugin/plugin.json`（Codex 官方插件清单
契约）与项目 `.codexignore`（PreToolUse 黑名单，改名会让已初始化项目的防护
静默失效）。

### D2 — PreToolUse 拒绝理由带出具体目标

匹配器返回全部命中（pattern → target）；target 从命中文本按分隔符切分取路径
token；拒绝理由与 hook-audit 均列出（最多 3 条 + 计数）。

### D3 — Python 探测链加固（sf.sh / common.mjs / MCP 三处同链）

`SPECFLOW_PY → PATH 内 python3 → python → 常见 Unix 绝对路径 → py -3
（Windows）`；全部落空输出可读错误（安装指引 + SPECFLOW_PY 逃生口）而非裸
command not found；**git hook 场景一律放行**（A7 原则）。烧录的 git hook 幂等
补 PATH（`/opt/homebrew/bin:/usr/local/bin:/usr/bin`）。

### D4 — 顺带修复：sf.sh git-* 动作名不匹配

sf.sh 曾把 `git-pre-commit` 原样传给只认 `pre-commit` 的 git-hooks.py（旧版因
py 缺失从未执行到参数检查而漏测）。修复：剥前缀 + 退出码兜底（0=放行 /
1=拒绝 / ≥2=内部错误放行）。

## 后果

- 旧项目不升级也照常工作（legacy 回退）；重跑一次 init 即完成迁移
- 三处路径层语义一致性由回归用例锁定（ADR-008 D3 契约）
- 历史文档中的旧路径表述保留原文（记录当时行为），规范正文以新路径为准

## 关联

- 相关 ADR：ADR-001（边界）、ADR-003（hooks.json）、ADR-006（外围路线）、
  ADR-008（RUNTIME_MARKERS 一致性契约）
