---
title: Java 文档规范
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
  - templates/coding/java/spec.md
---

# Java 文档规范（templates/coding/java/docs.md）

> 本文是 Java 项目的文档与注释规范，覆盖行内注释、Javadoc、README 结构、
> Javadoc 生成与 Changelog 约定。语言规范基线见
> `templates/coding/java/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 Oracle Javadoc 指南。

## 1. 行内注释与文件头

### 1.1 行内注释规则

- 注释解释「为什么」而非「做什么」：代码本身已表达做什么，注释补意图与约束。
- 一行注释紧贴被解释代码上方；超过 3 行的逻辑注释应抽成命名方法让代码自解释。
- 禁止保留被注释掉的死代码（git 历史已存）；review 时直接拒绝。
- TODO 必须带 issue 号：`// TODO(#1234): retry logic for 5xx`。
- 注释与代码同语言：项目主体是中文则注释中文，避免中英混杂。

```java
// 因为 Hibernate 在 6.2 修复了 N+1 上的 batch fetch，这里禁用 fetch=JOIN
@ManyToOne(fetch = FetchType.LAZY)
private User user;
```

### 1.2 文件头注释

仅当文件承载特殊语义（如自动生成、性能敏感、协议常量）时才加文件头注释，
且只描述不能从类名与包路径推断的信息。禁止在每文件头机械堆砌版权 / 作者——
这些信息由 git 历史与 `LICENSE` 文件承载。

```java
// 自动生成，请勿手改。来源：proto/order/v1/order.proto
// 生成命令：buf generate
package com.cikaros.order.v1;
```

## 2. Javadoc 函数文档

### 2.1 公共 API 的 Javadoc 模板

```java
/**
 * 根据 ID 获取用户；找不到时返回 {@link Optional#empty()} 而非抛错。
 *
 * @param id 用户唯一标识（UUID v4），非 null
 * @param traceId 链路追踪 ID，写入日志与响应头
 * @return 用户对象的 Optional；不存在时为 {@link Optional#empty()}
 * @throws NullPointerException 当 {@code id} 为 null
 * @throws UnauthorizedException 当调用方无权访问该用户
 *
 * @example
 * <pre>{@code
 * Optional<User> user = service.findById(uuid, traceId);
 * user.ifPresentOrElse(this::render, this::notFound);
 * }</pre>
 *
 * @since 1.2
 * @see #findByName(String, String)
 */
public Optional<User> findById(UUID id, String traceId) {
    // ...
}
```

### 2.2 Javadoc 强制规则

- 所有 public 类、方法、字段必须有 Javadoc，覆盖 `@param` / `@return` / `@throws`（如适用）。
- `@throws` 必须描述触发条件而非异常类型本身（`@throws UnauthorizedException 当调用方无权访问`）。
- `{@link}` 与 `{@code}` 让 Javadoc 工具生成可点击链接与等宽代码；
  禁止用裸 `<code>` 标签（JDK 工具不支持等宽渲染）。
- `@deprecated` 必须带替代方案：`@deprecated use {@link #findByIdV2} since 2.0`。
- `@since` 标注引入版本；新增 API 必须带。

### 2.3 包级 Javadoc

每个包用单独的 `package-info.java` 文件描述包职责：

```java
/**
 * 订单领域服务包。包含下单、取消、退款的业务规则。
 *
 * <p>所有方法均为纯函数，DB 操作由 infra 层注入。
 * 不处理 HTTP / RPC 协议层逻辑（见 {@code com.cikaros.order.api} 包）。
 *
 * @since 1.0
 * @author Cikaros
 */
package com.cikaros.order.service;
```

约束：包 Javadoc 描述「包做什么、不做什么、依赖什么」；
禁止复述包名与类名。

## 3. README 结构

### 3.1 标准段落顺序

