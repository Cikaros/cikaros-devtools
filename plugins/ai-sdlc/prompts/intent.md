---
description: "Stage 1 Planning — 与发起者头脑风暴并把痛点捕获为 intent.md（Anthropic playbook 风格；v0.6.0 起强制 Open questions 交互闭环；v0.12.0 输入分流：仅需求/ISSUE 进入本阶段，补充信息融入既有工件，临时任务走 quick_task）"
---

# intent — Stage 1: Planning（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 1: Planning**。本阶段的目标是把发起者用自己的话描述的痛点，捕获为一份可读、可立即被下一阶段使用的 `intent.md`（工件存于 `.sdlc/` 工作区，不进版本控制——它是任务推进的中间产物，周期结束归档即可）。

> **输入分流前置（v0.12.0）**：执行前先确认用户输入属于**需求/ISSUE**（将产出交付物）。
> 若是对既有周期的**补充信息**，直接融入对应工件对应章节（回答 Open questions、补充约束），不重开 intent；若是**临时任务**，登记 MCP `quick_task`（`{action: "add", desc}`），不写 intent.md。判定标准见 `rules/triage.md`。

## 执行步骤

1. **倾听原话**：发起者描述目前无法做什么、影响了谁、什么样的结果更好、哪些内容超出范围。不需要正式语言。
2. **追问分析师式问题**：范围 / 用户 / 限制条件 / 什么样的结果算成功。直到想法变得具体为止。
3. **Open questions 交互闭环（v0.6.0 核心，必须遵守）**：
   - 识别出真正的未知（发起者描述中不清楚的范围/用户/约束/成功标准）。
   - **在对话中把问题逐条编号提出**，明确告知发起者：「请逐一回答以下问题，全部回答后我会写入 intent.md」。
   - **提出问题后立即结束本回合，等待发起者回答**——禁止在同回合自问自答、禁止假设答案、禁止用"暂定/默认"填塞。
   - 发起者回答后：把答案融入 intent.md 对应章节（Problem / Proposed outcome / Constraints 等）；发起者明确说"跳过"或"以后再定"的问题才允许留在 Open questions。
4. **应用组织 skills**：如果你被授权加载了 skills/ 目录下的策略技能（安全、合规、品牌、UX），在编写时考虑这些约束。
5. **使用模板生成 intent.md**：读 `templates/intent.md.tpl`，填入以下结构：
   - `Author` / `Status: draft`
   - `## Problem`（用发起者原话）
   - `## Proposed outcome`
   - `## Affected users and systems`
   - `## Constraints`
   - `## Open questions`（仅保留发起者确认暂不回答的问题）
6. **写到约定位置**：默认 `.sdlc/artifacts/intent.md`（任务隔离模式：`.sdlc/tasks/<id>/intent.md`）。存量项目根目录已有 intent.md 时就地更新（legacy 落位仍可被检测）。
7. **请发起者纠正**：明确告知"我误解了什么、需要你改什么"，等用户反馈后更新文件。
8. **工件落位即完成**：无需 git 提交——工作区不受版本控制（`.gitignore` 托管块已忽略 `.sdlc/`）；任务/周期结束后由 MCP `new_cycle` 或 `task_close` 归档到 `.sdlc/archive/`（不删除）。

## 兜底：文件已写入但 Open questions 未回答时

插件 hook 会在 `intent.md` 仍含未回答 Open questions 时**阻止阶段推进**（阶段停在 planning/awaiting_answers），Stop hook 与下一回合注入会持续提醒。此时正确做法：

1. 把未回答的问题**逐条呈现给发起者并结束回合等待**（回到上面第 3 步的交互协议）。
2. 发起者回答后编辑 `intent.md`：答案融入对应章节，并在 `## Open questions` 中**移除该条**（或标记 `- [x]` 保留审计痕迹；也接受 `~~删除线~~` 或行尾 `[resolved]`）。
3. 全部解决后，PostToolUse hook 自动检测到 `intent.md` 更新并推进到 Stage 2: Design。

## 治理

- 写入后，产品负责人审查并接受（对话确认或 PR 流程），决定进入 Stage 2: Design。
- 接受的 intent.md 会触发下一阶段的需求与设计合成。
- 证据链：工作区工件 + `.sdlc/hook-audit.json` 事件流记录作者与时间戳；周期归档（`.sdlc/archive/<cycle-id>/` + `cycles.json` 索引）保留完整历史。

## 完成判定

- 工件 `intent.md` 存在且包含上述 5 个章节
- **Open questions 全部已回答（章节为空 / 全部标记 `- [x]` 等已回答标记）**
- 提交信息明确
- 满足以上条件时 PostToolUse hook 才会自动推进到 Stage 2

## 逃生通道

- 发起者明确表示跳过所有剩余问题：经用户明确同意后调 MCP `advance`（force 推进）。
- 此时建议在 `## Open questions` 条目上追加 `(deferred)` 标记，保留审计痕迹。

如果用户描述还不够具体，**不要急着写文件**——继续问问题直到想法具体。
