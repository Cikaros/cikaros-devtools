# specflow MCP Servers

> 4 个零依赖 Node MCP server（mcp-lite.js 手写 JSON-RPC 底座，无需构建）。
> 插件模式下由 `.mcp.json` 自动拉起，无需手动启动。

| Server | 工具数 | 职责 |
|--------|-------|------|
| config-reader | 7 | 解析后的 `.specflow/config.md` 配置查询（包装 doc-parser.py） |
| env-scanner | 5 | 环境摘要 / 语言栈 / 工具链查询（60s 缓存） |
| hook-orchestrator | 11 | hook 排障手动触发 + 错误知识库记录闭环 |
| privacy-guard | 3 | 敏感信息检测与脱敏（规则单源 12 条） |

- 手动排障启动：`node mcp/<name>/index.js`（hook-orchestrator 的 cwd 为插件根；
  项目目录取 `SPECFLOW_PROJECT_ROOT` 环境变量或 process.cwd）
- 协议：JSON-RPC 2.0 按行分帧；单行 >1 MiB 拒绝解析并记 stderr（v1.2.4 行长护栏）
- 仓库 v1.3.0+（specflow v1.2.2+）已移除 classic 安装模式，启用一律走
  marketplace + codex 会话内 `/plugins`
- 工具清单与边界详见 `docs/components.md` §9
