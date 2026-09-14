---
description: 需求分析主线命令（req-analysis 阶段）
argument-hint: <需求描述或需求文档路径>
---
# /req-analysis — 需求分析（主线 1/5）

## 输入

用户参数：$ARGUMENTS

- 需求描述文本，或指向已有 PRD / 用户故事卡的路径（`docs/requirements/` 优先）
- 若参数为空：先读 `.specflow/loaded-sections.json` 确认 global 规范已加载，
  再读 `docs/requirements/REQUIREMENTS.md` 找「待分析」条目

## 流程

1. **澄清范围**：把 $ARGUMENTS 拆成「目标 / 用户故事 / 验收标准 / 范围外」四栏；
   有歧义先列出问题清单向用户确认，禁止自行假设关键业务规则
2. **验收标准可测化**：每条验收标准写成一个可执行断言（Given/When/Then 或
   「输入 X → 期望输出 Y」），无法可测化的条目标注 `[需人工评审]`
3. **写需求文档**：产出/更新 `docs/requirements/REQUIREMENTS.md`（模板见
   templates-project），遵循 PARSER 规范的 frontmatter 必填字段
4. **同步标记**：为每个待实现点创建 TODO 标记（见「标记绑定」）
5. **推进检查**：完成后运行 `sf.sh workflow advance --agent default`——
   req-analysis 阶段的必需产出缺失时会被真实阻塞

## 标记绑定

- 创建：`//TODO#NNN <需求点简述> [agent:default] [priority:high|medium|low]`
  （ID 用 `.specflow/todo.version` 的 next_id，勿手工编造）
- 本命令只**创建**标记，不 resolve；resolved 由 workflow advance 在
  产出检查通过后自动登记（`.specflow/todo-resolved.json`）
- 有依赖关系的后续实现点写 `[depends:TODO#NNN]`，环会被 todo-scanner 检出

## 产出物

- `docs/requirements/REQUIREMENTS.md`（必需，required，advance 会检查）
- `.specflow/todo-state.json` 更新（标记创建后自动）
- `context/current-sprint.md` 的「本冲刺标记」表更新（建议）

## 反模式（禁止）

- ❌ 跳过澄清直接写实现方案（需求阶段写代码 = 阶段越权）
- ❌ 验收标准写成「系统应易用」这类不可测描述
- ❌ 一次需求塞 > 8 个故事卡（应建议拆分迭代）
- ❌ 手工编造标记 ID 或复用已删除的 ID
- ❌ 未经用户确认就把「范围外」条目移进范围
