---
description: 新功能开发（走全流程 req→arch→coding→review→testing）
argument-hint: <功能描述>
---
# /new-feature — 新功能开发

## 输入

用户参数：$ARGUMENTS

- 功能描述（一句话到一段话均可）
- 若参数为空：停止并询问（新功能必须有明确目标，不猜测）

## 流程

1. **需求**：转 `/req-analysis $ARGUMENTS`——先出验收标准与标记
2. **设计**：转 `/arch-design`——新模块/接口走 ADR；小改动可降级为
   「在 REQUIREMENTS 内补一节」并在 history 注明跳过 ADR 的理由
3. **实现**：转 `/coding`——按标记逐个实现，遵守 depends 门控
4. **评审**：转 `/review <范围>`——Blocker 登记返工标记再回 coding
5. **测试**：转 `/testing <范围>`——覆盖率门槛见 config.md
6. **收口**：`/workflow advance` 逐阶段推进；全阶段完成后
   更新 `context/current-sprint.md` 与 CHANGELOG

## 标记绑定

- 入口即创建：`//TODO#NNN <功能点> [agent:default] [priority:...]`
  （由 req-analysis 步骤创建，本命令不跳步直接建标记）
- 各阶段 resolve 均由 advance 自动判定

## 产出物

- 全套：REQUIREMENTS 条目 / ADR（如需）/ 源码 / 测试 / 评审报告 /
  测试报告 / CHANGELOG 条目

## 反模式（禁止）

- ❌ 跳过需求直接写代码（五个主线命令的存在就是为了这条）
- ❌ 大功能一把梭（> 3 个故事卡建议拆分，逐卡走流程）
- ❌ 功能做完不更新 current-sprint.md（上下文断了，下个会话抓瞎）
- ❌ 未过 review 的变更直接进 testing
- ❌ 功能与描述不符时静默收缩范围（变更要回写需求文档）
