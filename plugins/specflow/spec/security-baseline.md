---
title: 安全基线
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
  - docs/requirements/HOOKS.md
  - docs/component/cards/privacy-guard.md
---

# 安全基线（spec/security-baseline.md）

> **本文档定义项目安全基线，属于 `semantic: spec` 层，整个会话期间始终加载。**
>
> 本基线不可变——变更需走 ADR 流程。各语言的具体安全实践按需加载：语言无关落地规则见 `templates/coding/security.md`（v0.4.0 已落地）；语言专属安全细则（`templates/coding/<lang>/security.md`）v0.4.0 已提供 templates/coding/security.md（语言无关安全补充），当前由各语言 `spec.md` 的安全相关章节 + 本基线共同覆盖。

---

## 1. 认证（Authentication）

### 1.1 密码

- **禁止明文存储**：必须用 bcrypt / scrypt / argon2 哈希，禁止 MD5 / SHA1。
- **bcrypt cost ≥ 12**（2026 年硬件水平），argon2 内存 ≥ 64MB。
- **密码复杂度**：≥ 12 字符，含大小写 + 数字 + 特殊字符；不允许常见弱密码（用 `haveibeenpwned` API 或本地弱密码字典）。
- **密码重置**：用一次性 token（10 分钟过期），不发送原密码到邮箱。

### 1.2 多因素认证（MFA）

- 高权限账号（管理员 / 财务）必须启用 MFA。
- 支持 TOTP（Google Authenticator） / WebAuthn / 短信（仅作 fallback）。
- 备份码一次性使用，使用后立即失效。

### 1.3 会话管理

- **session token**：≥ 128 bit 随机数（用 `crypto.randomBytes`，禁止 `Math.random`）。
- **过期时间**：默认 30 分钟闲置 / 8 小时绝对，按业务调整。
- **存储**：HttpOnly + Secure + SameSite=Strict cookie，禁止 localStorage 存 token。
- **登出**：服务端 invalidate session，不仅删客户端 cookie。
- **会话固定攻击防护**：登录后重新生成 session ID。

### 1.4 JWT（若使用）

- **签名算法**：固定为 RS256 / ES256，禁止 `alg: none`，禁止对称 HS256 共享密钥。
- **过期时间短**：access token ≤ 15 分钟，refresh token ≤ 7 天。
- **不存敏感信息**：JWT payload 是 base64 不是加密，不放密码 / 手机号 / 身份证。
- **吊销机制**：维护黑名单或用短期 token + 长期 refresh 模式，避免无法吊销。

---

## 2. 输入校验（Input Validation）

### 2.1 永不信任用户输入

- **所有外部输入必须校验**：HTTP 参数 / Body / Header / Cookie / 文件上传 / 第三方回调。
- **白名单优于黑名单**：定义"允许的字符集 / 格式 / 长度范围"，黑名单易绕过。
- **校验在边界**：API 入口校验一次，业务层信任已校验数据。

### 2.2 类型与范围校验

- **类型严格**：用 zod / pydantic / go validator 等强类型校验库。
- **长度限制**：字符串长度上限（如 ≤ 1024 字符），数字范围（如 age 0-150）。
- **枚举校验**：枚举字段必须用枚举类型或白名单，禁止任意字符串。

### 2.3 文件上传

- **白名单扩展名**：仅允许业务必要的扩展名（如 `jpg` / `png` / `pdf`），不依赖 Content-Type（可伪造）。
- **文件头校验**：读文件前几个字节判断真实类型，不依赖扩展名。
- **大小限制**：单文件 ≤ 10MB（按业务调整），总上传 ≤ 50MB。
- **存储隔离**：上传文件不放可执行目录（如 `public/`），用独立 CDN / OSS。
- **文件名脱敏**：用服务端生成的随机名存储，不保留原文件名。

### 2.4 SQL 注入

- **必须参数化查询**：用 prepared statement / ORM / query builder，禁止字符串拼接。
- **白名单校验动态字段名**：表名 / 字段名不能直接拼接，必须从白名单查。
- **ORM 也要小心 raw 查询**：`Model.queryRaw(sql)` 等于拼接，必须参数化。

### 2.5 命令注入

- **禁止用 shell 拼接用户输入**：`exec(`ls ${userInput}`)` 是高危。
- **用参数数组**：`exec("ls", [dir])` 让 OS 处理参数边界。
- **白名单校验可执行路径**：不直接执行用户给的命令名。

---

## 3. 输出编码（Output Encoding）

### 3.1 按上下文编码

| 上下文 | 编码方式 | 示例 |
|--------|---------|------|
| HTML body | HTML 实体编码 | `<` → `&lt;` |
| HTML attribute | 属性编码 + 引号包裹 | `"` → `&quot;` |
| JavaScript | JS 字符串编码 | `</script>` → `<\/script>` |
| URL | URL 编码 | ` ` → `%20` |
| CSS | CSS 编码 | `<` → `\3c` |

