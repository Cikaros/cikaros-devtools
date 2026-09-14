# ADR 索引

本目录记录 specflow 的架构决策记录（ADR）。

## ADR 列表

| 编号 | 标题 | 状态 | 日期 | 关键决策 |
|------|------|------|------|---------|
| [ADR-001](./ADR-001-plugin-vs-project-boundary.md) | 插件 vs 项目边界分离 | active | 2026-09-01 | 插件只装全局，项目级由 init 生成 `.specflow/` 骨架 |
| [ADR-002](./ADR-002-markdown-as-config.md) | 使用 Markdown 作为配置格式 | active | 2026-09-01 | 所有配置统一 Markdown（frontmatter + checkbox + codex:json block），doc-parser 为唯一解析器 |
| [ADR-003](./ADR-003-native-hooks-json.md) | 原生 hooks.json 作为唯一事实源 | active | 2026-09-02 | 放弃伪 config.toml [hooks] 与 manifest.md，改用 Codex 原生 hooks.json 六事件；MCP 零依赖纯 JS |
| [ADR-004](./ADR-004-output-driven-closure.md) | 产出驱动闭环 | active | 2026-09-02 | 产出声明唯一来源 config.md；产出检查通过自动判定标记 resolved |
| [ADR-005](./ADR-005-official-plugin-install-flow.md) | 官方插件安装流 + macOS 兼容 | active | 2026-09-02 | 安装以 marketplace + 会话内 /plugins 为准（后由仓库 v1.3.0 marketplace-only 重构覆盖）；bash 3.2 兼容约束仍有效 |
| [ADR-006](./ADR-006-periphery-roadmap-events-adapters-testgate.md) | 外围路线：事件总线、git 门禁与真实测试执行器 | active | 2026-09-02 | 扩展触发点=事件总线（非伪 hook）；git 门禁最小阻塞原则；真实测试执行器；脱敏规则 JSON 单源 |
| [ADR-007](./ADR-007-project-dir-specflow-observability-path.md) | 项目级目录统一 .specflow/ | active | 2026-09-02 | 单目录新布局 + legacy 回退 + init 自动迁移；三处路径层同语义；拦截理由带具体目标 |
| [ADR-008](./ADR-008-gitignore-patch-and-audit-fixes.md) | gitignore 追加与审查轮修复契约 | active | 2026-09-02 | gitignore 幂等追加；RUNTIME_MARKERS 三处一致；缓存指纹契约；零 pycache；SPECFLOW_PY 统一 |
| [ADR-009](./ADR-009-diy-architecture.md) | 项目适配与用户 DIY 架构 | accepted | 2026-09-03 | 声明式自定义 + 合并引擎，6 个 DIY 维度；自定义 hook 规则用 JSON；接线状态见 DIY-ARCHITECTURE §2 |

## 状态机与规则

```
proposed → accepted → deprecated → superseded by ADR-XXX
              ↓
          (active 使用中)
```

- 编号自增（目录最大值 +1）；文件名 `ADR-<NNN>-<slug>.md`（kebab-case，≤30 字符）
- ADR 是决策快照：一经发布不改内容（除非修正笔误）；状态变更通过新增 ADR 实现
  （新 ADR 用 `supersedes` 声明，旧 ADR 用 `superseded_by` 标注保留）
- frontmatter 必含 `title` / `type: adr` / `status` / `decided_at` / `deciders` / `refs`
- 必含章节：背景 / 决策 / 候选方案 / 影响 / 回滚 / 关联
- 何时写 ADR：重大架构决策、多候选方案权衡、难以回滚的决策、团队共识变更
- 变更流程：起草（proposed）→ 评审通过（active）→ 更新本索引 → 记入
  `docs/changes/CHANGELOG.md`
