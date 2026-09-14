---
description: 代码评审主线命令（review 阶段）
argument-hint: <评审范围：路径/PR diff/标记ID>
---
# /review — 代码评审（主线 4/5）

## 输入

用户参数：$ARGUMENTS

- 评审范围：文件 / 目录路径、`git diff` 范围（如 `HEAD~3`）、或标记 ID
- 若参数为空：评审 `git diff`（无可评审变更时明确说明并停止，不空转）

## 流程

1. **收集变更**：git diff 或指定路径；对照 `.specflow/todo-state.json` 的
   created 标记核对「改动是否都有对应标记」
2. **规范核对**（规则来自 rules/stage-review.md + spec/coding-standards.md
   + 对应语言 spec.md）：
   - 命名 / 结构 / 错误处理是否符合基线
   - 复杂度阈值（config.md `review.complexity_threshold`，默认 15）
   - 安全基线核对（spec/security-baseline.md + templates/coding/security.md）
3. **产出报告**：分级列出 Blocker / Major / Minor / Nit，每条给出
   文件:行号与修复建议；Blocker 必须可复现描述
4. **登记返工标记**：Blocker/Major 创建返工 TODO 标记
5. **推进**：`sf.sh workflow advance --agent default`

## 标记绑定

- 创建：`//TODO#NNN fix: <评审问题摘要> [agent:default] [priority:high]`
  （Blocker=high，Major=medium，Minor/Nit=low）
- 已评审通过的实现点标记：由 advance 自动 resolve（本命令不手工改）
- 评审自身不产生 resolved

## 产出物

- `docs/changes/review-<date>-<slug>.md`（评审报告，建议级；
  Blocker ≥ 1 时升为必需并阻塞 advance——在 config.md
  `review.outputs` 中按需声明）

## 反模式（禁止）

- ❌ 「Looks good to me」式无依据通过（每条结论须指到文件:行）
- ❌ 把风格偏好当 Blocker（Nit 就是 Nit）
- ❌ 评审报告只列问题不给修复方向
- ❌ 顺手直接改被评审代码（评审与返工分离，返工走标记）
- ❌ 对含敏感信息的 diff 全文粘贴进报告（先过 sanitize）
