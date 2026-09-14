---
description: "Stage 4 Test — 会话自检（make test/lint/build）+ 持续评估套件准备；前端项目配合 frontend-e2e 技能（Playwright）"
---

# test — Stage 4: Test（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 4: Test**。每个会话在人类看到之前都会检查自己的工作，控制代理的配置像它编写的代码一样进行回归测试。

## 前置条件

- 已完成 Stage 3b（实施），plan.md 的 Files that change 全部已修改
- 项目有可一条命令运行的测试套件（前端项目无 E2E 时按 `skills/frontend-e2e/SKILL.md` 先补最小冒烟套件）

## 执行步骤

1. **跑反馈循环**（在报告任务完成前必做）：
   ```
   make build      # 或 npm run build
   make test       # 或 npm test
   make lint       # 或 npm run lint
   ```
   - 三者都必须通过；任何一个失败都不能报告完成
   - **如果测试失败，修代码而不是修测试**（除非测试本身有 bug，此时退出 `in_fix_mode` 再改）
   - **测试未通过前不得 `git push` / `gh pr create`**（PreToolUse 测试门禁会硬拦）
2. **粘贴输出**：把 `make test` 等命令的原始输出贴到会话中，作为机械证据。
3. **前端项目（v0.8.0；环境协议 v0.13.12）**：改了 UI 的工作流按
   `skills/frontend-e2e/SKILL.md` 执行——环境未就绪先跑只读检测
   `node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --check`，把报告与
   三选项（A 完整安装 / B 本机 Chrome 零浏览器下载 / C 跳过）呈报用户等待
   抉择，用户选择后 `--install <full|chrome|skip> --yes` 受控执行；安装命令
   被Codex 沙盒拒网络时向用户请求授权提权（勿重试勿绕过）。标准命令
   `npx playwright test`（或 `npm run e2e`，均被测试门禁识别并计入
   `test_runs`）；报告器用默认/list/line/dot（失败编号清单是失败签名依据）。
   `playwright install` / `setup-playwright --install` 等工具命令不计为测试
   执行；被沙盒拒而失败的测试命令同样不计（环境授权问题非代码问题）。
4. **UI 视觉闭环**：如果改了 UI，截图并与 mock 比较，迭代到匹配
   （frontend-e2e 技能 §7 的 `toHaveScreenshot` 是机械化实现）。
5. **准备评估套件**（持续评估，CI 中运行）：
   - 收集 20-50 个真实任务 + 预期结果
   - 写成 `evals/<name>.json`，每个评估 = 提示 + 可接受结果定义
   - 参考模板 `templates/evals.json.tpl`
   - CI 配置参考 `templates/agent-evals.yml.tpl`（监听 AGENTS.md / .codex/** / .sdlc/** 变更触发）
6. **修复任务后添加评估**：每个生产事件都得到一个评估，由拥有该事件的团队编写，作为回归测试保留在套件中。
7. **声明完成**：报告 "All checks passed" 并粘贴输出。

## 测试失败的处理路径（v0.7.0 测试门禁与循环保护）

测试失败时插件会记录失败签名并计数（`state.fix_rounds` / `state.test_failures`），你面临两条正路：

- **就地修复（首选）**：小问题直接修代码重跑——修代码不修测试
- **intent 迭代**：失败暴露的是需求/设计缺口时，MCP `new_cycle` 归档当前周期，
  把失败测试作为 incident 写入新的 intent.md，进入下一个迭代

**循环保护（自动，无需操作）**：同一失败签名重复出现（A→A / A→B→A，含跨周期）
或连续失败轮次达上限（默认 3，`SDLC_MAX_FIX_ROUNDS` 可调）时，插件会：

1. 置位 `state.fix_loop` 并**阻断业务代码写入**（PreToolUse 硬拦）
2. 在 Stop / 每回合注入中断提醒——此时你必须**停止自动修复**，
   向用户呈报循环证据（失败历史 + 已尝试方向）并等待决策
3. 用户决策：MCP `loop_resolve({decision: "retry|new-intent|manual|escalate"})`（用户自然语言
   如「重试一轮」即触发；详见 `prompts/loop-resolve.md` 手册）

测试真实通过会自动解除中断；但**不得**为了解除而跳过/删除/弱化失败测试。

## 治理

- 强制执行：在任务报告完成前进行验证（AGENTS.md 指令）
- 强制执行：修复期间阻止代理编辑测试文件（PreToolUse hook `in_fix_mode` 规则）
- 强制执行：测试未通过禁止 `git push` / `gh pr create`（PreToolUse 测试门禁，v0.7.0）
- 强制执行：修复循环中断后阻断代码写入直到用户决策（PreToolUse fix_loop 门禁，v0.7.0）
- 证据：`make test` 的原始输出、构建日志、Codex 运行并粘贴的截图差异
- 记录位置：会话记录 + PR 的 checks runs + `state.test_failures`（失败历史）

## 完成判定

- `state.test_pass = true`（PostToolUse hook 检测到测试命令 exit 0 自动设置）
- 评估套件已就绪或已有 CI 配置
- 准备进入 Stage 5: Deploy（创建 PR）
