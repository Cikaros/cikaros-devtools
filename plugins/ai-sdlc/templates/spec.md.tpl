# Spec: <feature-name>

Source intent: intent.md@<cycle-id>（cycle-id 见 .sdlc/state.json）
Generated at: <date>
Active skills: <list of skill names + versions>

## Requirements

### Functional
<!-- 编号列表，每条可追溯到 intent.md 的章节 -->
1. <
2. <

### Non-functional
<!-- 每条引用约束它的 skill -->
- Performance: <constraint> (skill: <name>)
- Security: <constraint> (skill: <name>)
- Compliance: <constraint> (skill: <name>)
- UX: <constraint> (skill: <name>)

## Design

### Architecture
<!-- 架构图描述 + 关键组件。可用 mermaid 或文字。 -->
<

### Data model
<!-- schema 变更、迁移需求。 -->
<

### API
<!-- 端点、请求/响应形状。可用 OpenAPI 片段。 -->
<

### UX
<!-- 用户流程、屏幕草图（文字描述）。 -->
<

## Concerns
<!-- 无法满足矛盾政策的地方。明确标记并路由到策略负责人。 -->
- [security] <concern> → route to <policy owner>
- [compliance] <concern> → route to <policy owner>

## Open questions
<!-- 继承自 intent.md 或新出现的。 -->
- <
- <

<!--
生成后：
1. 产品负责人审查规范是否解决了 intent.md 的问题
2. 先解决标记的关切点（与策略所有者）
3. 提交 spec.md + intent.md
4. 产品负责人决定进入 Stage 3: Build（咨询技术负责人若高风险）
-->
