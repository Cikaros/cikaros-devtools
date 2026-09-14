---
description: 隐私脱敏：对文件或内容执行敏感信息检测与改写
argument-hint: <文件路径 或 --content>
---
# /sanitize — 隐私脱敏

## 输入

用户参数：$ARGUMENTS

- 目标文件路径（相对项目根）；或 `--content` 后跟待脱敏文本
- 若参数为空：扫描最近一次工具输出（`.specflow/last-redaction.json`
  有记录时）并给出复核建议

## 流程

1. **规则来源**：规则单源为 `mcp/lib/sensitive-rules.js`（12 条，与
   privacy-guard MCP 同表；Python 侧 sanitize.py 为同构镜像）——
   密钥类（PEM/OpenAI/AWS/GitHub/Slack/JWT）、证件银行卡类（Luhn 收紧）、
   低敏类（邮箱/手机/私网 IP/内网 URL）
2. **文件脱敏**：运行 `sf.sh sanitize <file>`——输出脱敏后内容与
   命中统计（`--summary` 只看统计，`--audit` 写 `.specflow/privacy-audit.json`）
3. **内容检测**：MCP 工具 `mcp__privacy-guard__scan_output`
   （只检测）/ `mcp__privacy-guard__redact_output`（返回改写）
4. **改写落盘**：确认后把脱敏版写回原文件（或新文件），原内容若含
   密钥提醒用户立即轮换
5. **黑名单**：`.codexignore` 命中的文件（`*.pem` / `.env` 等）拒绝读取，
   这是设计行为不是 bug

## 标记绑定

- 发现敏感信息泄漏点：创建 `//TODO#NNN remove: <泄漏点> [priority:high]`
- 已脱敏完成：常规 advance 闭环 resolve，不单独处理

## 产出物

- 脱敏后的文件（或 stdout 输出的改写文本）
- `.specflow/privacy-audit.json` 审计条目（`--audit` 时）

## 反模式（禁止）

- ❌ 把原文与脱敏文并排写入同一报告（等于没脱）
- ❌ 对 `.env.example` 白名单文件之外的黑名单文件做「只看不脱」的展示
- ❌ 检测到密钥后不提醒轮换（泄漏一旦发生，删除不等于止损）
- ❌ 自创脱敏格式（统一 `<SECRET:*>` / `<REDACTED:*>` 占位符）
