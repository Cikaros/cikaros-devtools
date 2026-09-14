---
title: 外围路线：事件总线、git 门禁与真实测试执行器
type: adr
status: accepted
decided_at: 2026-09-02
deciders: [specflow]
---

# ADR-006: 外围路线——事件总线、git 门禁、真实测试执行器

## 背景

v0.5.0 收敛安装链路后，REQUIREMENTS 外围路线余下 10 项（扩展触发点、跨 CLI
适配、解析器增强、doc-version、引导式初始化、规则单源、真实测试执行器、深度
扫描、PowerShell 对齐等）。本 ADR 记录这些落地的关键决策。

## 决策

### D1 扩展触发点 = 事件总线，而非伪造 Codex hook 事件

marker_resolved / stage_enter 等扩展触发点**不是** Codex 原生事件（原生仅
6 个生命周期事件）。v0.2.x 曾设计成伪 hook——永远不会被执行。v0.6.0 落地为
**事件总线**：单一 events.jsonl（现位于 `.specflow/`，500 行滚动，超限保留
400），Python（events.py）与 JS（events.mjs）双语言写同一格式
`{ts, type, payload}`；发射方：todo-scanner / workflow-state / session hooks /
git hooks / test-run；消费方：`sf.sh events` 查看器 + 任何读该文件的工具。
理由：Codex 不支持自定义 hook 事件名——把「触发点」降级为「可观测状态迁移
记录」，诚实且满足审计需求。

### D2 git hooks 真跑（git-hooks.py），阻塞项最小化

- **阻塞**（exit 1）：暂存文件高敏隐私命中（密钥进 git 历史不可逆）；配置的
  测试命令失败（run_on_commit=true）
- **警告不阻塞**：lint 失败、created 标记未完成（`SPECFLOW_PRECOMMIT_STRICT=1`
  升级为阻塞）
- 插件自身故障一律放行——绝不因插件 bug 阻塞 git 操作
- 用 Python 而非 bash 实现门禁编排（规则单源加载/JSON 处理/超时控制超出
  bash 3.2 安全表达范围，ADR-005 D4 继续适用）

### D3 真实测试执行器替换 ADR-004 D2 占位条件

`test-executor.json`（command / timeout / stages / run_on_advance /
run_on_commit）配置后，advance 离开门禁阶段时 subprocess 真跑测试，失败/超时
则阻塞（阶段保持 in_progress）。`SPECFLOW_SKIP_TESTS=1` 跳过（排障）；
init --guided 按测试框架自动写该文件。

### D4 跨 CLI 适配器（历史决策，已移除）

当轮落地 `adapters/{cursor,claude-code,aider,continue,generic}/`。诚实边界：
非 Codex CLI 没有 hooks 事件通道，标记 3 态与事件总线在这些 CLI 上只能手动
驱动。**v1.2.3（仓库 v1.3.1）已整体移除**——marketplace-only 重构后成为死
代码，且与 Codex 专用定位冲突。

### D5 脱敏规则跨语言单源 = 运行时 JSON 加载

`rules/sensitive-rules.json`（12 条，high/low 分级，CARD 过 Luhn）是唯一规则
源——sanitize.py 与 mcp/lib/sensitive-rules.js 运行时各自加载同一文件。
不选代码生成器（生成两份代码仍会漂移，构建步骤破坏零依赖）。约束：regex 取
JS/Python 公共子集；缺失时 fail-loud（隐私规则静默为空比报错危险）。

### D6 解析器增强边界

增量缓存（todo-cache / parse-cache：mtime+size 指纹，只缓存原始扫描，状态推断
每次重算——缓存不会让 resolved 迁移丢失）；Python 文件 AST（stdlib tokenize）
级扫描；schema 校验默认 warning、`--strict-schema` 升级 error；零依赖
YAML/TOML 导出。

### D7 doc-version 双入口

`doc-version.py`（show/bump/init/check/bump-outputs）+ advance 集成：stage_exit
时对声明的 .md 产出自动 minor bump；单文件失败不阻塞（事件留痕）。

## 后果

- 正面：外围路线落地；「声明 = 事实」边界成立（无 hooks 通道的 CLI 明示限制）；
  IPV4 匹配三八位组 bug 被单源化顺带修复
- 风险：测试执行器把 advance 时延放大到测试时长（stages 白名单 + 跳过开关
  缓解）；sanitize 替换文案统一 `<SECRET:*>` 风格（行为变化）

## 关联

- 相关 ADR：ADR-004（D3 替换其 D2 占位）、ADR-005（D4 兼容性约束）、ADR-008
  （后续修复契约）
