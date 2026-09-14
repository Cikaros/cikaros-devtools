---
title: 安全编码补充规范（语言无关）
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-02T00:00:00+08:00
author: specflow
status: active
refs:
  - spec/security-baseline.md
---

# 安全编码补充规范（templates/coding/security.md）

> 按需加载层：语言规范（templates/coding/<lang>/spec.md）的安全补充，
> 与 `spec/security-baseline.md` 基线配合阅读。本文件聚焦「写代码时」的落地规则。

## 1. 输入与输出

- 一切外部输入（HTTP 参数 / 环境变量 / 文件内容 / LLM 生成内容）默认不可信，
  在边界处校验（schema / 白名单 / 长度上限）后再进入业务层。
- 错误消息与日志输出前过敏感信息过滤（specflow 的 privacy-guard /
  sanitize.py 规则集可作为最小防线）；禁止把异常堆栈直接返回给终端用户。
- 文件路径必须规范化后校验前缀（防路径穿越 `../`）；解压外部压缩包禁用
  自动跟随符号链接。

## 2. 密钥与凭证

- 密钥只从环境变量或受管密钥服务读取；禁止写死在代码 / 配置模板 / 测试夹具中
  （`.env.example` 只放占位符）。
- 提交前自查：`.codexignore` 黑名单（`*.pem / *.key / .env`）不是兜底——
  密钥进了 git 历史就只能轮换。
- 临时凭证用完即焚（作用域最小化）；长期凭证必须可轮转（记录签发与过期时间）。

## 3. 依赖与供应链

- 新增直接依赖需说明用途与替代方案（ADR 记录）；锁定版本 + 校验哈希。
- 禁止引入无人维护（> 2 年无 release）或已知高危 CVE 未修的依赖。
- 构建脚本与 postinstall 钩子保持可审计（零依赖优先，参照本插件 mcp-lite
  的手写 JSON-RPC 路线）。

## 4. 并发与资源

- 并发访问共享状态必须显式加锁 / 使用不可变数据；文档标注线程安全性。
- 外部调用（网络 / 子进程）必须有超时与重试上限；禁止无限等待。
- 子进程命令禁止拼接用户输入（shell=True 禁用；参数列表形式 + 白名单校验）。

## 5. 反模式（禁止）

- ❌ `eval / exec / pickle.loads / os.system` 处理任何外部输入。
- ❌ 用 `md5 / sha1` 做安全用途（密码哈希用 argon2/bcrypt；完整性用 sha256+）。
- ❌ 自造加密（一律用标准库 / vetted 库的 AEAD；随机数用 CSPRNG）。
- ❌ 日志打印请求头全集（Authorization / Cookie 高频泄漏点）。
- ❌ 临时文件用可预测文件名（竞态 + 符号链接攻击）。
