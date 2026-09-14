---
name: sdlc-build
description: >-
  SDLC Stage 3 Build（计划与实施）技能，覆盖 3a Plan Mode 与 3b Implementation 两个子阶段。
  何时使用：spec.md 已被接受之后——3a 生成 plan.md（工程师显式接受前禁止改代码）；
  3b 按 plan 实施（偏离计划时同提交更新 plan.md，为前端改动引入 frontend-e2e 技能写 E2E 用例）。
  核心边界：代码不可变与文档可写的分级守护、Bash 只读白名单、修复期禁改测试。
  补充信息类输入更新 plan/spec 对应章节；临时任务登记 quick_task 排队，
  严禁混入本周期代码改动或 diff。
---

# sdlc-build — Stage 3: Build 技能（3a Plan / 3b Implementation）

> 权威规则：`rules/stage-build.md` 与 `docs/write-policy.md`（本技能是其可执行摘要）；
> 输入分流标准：`rules/triage.md`；操作手册：`prompts/plan.md`、`prompts/build.md`（自然语言进入）；接受计划：MCP `accept_plan`。

## 何时触发

- **3a Plan Mode**：`spec.md` 已接受、`plan.md` 不存在或未显式接受
- **3b Implementation**：`plan.md` 存在且 `state.plan_accepted = true`

## 输入分流边界（v0.12.0）

- **补充信息**（需求澄清）：影响设计→回 spec 层面；仅影响实施顺序→更新 plan.md
- **临时任务**：登记 MCP `quick_task({action:"add"})` 排队（周期走完后处理）——**严禁**把临时任务的改动混入本周期 diff（审计链污染）

## 3a — 生成 plan.md

产出（用 `templates/plan.md.tpl`）：Files that change（逐文件）/ Order of work /
Risks / Proof（验收证明方式——测试怎么跑、看什么输出）。工程师迭代后显式接受
（对话确认或 MCP `accept_plan`）→ 自动进入 3b。

**门禁（PreToolUse hook 强制）**：本阶段**禁止修改任何业务代码**（源码/构建/配置/
脚本/SQL，apply_patch 同样拦截）；**文档类全程放行**（plan.md/README/CHANGELOG/
docs/**/ADR）；Bash 仅放行只读命令（git status/log/diff、ls/cat/rg、--help 等，
逐段校验，链式非只读段与输出重定向均拦）。设计评审发生在任何代码生成之前——
此时改方向只是编辑文档的问题。

## 3b — 实施

1. 严格按 plan.md 的 Files that change 与 Order of work 实施
2. **偏离计划时同一提交更新 plan.md**（plan 与实现永不脱节，审计链不断）
3. **前端改动**（页面/组件/路由/样式/交互）：按 `skills/frontend-e2e/SKILL.md`
   写 E2E 用例（含 UI mock 对应的视觉闭环用例）——Stage 4 测试门禁的证据来源
4. 实施完成后进入 Stage 4（测试未通过前不得 push/PR，见 v0.7.0 门禁）

## 不做什么

- ❌ 3a 期间改任何代码类文件（hook 硬拦；需要改设计 = 回 spec 层面）
- ❌ 3b 偏离 plan 却不更新 plan.md
- ❌ `in_fix_mode` 期间修改测试文件（hook 硬拦——修代码不修测试）
- ❌ 实施完不跑测试就报告完成（Stop hook 会拦）

## 反模式

- plan.md 写成「把功能做好」式的空话——没有逐文件清单与顺序，3b 必然漂移
- 借道文档编辑变相改代码（如把逻辑写进可执行脚本/配置）——门禁按目标文件类型判
- 3b 里顺手改 spec.md（需求漂移 → warn 提醒走变更流程）
