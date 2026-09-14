# RELEASE-CHECKLIST — cikaros-devtools 发布前检查清单

> 发布新版本（仓库发行版 vX.Y.Z）前逐项执行。任何一项不通过即阻塞发布。
> 最近一次执行：v1.11.0（2026-09-09）。

## 1. 测试全绿（在交付目录上执行，防假绿）

> 测试脚本位于**交付环境**（`download/cikaros-devtools/scripts/`），不在本仓库
> 工作区内——检查的是交付物而非工作目录代码。

```bash
node scripts/test-write-policy.mjs     # 写入保护策略矩阵（48 用例）
node scripts/test-sdlc-flow.mjs        # 六阶段流程回归（14 用例）
node scripts/test-lifecycle.mjs        # 工件生命周期/隔离（52 用例）
node scripts/test-bugfix-v151.mjs      # v1.5.1 修复专项（21 用例）
node scripts/test-intent-qa.mjs        # Intent 提问门禁（v1.6.0 专项，40 用例）
node scripts/test-mcp-isolation.mjs    # MCP 会话隔离（v1.6.0 专项）
node scripts/test-testgate-fixloop.mjs # 测试门禁+修复循环（v1.7.0 专项，66 用例）
node scripts/test-skills.mjs           # 技能资产 + Playwright 命令识别（v1.8.0 专项）
node scripts/test-sdlc-v010.mjs        # v1.10.0 工件工作区化+自动初始化+一致性（39 用例）
node scripts/test-sdlc-v011.mjs        # v1.11.0 回合结束通知（55 用例：配置/构建/分发/防噪/集成）
```

- [ ] 全部测试通过（0 fail）
- [ ] 测试确实运行在交付目录（脚本内 PLUGIN/MCP 常量指向 `download/`）
  ——历史上出现过「测试指向旧代码」的假绿事故

## 2. 版本一致性扫描

- [ ] `README.md` 版本矩阵三行（仓库/插件）一致
- [ ] 安装器×4（`scripts/sh/install.sh`、`uninstall.sh`、`scripts/ps/install.ps1`、
      `uninstall.ps1`）头部注释与日志行版本一致
- [ ] `plugins/ai-sdlc/.codex-plugin/plugin.json` 的 `version` 一致
- [ ] `plugins/ai-sdlc/AGENTS.md` 头部 `> 版本：vX.Y.Z` 一致
- [ ] `plugins/ai-sdlc/mcp/sdlc-orchestrator/index.js` 的 `runMcpServer({ version })` 一致
- [ ] specflow 版本仅在 specflow 变更时提升（当前 v1.2.4，以
      `plugins/specflow/.codex-plugin/plugin.json` 为准）
- [ ] 交付 zip 文件名 = `cikaros-devtools-v<version>.zip`
- [ ] v1.10.0 起：交付 zip 内含 `plugins/ai-sdlc/hooks/scripts/bootstrap-project.mjs`
      （自动初始化 CLI 入口）
- [ ] v1.11.0 起：交付 zip 内含 `plugins/ai-sdlc/hooks/scripts/lib/notify.mjs`
      与 `notify.ps1`（回合结束通知；.ps1 无 pwsh 环境时见 §3 静态审查豁免）

## 3. 静态校验

```bash
find . -name "*.mjs" -o -name "*.js" | xargs -I{} node --check {}
find . -name "*.json" -not -path "*/node_modules/*" | xargs -I{} python3 -c "import json;json.load(open('{}'))"
find scripts -name "*.sh" | xargs -I{} bash -n {}
find . -name "*.py" | xargs -I{} python3 -m py_compile {}
```

- [ ] JS/MJS 语法 0 失败；JSON 全部可解析；SH 脚本 `bash -n` 0 失败
- [ ] PowerShell 脚本：环境无 pwsh 时仅静态审查（未改逻辑可放过；改了逻辑必须在
      Windows/pwsh 环境冒烟后才能发布）

## 4. 打包卫生

- [ ] 无 `__pycache__/` / `*.pyc` / `*.tmp` / `.sdlc/` 运行时残留
- [ ] 无 Claude/Anthropic 代码残留（`grep -ri claude` 仅允许：ADR 历史文档、
      CLAUDE.md 回退检测注释、出处声明）
- [ ] zip 排除规则生效；解压抽查（文件数合理、含 `.agents/` 隐藏目录）
- [ ] 工作目录与交付目录 diff 为空（rsync 同步后）

## 5. 安装器冒烟

- [ ] `bash scripts/sh/install.sh --help`（或 dry-run 通道）正常退出
- [ ] MCP server 可独立启动：`node plugins/ai-sdlc/mcp/sdlc-orchestrator/index.js`
      按行发送 `initialize` JSON-RPC 得到正常响应
- [ ] （有条件时）真实 Codex 会话里 `/plugins` 启用 + 走一轮 intent 提问闭环

## 6. 文档同步

- [ ] 根 `CHANGELOG.md`：新版本条目（Added/Fixed/Changed/Compatibility）
- [ ] 插件子 CHANGELOG（变更的插件）同步条目
- [ ] `README.md` 版本矩阵 + 结构说明
- [ ] 行为级变更已写入权威标准文档
      （`plugins/ai-sdlc/docs/lifecycle.md` / `plugins/ai-sdlc/docs/write-policy.md`）
      对应章节
- [ ] 版本号提升原因与 CHANGELOG 主题一致（语义化：功能新增 minor）

## 7. 发布动作

- [ ] 工作目录 rsync → `download/cikaros-devtools/`
- [ ] 打包 `cikaros-devtools-v<version>.zip` 到 `download/`
- [ ] 清理 `download/` 内旧版本 zip（只保留最新 + 可选上一版）
- [ ] （对外分发时）git tag `v<version>` + GitHub Release 附 zip
