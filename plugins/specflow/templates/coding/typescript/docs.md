---
title: TypeScript 文档规范
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-03T00:00:00+08:00
author: Cikaros
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
  - templates/coding/typescript/spec.md
---

# TypeScript 文档规范（templates/coding/typescript/docs.md）

> 本文是 TypeScript 项目的文档与注释规范，覆盖行内注释、JSDoc 函数文档、
> README 结构、TypeDoc 生成配置与 Changelog 约定。语言规范基线见
> `templates/coding/typescript/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查外部文档规范。

## 1. 行内注释与文件头

### 1.1 行内注释规则

- 注释解释「为什么」而非「做什么」：代码本身已表达做什么，注释补意图与约束。
- 一行注释紧贴被解释代码上方；超过 3 行的逻辑注释应抽成命名函数让代码自解释。
- 禁止保留被注释掉的死代码（git 历史已存）；review 时直接拒绝。
- TODO 必须带 issue 号：`// TODO(#1234): retry logic for 5xx`。

```ts
// 因为 SDK 在 3.2 版本会重试 5xx，这里只处理 4xx，避免双重重试
if (err.code.startsWith('4')) throw err;
```

### 1.2 文件头注释

仅当文件承载特殊语义（如自动生成、性能敏感、协议常量）时才加文件头注释，
且只描述不能从文件名与导出推断的信息。禁止在每文件头机械堆砌版权/作者——
这些信息由 git 历史与 LICENSE 文件承载。

```ts
/**
 * 自动生成，请勿手改。来源：proto/order/v1/order.proto
 * 生成命令：buf generate
 */
```

## 2. JSDoc 函数文档

### 2.1 公共 API 的 JSDoc 模板

```ts
/**
 * 根据 ID 获取用户；找不到时返回 null 而非抛错。
 *
 * @param id - 用户唯一标识（UUID v4）
 * @param opts.signal - 可选取消信号；超时由调用方控制
 * @returns 用户对象；不存在时为 null
 * @throws {AppError} code='UNAUTHORIZED' 当 caller 无权访问该用户
 *
 * @example
 * ```ts
 * const user = await getUser('uuid', { signal: ctrl.signal });
 * if (!user) return notFound();
 * ```
 */
export async function getUser(id: string, opts?: { signal?: AbortSignal }): Promise<User | null> {
  // ...
}
```

### 2.2 JSDoc 强制规则

- 公共导出函数（非内部辅助）必须有 `@param`、`@returns`、`@throws`（如适用）。
- `@example` 必须可执行（被文档测试覆盖，或至少 type-check 通过）。
- 类型注解已表达的信息（如 `id: string`）不重复在 JSDoc 中描述；
  JSDoc 描述「语义、约束、副作用」等运行时不可见信息。
- `@deprecated` 必须带替代方案：`@deprecated use {@link getUserV2} since v2.0`。

### 2.3 包级 README 的 JSDoc 入口

`src/index.ts` 顶部用 `/** @packageDocumentation */` 标注包文档入口，
TypeDoc 会把这段渲染为包首页。描述包的职责边界、典型用法、不适用场景。

## 3. README 结构

### 3.1 标准段落顺序

1. **标题 + 一句话定位**：包名 + 解决什么问题 + 不解决什么问题。
2. **安装**：`pnpm add @cikaros/sdk`，含 peer 依赖说明。
3. **快速开始**：可复制粘贴运行的最小示例（< 20 行）。
4. **核心概念**：必要的领域名词解释（与 spec.md 一致）。
5. **API**：链接到 TypeDoc 生成的站点，不在 README 重复罗列签名。
6. **配置**：环境变量、tsconfig 选项、运行时配置项表格。
7. **测试与发布**：`pnpm test`、`pnpm build`、版本与发布流程。
8. **变更记录**：链接到 `CHANGELOG.md`。
9. **许可证**：链接到 `LICENSE`。

### 3.2 README 写作约束

- 示例代码必须是可运行的完整片段，禁止省略 import 让用户猜。
- 中文项目用中文 README；面向 npm 发布的包同时维护英文 README（`README.en.md`）。
- 禁止在 README 出现内部链接、内部代号、未脱敏的配置值。

## 4. TypeDoc 配置

### 4.1 最小配置

`typedoc.json` 放在仓库根目录：

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts"],
  "out": "docs/api",
  "plugin": ["typedoc-plugin-missing-exports"],
  "readme": "README.md",
  "excludePrivate": true,
  "excludeInternal": true,
  "treatWarningsAsErrors": true,
  "validation": { "notDocumented": true },
  "githubPages": false
}
```

约束：`excludePrivate` 与 `excludeInternal` 必须开（避免泄漏内部实现）；
`treatWarningsAsErrors` 在 CI 守门（破损的 JSDoc 链接必须修复）。

### 4.2 生成与发布

```bash
pnpm dlx typedoc --options typedoc.json
# 输出在 docs/api/，可挂到 GitHub Pages 或静态站点托管
```

CI 流水线在 `main` 分支合并后自动跑 TypeDoc 并发布到文档站点；
PR 改动公共 API 必须在描述里附预览链接。

## 5. Changelog 约定

### 5.1 Keep a Changelog 格式

`CHANGELOG.md` 顶部为未发布版本 `[Unreleased]`，下方为已发布版本倒序排列：
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六个段落。

```markdown
## [Unreleased]

### Added
- `getUser(id, { signal })` 支持 AbortSignal 取消 (#123)

### Fixed
- 修复 `parseConfig` 在空对象时抛错的问题 (#124)

## [1.2.0] - 2026-09-01

### Changed
- **BREAKING**: `fetchUser` 返回 `User | null` 而非 `User | undefined`
```

### 5.2 与 Conventional Commits 的衔接

提交信息用 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`），
合并到 main 时由 changesets 或 release-please 自动追加到 `CHANGELOG.md` 的 `[Unreleased]`。
`BREAKING CHANGE:` footer 触发主版本号提升，必须附迁移指南链接。