1. **标题 + 一句话定位**：包名 + 解决什么问题 + 不解决什么问题。
2. **安装**：Maven `<dependency>` 片段 或 Gradle `implementation` 片段，含 Java 版本要求。
3. **快速开始**：可复制粘贴运行的最小示例（< 20 行）。
4. **核心概念**：必要的领域名词解释（与 spec.md 一致）。
5. **API**：链接到 Javadoc 站点，不在 README 重复罗列签名。
6. **配置**：`application.yml` 示例、环境变量表格、命令行参数。
7. **测试与发布**：`mvn verify` / `gradlew check`、版本与发布流程。
8. **变更记录**：链接到 `CHANGELOG.md`。
9. **许可证**：链接到 `LICENSE`。

### 3.2 README 写作约束

- 示例代码必须是可运行的完整片段，禁止省略 import 让用户猜。
- 中文项目用中文 README；面向 Maven Central 发布的包同时维护英文 README（`README.en.md`）。
- 禁止在 README 出现内部链接、内部代号、未脱敏的配置值。
- 示例代码用 ```` ```java ```` 代码块且必须通过 `mvn compile` 编译。

## 4. Javadoc 配置

### 4.1 Maven 最小配置

`pom.xml` 的 `<build>` 段：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-javadoc-plugin</artifactId>
    <version>3.6.3</version>
    <configuration>
        <failOnError>true</failOnError>
        <failOnWarnings>true</failOnWarnings>
        <doclint>all,-missing</doclint>
        <source>17</source>
        <links>
            <link>https://docs.oracle.com/en/java/javase/17/docs/api/</link>
        </links>
    </configuration>
    <executions>
        <execution>
            <goals><goal>jar</goal></goals>
        </execution>
    </executions>
</plugin>
```

约束：`failOnWarnings=true` 在 CI 守门（破损的 `{@link}` 必须修复）；
`doclint=all,-missing` 检查语法但允许缺 `@param` 等可选标签（避免噪声）。
`links` 链接到标准库 Javadoc 让类型签名可跳转。

### 4.2 Gradle 最小配置

`build.gradle`：

```gradle
java {
    withJavadocJar()
}

javadoc {
    options {
        encoding = 'UTF-8'
        docLint = 'all,-missing'
        links = ['https://docs.oracle.com/en/java/javase/17/docs/api/']
    }
    failOnError = true
}
```

### 4.3 生成与发布

```bash
mvn javadoc:javadoc       # 输出到 target/site/apidocs/
mvn javadoc:jar           # 打包为 jar 发布到 Maven Central
gradlew javadoc           # Gradle 等价命令
```

CI 流水线在 `main` 分支合并后自动跑 Javadoc 并发布到文档站点；
PR 改动公共 API 必须在描述里附预览链接。`failOnWarnings` 失败即 CI 失败。

## 5. Changelog 约定

### 5.1 Keep a Changelog 格式

`CHANGELOG.md` 顶部为未发布版本 `[Unreleased]`，下方为已发布版本倒序排列：
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六个段落。

```markdown
## [Unreleased]

### Added
- `findById(UUID, String traceId)` 支持链路追踪 ID (#123)

### Fixed
- 修复 `parseAmount` 在空字符串时抛 NPE (#124)

## [1.2.0] - 2026-09-01

### Changed
- **BREAKING**: `findById` 返回 `Optional<User>` 而非 `User`（可能为 null）
```

### 5.2 与版本号的衔接

Java 库版本遵循语义化版本（`1.2.0`）；`BREAKING CHANGE` 触发主版本号提升，
Maven Central 发布新主版本时保留旧版本（不删除，避免下游构建断裂）。
提交信息用 Conventional Commits（`feat:` / `fix:` 等），
合并到 main 时由 `release-please` 或 `maven-release-plugin` 自动追加到 `CHANGELOG.md` 的 `[Unreleased]`。
发布流程：`mvn release:prepare` → `mvn release:perform` → Maven Central 同步。
