---
title: 使用 Markdown 作为配置格式
type: adr
status: active
decided_at: 2026-09-01
deciders: [specflow]
refs:
  - docs/decisions/ADR-009-diy-architecture.md
---

# ADR-002: 使用 Markdown 作为配置格式

## 背景

v0.1 用「checkbox + JSON block」混合表达配置：认知割裂、加载逻辑复杂（两种格式
两套解析再合并）、能力扩展两侧易遗漏、hook 配置另用 YAML（两套格式并存）、
跨 CLI 通用性差。

## 决策

**所有配置文件统一 Markdown（doc-parser 单一解析器），不再混用。**

格式规范（doc-parser.py 实现）：

- **frontmatter**：文件顶部 `---` 包围的 YAML
- **嵌套 checkbox**：`- [ ]` / `- [x]` 多选（建议 ≤4 级）
- **单选 checkbox**：`- ( )` / `- (x)` 同级仅一项
- **JSON block**：` ```codex:json ` 代码块，用于结构化配置（产出声明、转换条件、门禁）
- **变量占位符**：`{{namespace.field}}` 与 `{{var|default:"fallback"}}`
- **章节引用 / 自定义映射**：`@ref:path` / `<!-- codex:map 中文 → english.key -->`

v0.1 遗留的 `hooks/manifest.yaml` 曾改为 manifest.md（后自 v0.3.0 起整体废弃并归档，
归档件已随 v0.x 归档目录一并移除；hook 唯一事实源是 hooks.json——见 ADR-003）。

## 候选方案

| 方案 | 结论 |
|------|------|
| 纯 JSON / YAML / TOML | 拒绝（学习成本高、不能勾选表达开关、注释差） |
| checkbox + JSON block 混用（v0.1 现状） | 拒绝（背景所述问题） |
| **纯 Markdown** | **采纳**（配置即文档、跨 CLI 通用、可勾选） |

## 影响

- `scripts/lib/doc-parser.py` 为唯一解析器；`mcp/config-reader/` 包装为 MCP
  查询服务（组件参考见 `docs/components.md` §1 / §9.1）
- 用户编辑 config.md 即在改配置（零学习成本）；未勾选章节不进上下文（按需加载省
  token）；单行解析失败不阻塞（errors 留痕）
- 变量解析顺序：os.environ 基座 < 全局 `~/.specflow/vars.yaml` < 项目
  `vars.yaml`；配置不含密钥（密钥走环境变量）
- 废弃 v0.1 的 `doc-config-loader.py` 与 `doc-classifier`（合并入 doc-parser）

## 回滚

恢复 v0.1 loader 并改回混合格式；成本中等，不影响已初始化项目。

## 关联

- 相关 ADR：ADR-001（config.md 由 init 生成）、ADR-003（hook 事实源为 hooks.json
  的例外）、ADR-004（产出声明即 codex:json block）、ADR-009（DIY 阶段规则沿用
  此格式，hook 规则用 JSON 的例外）
