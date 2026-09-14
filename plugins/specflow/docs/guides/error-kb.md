# 错误知识库（error-kb）

> v1.2.4 · 完整的错误知识库系统：双源匹配 + 自动捕获 + MCP 工具记录 + 模糊匹配。

## 设计原则

**只记录模型默认不知道的内容**：项目特定的踩坑、特殊工具链配置、非显而易见的
错误模式、版本兼容性问题、环境特定的诡异 bug。不记录模型已知的通用知识
（如「Java NullPointerException 是什么」）、通用编程概念（SOLID/DRY/KISS）、
语言基础语法。知识库的价值在于**补充模型不知道的部分**——如果你的记录可以在
任何编程教程里找到，它不应该在这里。

## 双源匹配

PostToolUse hook 检测工具输出错误时，从两个源头匹配修复方案：

### 源 1：toolchains.json 内嵌 commonErrors

`templates/coding/toolchains.json` 每个工具链的 `commonErrors` 数组——预置的、
跨项目通用的工具链错误（如 `EADDRINUSE` / `cannot borrow .* as mutable` /
`ModuleNotFoundError`）。共 28 条预置规则覆盖 10 个工具链，按已检测到的工具链过滤。

### 源 2：项目本地知识库（.specflow/error-kb/）

项目特定的错误记录，按语言分目录，支持递归子目录（最大 3 级）：

```
<project>/.specflow/error-kb/
├── typescript/           # 语言特定目录（指定 lang 时优先匹配）
│   └── 2026-09-03-EADDRINUSE.md
├── rust/
│   └── 2026-09-03-cannot_borrow.md
└── 2026-09-03-port-conflict.md  # 顶层 .md 视为跨语言通用记录
```

## 文件格式（Markdown + frontmatter）

```markdown
---
pattern: "EADDRINUSE"
cause: "端口被占用"
fix: "lsof -i :PORT 找进程；kill PID 或换端口"
lang: typescript
recorded_at: 2026-09-03T10:30:00+08:00
source: user_recorded
---

# 错误记录：EADDRINUSE

## 诊断步骤
1. `lsof -i :3000` 找占用进程
2. `kill -9 <PID>` 终止
3. 或修改应用配置换端口
```

### frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `pattern` | ✅ | 错误特征字符串（hook 用 `text.includes(pattern)` 匹配） |
| `cause` | ✅ | 错误原因（一句话） |
| `fix` | ✅ | 修复方案 |
| `lang` | 推荐 | 语言名（用于按语言分目录；不填则放顶层视为通用） |
| `matchStrategy` | 可选 | `exact`（默认）/ `regex` / `fuzzy`，见下 |
| `fuzzyThreshold` | 可选 | fuzzy 匹配阈值（默认 3） |
| `recorded_at` | 自动 | ISO 时间戳 |
| `source` | 推荐 | `user_recorded` / `auto_captured` / `imported` |

frontmatter 值可加双引号、单引号或不加引号；加双引号时内部双引号需转义为
`\"`；支持 LF 与 CRLF 行尾（Windows 用户编辑无障碍）。

## 匹配策略（每份文件 frontmatter 声明）

| 策略 | 行为 |
|------|------|
| `exact`（默认） | 精确子串匹配 |
| `regex` | 正则匹配（编译失败降级 exact；文本截 8000 字符防 ReDoS） |
| `fuzzy` | Levenshtein 滑动窗口模糊匹配（阈值默认 3） |

## 记录方式

### 自动捕获（v0.9.2+）

PostToolUse 检测工具输出错误关键词（错误码优先，次选 error:/fatal:/exception 等
关键词）→ 未匹配知识库 → 记录到 `.specflow/error-kb-pending/` → Stop hook 提示
agent 询问用户 → 用户确认后由 MCP 工具记录：

- `mcp__hook-orchestrator__list_pending_errors` — 列出 pending 错误
- `mcp__hook-orchestrator__record_error` — 记录错误到知识库（带 `pending_file`
  时确认该 pending 错误并清空；否则直接记录新错误）
- `mcp__hook-orchestrator__dismiss_error` — 清除 pending 错误（用户拒绝时）
- `mcp__hook-orchestrator__list_error_kb` — 列出已记录的错误（可按 lang 过滤）

### 手动记录

用户主动创建 `.md` 文件放到 `.specflow/error-kb/<lang>/` 下，文件名建议
`<日期>-<pattern摘要>.md`。`sf.sh init` 自动创建目录骨架，无需手动建目录。

## API（hook 内部调用）

`hooks/scripts/lib/common.mjs` 导出：

- `matchLocalErrorKb(projectRoot, text, lang?)` — 递归匹配本地知识库，返回
  `[{source, file, pattern, cause, fix, lang}]`
- `recordErrorToKb(projectRoot, {pattern, cause, fix, lang, source})` — 记录新
  错误（sha1 前 12 位作文件名 hash 避免冲突）
- `errorKbDir(projectRoot, lang?)` — 返回知识库目录路径

## 与智能提示的关系

- **PostToolUse**（被动检测）：扫描工具输出 → 匹配知识库（双源）→ 注入修复方案
- **UserPromptSubmit**（主动提示）：检测到语言关键词 → 提示可读取的
  features.md / anti-patterns.md 路径（不主动注入内容）
- **SessionStart**（索引层）：只注入资源索引（含 error-kb 与 toolchains.json
  条目），不注入内容
