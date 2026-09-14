---
description: 全新设计与实现（arch→coding→review 快车道）
argument-hint: <设计目标描述>
---
# /design-new — 全新设计与实现

## 输入

用户参数：$ARGUMENTS

- 设计目标描述（要建什么、边界在哪）
- 若参数为空：停止并询问（新设计必须有目标，不猜）

## 流程

1. **设计**：候选方案 ≥ 2 个 + 对比 + 推荐；产出
   `docs/design/<slug>.md`（关键决策另落 ADR）；遵循
   `rules/stage-arch-design.md`
2. **标记**：把设计拆成实现点，逐个创建
   `//TODO#NNN <实现点> [agent:default]`，依赖关系写 `[depends:]`
3. **实现**：转 `/coding`，按标记逐个实现（遵守开工门控与语言规范）
4. **评审**：转 `/review <范围>`，Blocker 登记返工标记
5. **收口**：`/workflow advance`；快车道适合中小型新设计（大需求仍走
   五主线全流程）

## 标记绑定

- 设计拆点 → 创建 TODO；实现完成 → advance 自动 resolve；
  返工 → review 创建新标记

## 产出物

- `docs/design/<slug>.md`（必需）+ `docs/decisions/ADR-*`（关键决策）
- 源码 + 测试
- `.specflow/loaded-sections.json` 中的 stage 层记录（自动）

## 反模式（禁止）

- ❌ 无设计文档直接产码（快车道≠免设计）
- ❌ 设计拆点漏依赖标注（并行实现时踩踏）
- ❌ 新设计不对照 spec/security-baseline.md 安全基线
- ❌ 引入新依赖不做理由说明（供应链红线见 security.md）
