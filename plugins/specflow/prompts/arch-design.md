---
description: 架构设计主线命令（arch-design 阶段）
argument-hint: <需求条目或 PRD 章节>
---
# /arch-design — 架构设计（主线 2/5）

## 输入

用户参数：$ARGUMENTS

- 需求条目引用（如 `REQUIREMENTS.md §3 用户登录`）或自然语言描述
- 若参数为空：读 `docs/requirements/REQUIREMENTS.md` 未覆盖条目 +
  `.specflow/project-snapshot.json`（已有项目时）对齐现有技术栈

## 流程

1. **读前置产出**：读 REQUIREMENTS.md 对应条目与验收标准；缺需求先回到
   `/req-analysis`，禁止凭空设计
2. **方案构思**：给出 ≥ 2 个候选方案，按「复杂度 / 可测试性 / 与现有结构
   一致性」对比，给出推荐与理由
3. **写 ADR**：决策记录写入 `docs/decisions/ADR-<NN>-<slug>.md`
   （状态 proposed → accepted），约束与放弃的备选必须写明
4. **模块拆分**：输出模块清单（职责 / 对外接口 / 依赖方向），单向依赖，
   domain 层不依赖上层
5. **更新产出声明**：新增/调整实现产物路径时，同步
   `.specflow/config.md` 的 `arch-design.outputs` codex:json 块
6. **推进检查**：`sf.sh workflow advance --agent default`（architecture.md
   必需产出缺失会被阻塞）

## 标记绑定

- 为每个待实现模块创建 `//TODO#NNN 实现 <模块> <职责> [agent:default]`
- 跨模块依赖写 `[depends:...]`（如 service 层依赖 domain 层标记）
- 设计阶段不 resolve 任何标记

## 产出物

- `docs/design/architecture.md`（必需，required，advance 会检查）
- `docs/decisions/ADR-<NN>-<slug>.md`（关键决策时必需）
- `.specflow/config.md` 产出声明更新（如有变化）

## 反模式（禁止）

- ❌ 无需求输入凭空画架构图
- ❌ 单个 ADR 混合多个不相关决策
- ❌ 只给一个方案不给备选对比（甩「最佳实践」当理由）
- ❌ 模块间出现双向依赖 / 环
- ❌ 把实现细节（函数级）写进架构文档
- ❌ 修改 config.md 产出声明却不同步删除已废弃路径