### 3.2 模板引擎

- **默认开启自动转义**：如 Jinja2 / Handlebars / React JSX 默认转义。
- **显式标记 raw / unsafe**：如 `{% raw %}` / `v-html` / `dangerouslySetInnerHTML` 仅在已 sanitize 内容上使用。
- **不混用模板与字符串拼接**：`<div>${userInput}</div>` 必须用模板引擎转义。

### 3.3 JSON 响应

- **Content-Type: application/json**：浏览器据此禁止 MIME sniffing。
- **X-Content-Type-Options: nosniff**：补强防 sniffing。
- **不嵌入 HTML**：JSON 中不嵌入可直接执行的 HTML / JS。

### 3.4 防止 CSRF

- **SameSite cookie**：默认 `SameSite=Strict`，跨站请求场景用 `Lax`。
- **CSRF token**：表单 / 状态变更 API 必须带 CSRF token，校验后才处理。
- **不依赖 Referer 校验**：Referer 可被去除，仅作辅助。

---

## 4. 密钥管理（Secret Management）

### 4.1 禁止硬编码

- **密钥不进代码**：`const API_KEY = "sk-xxx"` 是反模式。
- **密钥不进注释**：`// 测试密钥 sk-xxx` 同样泄漏。
- **密钥不进 git**：`.gitignore` 必须含 `.env` / `*.pem` / `id_rsa` / `secrets.*`。
- **密钥不进日志**：日志不打印 Authorization header / API key 字段。

### 4.2 密钥来源

- **环境变量**：开发环境用 `.env` 文件（gitignore），生产用环境变量注入。
- **密钥管理服务**：生产环境用 Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager。
- **不写入镜像**：Docker 镜像不含密钥，运行时通过环境变量或挂载卷注入。

### 4.3 密钥轮换

- **定期轮换**：API key / 数据库密码每 90 天轮换，签名密钥每 180 天。
- **双密钥过渡**：轮换时新旧密钥同时有效一段时间（如 7 天），平滑切换。
- **吊销机制**：泄漏后能立即吊销并换新。

### 4.4 密钥分级

| 级别 | 用途 | 存储 | 访问控制 |
|------|------|------|---------|
| L1 公开 | 公钥 / 证书 | 代码仓库 | 公开 |
| L2 内部 | 内部 API token | CI 环境 + K8s secret | 团队级 |
| L3 敏感 | 数据库密码 / 第三方 API key | 密钥管理服务 | 应用级 RBAC |
| L4 极敏感 | 用户密码哈希盐 / 签名私钥 | HSM / KMS | 仅应用运行时 |

---

## 5. 依赖管理

### 5.1 依赖来源

- **仅用官方源**：npm / PyPI / Go module proxy / Maven Central，不用镜像源（除非内部 mirror）。
- **校验包完整性**：lockfile 必须含 integrity hash（`package-lock.json` / `poetry.lock` / `go.sum`）。
- **不 install 全局包**：项目级用 `venv` / `nvm` 隔离。

### 5.2 漏洞扫描

- **每次 CI 跑**：`npm audit` / `pip-audit` / `govulncheck` / `snyk`。
- **CVE 高危立即修**：CVSS ≥ 7.0 的依赖漏洞 24 小时内修复。
- **无法升级的依赖**：用补丁 / fork / 替代方案，记录到 `docs/decisions/` ADR。

### 5.3 依赖更新

- **定期更新**：每月跑 `npm update` / `pip install --upgrade`。
- **大版本升级**：单独 PR + 完整测试，记录 Breaking changes。
- **删除未使用依赖**：用 `depcheck` / `pipdeptree` 清理。

### 5.4 供应链安全

- **lockfile 进 git**：保证团队 install 一致。
- **不 install 任意 git URL**：除非内部可信源。
- **签名验证**：支持 Sigstore / GPG 签名的包优先。

---

## 6. 日志安全

### 6.1 不打印敏感信息

- **禁止打印**：密码 / 密钥 / 令牌 / 身份证号 / 银行卡号 / 手机号 / 邮箱（除非脱敏）。
- **Authorization header**：不打印 `Authorization: Bearer xxx` 的 token 值。
- **支付信息**：不打印 CVV / 完整卡号 / 完整有效期。

### 6.2 PII 处理

- **PII（个人身份信息）按 GDPR / 个保法处理**：
  - 收集前告知用途与保留期
  - 仅收集必要字段
  - 存储加密（at-rest encryption）
  - 传输加密（TLS 1.2+）
  - 删除权：用户请求删除时按期清理
- **日志中脱敏**：
  - 手机号：`138****8888`
  - 邮箱：`abc****@example.com`
  - 身份证号：`110***********1234`
  - IP：`192.168.*.*`

### 6.3 日志保留

- **业务日志保留 90 天**（按合规要求调整）。
- **审计日志保留 1 年+**（按合规要求）。
- **日志加密存储**：at-rest encryption，访问需 RBAC。

