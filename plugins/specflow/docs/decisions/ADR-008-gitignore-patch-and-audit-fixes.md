---
title: init 追加 .gitignore 与审查轮修复契约
type: adr
status: active
decided_at: 2026-09-02
deciders: [specflow]
refs:
  - docs/decisions/ADR-007-project-dir-specflow-observability-path.md
---

# ADR-008: init 追加 `.gitignore` 与 v0.7.1 审查轮修复契约

## 背景

用户实测 v0.7.0 后提出：`.specflow` 应在**初始化时**加入 `.gitignore`（v0.7.0
只在迁移场景补丁）；不再追加新功能，继续寻找问题与可优化项。随后一轮全链路
深度审查实锤 7 项缺陷，修复固化为以下契约。

## 决策（契约）

- **D1 `.gitignore` 追加策略**（`ensure_specflow_gitignore`）：不存在 → 不动
  （由 gitignore.tpl 生成）；已忽略（兼容三种写法，逐行精确判定）→ 不动
  （幂等）；存在未忽略 → 仅追加忽略块（`.specflow/` + `!.specflow/.gitkeep` +
  `.specflow-backup-*/`），不动用户已有行。init 主流程与迁移共用同一实现
- **D2 豁免按命中目标而非整段文本**：黑名单命中与白名单豁免均落到具体 token
  （`cat .env.example .env` 中前者被豁免、后者被拦截）；此前整段文本级豁免会让
  白名单「串门」放行被禁目标
- **D3 三处路径层清单强一致**：sfpaths.py / common.mjs / sf-paths.js 的
  RUNTIME_MARKERS（22 项）必须逐项一致并以回归用例锁定——布局判定分裂会导致
  hooks 与扫描器读写两个目录
- **D4 缓存正确性契约**（doc-parser）：变量合并的全部实际来源（显式
  --vars-file、自动加载的 vars.yaml、env-scan.json、文档实际引用的 `{{env.X}}`
  键值）必须进缓存指纹；`{{now}}`/`{{today}}` 文档不进缓存（恒为实时值契约）；
  全量 os.environ 不进指纹（噪音键击穿命中率）
- **D5 运行时零 `__pycache__`**：所有 Python 启动点注入
  `PYTHONDONTWRITEBYTECODE=1`；语法检查用 `ast.parse`（py_compile 即使 -B 也
  写盘）——插件树常位于 git 仓库内，运行副产物不得污染 git status
- **D6 `SPECFLOW_PY` 全链统一**：覆盖变量在 sf.sh / sf.ps1 / hooks findPython /
  3 个 MCP 探测链中同语义（链首生效，失效回退标准链）

## 影响

- 运行时产物不再混入用户版本库；拦截提示与审计信息可信；缓存在变量源变更时
  正确失效

## 已知权衡

`.specflow/` 整目录忽略意味着团队共享配置默认不进版本库（与模板行为一致，
用户指令明确要求）；需要共享的团队可自行改用精确忽略（只忽略 `todo-*` /
`events.jsonl` 等运行时文件），追加块带注释说明。
