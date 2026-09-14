---
name: sdlc-test
description: >-
  SDLC Stage 4 Test（会话自检）技能。何时使用：plan.md 已接受且实施完成、需要跑反馈循环
  （build/test/lint）取得真实测试证据时；state.test_pass 尚未置位、测试门禁阻止 push/PR 时；
  测试失败需要就地修复或触发 intent 迭代时；修复循环中断（fix_loop）已置位需要向用户呈报时。
  前端项目一律配合 frontend-e2e 技能（Playwright）取得 E2E 证据。补充信息类输入更新
  plan/spec 对应章节；临时任务登记 quick_task 排队，不得借测试之机混入周期改动。
---

# sdlc-test — Stage 4: Test 技能

> 权威规则：`rules/stage-test.md`（本技能是其可执行摘要）；输入分流标准：`rules/triage.md`；
> 操作手册：`prompts/test.md`；循环决策：MCP `loop_resolve`。

## 何时触发

- `plan.md` 存在 + git 有未提交 diff + `state.test_pass = false`
- 测试门禁（v0.7.0）拦下了 `git push` / `gh pr create` / 报告完成
- 测试失败后进入修复流程，或 fix_loop 置位需要呈报

## 输入分流边界（v0.12.0）

- **补充信息**（验收口径澄清）：更新 plan.md 的 Proof 段，重跑对应测试
- **临时任务**：登记 MCP `quick_task({action:"add"})` 排队——测试证据只覆盖本周期 diff，
  排队任务的处理不在此阶段展开

## 做什么

1. **跑反馈循环**（报告完成前必做）：`make build` / `make test` / `make lint`
   （或 npm run build / test / lint 等价形式）——三者必须全过
2. **前端项目**：改过 UI 的工作流按 `skills/frontend-e2e/SKILL.md` 跑
   `npx playwright test`（或 `npm run e2e`）——命令被门禁识别并计入
   `test_runs`，失败进入签名与轮次统计
3. **粘贴原始输出**作为机械证据（含失败清单；Playwright 用默认/list/line/dot 报告器）
4. **UI 视觉闭环**：改了 UI 的，截图与 spec.md mock 对比迭代到匹配
   （frontend-e2e 技能 §7 的 `toHaveScreenshot` 是机械化实现）
5. **准备评估套件**：`templates/evals.json.tpl` + CI 触发参考
   `templates/agent-evals.yml.tpl`；每个生产事件补一个评估
6. 全绿 → PostToolUse 置 `state.test_pass = true` 并自动推进 Stage 5

## 测试失败时（v0.7.0 路径）

- **就地修复（首选）**：小问题修代码重跑——**修代码不修测试**；确证测试本身
  写错才修测试，先退出 `in_fix_mode`（MCP `set_fix_mode(false)`）
- **intent 迭代**：失败暴露需求/设计缺口 → MCP `new_cycle` 归档当前周期，
  把失败测试作为 incident 写入新 intent.md，下一个周期解决
- **循环熔断（自动）**：同签名重复（A→A / A→B→A，含跨周期）或轮次超限
  （默认 3）→ `fix_loop` 置位 → 代码写入与写类 Bash 被阻断 → **停止自动修复**，
  呈报失败历史与已尝试方向，等待用户决策后调 MCP `loop_resolve({decision:"retry|new-intent|manual|escalate"})`
- 测试真实通过 → 轮次清零、中断自动解除

## 不做什么

- ❌ 跳过或删除失败的测试（「永不跳过或删除」是 Stage 4 第一硬约束）
- ❌ 修改测试使其通过（表演，不是测试）
- ❌ 未测试就 push / 提 PR（PreToolUse 硬拦）
- ❌ 只跑单元不跑集成/E2E（如果存在）
- ❌ fix_loop 置位后继续自动改代码
- ❌ 前端项目只跑组件单测不跑用户行为层的 E2E

## 反模式

- 报告「All checks passed」却拿不出原始输出——无证据的声明等于没做
- 评估套件「以后再加」——以后永远不会来
- 每次失败机械开新周期——小问题就地修，intent 迭代留给真正的需求缺口