### 6.4 由 privacy-guard 自动脱敏

- HOOKS.md §2.2.5 决策：`tool_call_after` hook 调 privacy-guard 对工具输出脱敏。
- privacy-guard 卡片定义：识别密钥 / 令牌 / PII 模式并替换。
- **代码层应避免主动打印敏感字段**——隐私保护是双保险，不是兜底。

---

## 7. 网络安全

### 7.1 TLS

- **强制 HTTPS**：所有 HTTP 接口必须支持 TLS 1.2+，禁止明文 HTTP（除 localhost 调试）。
- **TLS 1.3 优先**：客户端优先 TLS 1.3，回退 1.2。
- **禁用弱密码套件**：RC4 / 3DES / MD5 等。
- **证书**：生产用 Let's Encrypt / 商业 CA，有效期 ≤ 90 天（推荐自动化续期）。
- **HSTS**：`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`。

### 7.2 CORS

- **白名单 Origin**：不开放 `Access-Control-Allow-Origin: *`，列出允许的源。
- **预检请求**：复杂请求支持 OPTIONS 预检，校验 Origin 后返回正确 CORS 头。
- **不暴露敏感头**：`Access-Control-Expose-Headers` 仅暴露必要头。

### 7.3 速率限制

- **API 限流**：默认 100 req/min/IP，登录 / 注册等敏感接口 5 req/min/IP。
- **响应 429**：超限返回 429 + `Retry-After` 头。
- **分布式限流**：多实例用 Redis 计数器，避免单机限流被绕过。

### 7.4 防止 DDoS

- **CDN / WAF**：生产环境前置 CDN / WAF（Cloudflare / AWS WAF）。
- **黑名单机制**：异常 IP 自动加入黑名单（如 1 分钟内 1000 次请求）。
- **慢速攻击防护**：连接超时 + 读取超时 + 写入超时（默认 30s / 10s / 10s）。

### 7.5 内部服务调用

- **mTLS**：服务间调用用 mTLS 双向证书认证。
- **服务网格**：Istio / Linkerd 提供 mTLS / 限流 / 熔断。
- **不暴露内部端口**：内部服务不监听 0.0.0.0，仅监听 127.0.0.1 或内网 IP。

---

## 8. 隐私保护

### 8.1 数据最小化

- **仅收集必要字段**：注册时不强制收集出生日期 / 性别等非必要信息。
- **按需暴露**：API 响应仅返回业务必要字段，不返回全表。
- **日志最小化**：不打印与业务无关的 PII。

### 8.2 数据脱敏

- **展示脱敏**：UI 上手机号 / 邮箱 / 身份证号部分掩码（如 `138****8888`）。
- **日志脱敏**：详见 §6.2。
- **导出脱敏**：数据导出 / 备份时敏感字段加密或脱敏。

### 8.3 数据加密

- **传输加密**：TLS 1.2+（详见 §7.1）。
- **存储加密**：数据库 TDE（Transparent Data Encryption）或字段级加密。
- **备份加密**：备份文件加密，密钥单独管理。

### 8.4 访问控制

- **最小权限**：用户 / 服务账号仅授予完成任务所需的最小权限。
- **审计访问**：DBA / 运维访问生产数据库需审计，敏感操作需双人确认。
- **数据导出审批**：导出 PII 数据需审批 + 留痕。

### 8.5 由 privacy-guard 兜底

- HOOKS.md §2.2.5：`tool_call_after` 调 privacy-guard 对工具输出脱敏，防止敏感信息进入模型上下文。
- privacy-guard 规则集可配置：`.specflow/privacy-rules.yaml` 项目级，`~/.codex-plugin/privacy-rules.yaml` 全局级。
- 详见 `docs/component/cards/privacy-guard.md`。

---

## 9. 不可变原则

本基线属于 `semantic: spec` 层，不可在项目级覆盖。变更需走 ADR 流程：

1. 提交 ADR 描述变更原因与影响（如降低某项门槛需说明业务理由）
2. 安全评审通过后合并
3. bump 本文档 version（SemVer）
4. 通知所有项目更新引用

---

## 10. 安全检查清单

每次发布前用以下清单核查：

- [ ] 所有依赖已扫描漏洞（CVSS ≥ 7.0 已修复）
- [ ] 所有密钥已从代码移除（用 `git-secrets` / `trufflehog` 扫描历史）
- [ ] 所有外部输入已校验（白名单 + 类型 + 长度）
- [ ] 所有输出已按上下文编码
- [ ] 所有 SQL 查询已参数化
- [ ] 所有 HTTP 接口已强制 HTTPS
- [ ] 所有敏感接口已加鉴权 + 限流
- [ ] 所有日志已脱敏（不含 PII / 密钥）
- [ ] 所有 PII 存储已加密
- [ ] 所有第三方调用已设超时 + 重试 + 降级
