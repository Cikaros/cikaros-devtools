---
title: 官方插件安装流与 macOS 兼容性
type: adr
status: accepted
decided_at: 2026-09-02
deciders: [specflow]
---

# ADR-005: 官方插件安装流 + macOS bash 3.2 / BSD awk 兼容性

## 背景

v0.4.0 在真实 macOS（bash 3.2 + BSD awk）暴露三个问题：① 版本比较 awk 语法
GNU/BSD 均不接受（测试盲区：无 codex 命令时该行从未执行）；②
`codex plugin install` 子命令**从未存在**——官方 CLI 只有
marketplace add/list/upgrade/remove，插件安装入口是会话内 `/plugins` 浏览器；
③ bash 3.2 解析「`$VAR` 后紧跟全角字符」时把全角 UTF-8 字节吞进变量名（报未
绑定变量）。

## 决策

### D1-D3：安装流程（历史决策，已被后续重构覆盖）

当轮决策：marketplace 注册幂等 + 运行时探测子命令面 + 按用户插件目录程序化
安装 + `codex plugin list` 验证 + 未确认打 `/plugins` 指引返回码 2；auto 模式
对返回码 2 补装 classic；版本比较改纯 bash `ver_to_int`。**后续演进**：
v0.7.5 移除程序化复制 hack（Codex 不认该目录的插件）；v1.2.2（仓库 v1.3.0）
安装器上移仓库根并改为 marketplace-only——现行安装流程以 CHANGELOG v1.2.2 /
根 README 为准。

### D4. shell 兼容性规范（**仍然有效的活约束**）

- 所有脚本兼容 macOS 自带 bash 3.2：禁用 bash 4+ 特性（`declare -A` /
  `mapfile` / `${var,,}` / `|&` 等）
- **变量名后紧跟非 ASCII 字符必须 `${VAR}`**（bash 3.2 多字节吞字 bug，全仓
  正则扫描清零）
- 避免 GNU-only 工具形态：`sed -i`（无后缀）、`grep -P`、`readlink -f`、
  `date -d`、`find -printf`
- awk 仅用于行过滤类简单程序，不做算术比较

### D5. 卸载器同步

无 `uninstall` 子命令时指引会话内 `/plugins` 卸载，不盲目试错（子命令探测与
安装器同源）。

## 后果

- macOS（bash 3.2）与 Linux 双平台可安装；安装不再依赖不存在的子命令
- 探测式设计：未来 codex 提供新子命令时安装器自动跟进

## 参考

- OpenAI 官方文档（插件总览 / "Package your plugin" / changelog 2026-03：
  插件系统发布、`~/.codex/plugins/cache/` 加载语义）
- 用户实测反馈（macOS / BSD awk / bash 3.2）
