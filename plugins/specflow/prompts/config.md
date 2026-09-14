---
description: 查询/修改项目勾选式配置（config.md 为唯一事实源）
argument-hint: [get <key> | list [stage] | sources | set 提示]
---
# /config — 配置管理

## 输入

用户参数：$ARGUMENTS

- 子命令：`get <key>` / `list [stage]` / `sources` / `set <key>=<value>`
- 若参数为空：显示全量配置（等价 `get_config`）

## 流程

1. **读取**（MCP 工具，走 config-reader）：
   - `mcp__config-reader__get_config_key` —— 支持 dotted key
     （如 `coding.strict_types`，v0.3.2 起真实可用）
   - `mcp__config-reader__list_keys` —— dotted key 列举，
     可按 stage 前缀过滤（`list coding`）
   - `mcp__config-reader__get_config_flat` —— 扁平视图
   - `mcp__config-reader__get_config_sources` —— 加载的章节/跳过的章节
2. **修改**：配置的唯一事实源是 `.specflow/config.md` 的勾选框——
   `set` 请求返回指引后，**引导用户手动编辑**（或经用户明确授权后代改
   Markdown 勾选框，改完重新 parse）
3. **验证**：改后运行 `sf.sh parse .specflow/config.md --key=<key>`
   确认新值生效；产出声明（`<stage>.outputs` codex:json 块）变更会影响
   workflow advance 的阻塞行为，改动要提醒用户
4. **变量**：`{{env.*}}` 覆盖顺序 os.environ < env-scan < 全局 vars.yaml <
   项目 vars.yaml（v0.3.2 修复）；调试变量用
   `sf.sh parse <file> --vars-file=...` 查看 resolved 列表

## 标记绑定

- 配置变更影响流程行为（如把建议产出改必需）：创建
  `//TODO#NNN verify: <变更影响点> [priority:medium]`
- 其余场景通常不产生标记

## 产出物

- `.specflow/config.md`（唯一的持久化变更点）
- `.specflow/parsed-config.json`（下次 session-start 自动刷新）

## 反模式（禁止）

- ❌ 直接改 `.specflow/parsed-config.json` 等派生缓存（会被下次解析覆盖）
- ❌ 绕过 config.md 用口头约定记配置
- ❌ 把密钥类值写进 config.md（走环境变量 / vars.yaml）
- ❌ set 之后不验证解析结果
