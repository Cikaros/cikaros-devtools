---
title: Java 编码规范
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

# Java 编码规范（templates/coding/java/standards.md）

> 本文是 Java 在 specflow 体系下的「可执行编码规范」——命名、格式化、
> 文件与目录结构、import 顺序、错误传播、日志、测试约定。语言规范基线见
> `templates/coding/java/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 Google Java Style。

## 1. 命名约定

### 1.1 标识符大小写规则

- 类、接口、枚举、注解、record：PascalCase；如 `UserService`、`OrderStatus`。
- 方法、字段、局部变量：camelCase；如 `userService`、`fetchUser`、`isActive`。
- 常量（`static final` 不可变）：UPPER_SNAKE_CASE；如 `MAX_RETRY = 3`。
- 包名：全小写倒序域名（`com.acme.order`）；禁止复数包名（`utils`、`misc`）。
- 布尔方法：`is/has/can/should` 前缀；`isValid`、`hasPermission`。

### 1.2 命名禁忌

- 禁止否定式布尔命名：用 `isNotEmpty` 而非 `isEmpty` 的反义 `notEmpty`（双重否定）。
- 禁止 `Interface` / `Impl` 后缀：接口名描述行为（`UserRepository` 而非 `IUserRepository`），
  实现类用领域名（`JdbcUserRepository` 而非 `UserRepositoryImpl`）。
- 禁止匈牙利记号（`strName` / `intCount`）：类型由编译器检查，前缀是冗余。
- 缩写词统一：`URL` / `parseURL`；禁止 `Url` / `parseUrl`（Google Style）。

## 2. 格式化与文件结构

### 2.1 格式化基线

- 格式化统一（IDE 共享 config 或 palantir-java-format）；行宽 120。
- import 按组排序并消除通配（`import xxx.*` 禁止）；
  分组：`java.*` → `javax.*` → 第三方 → 本地，组间空行。
- 大括号 K&R 风格（开括号同行）；`if/else/for/while` 必带大括号（即使单语句）。
- 一个顶层类型一个文件（文件名 = 类名）；嵌套类型 ≤ 2 层。

### 2.2 目录结构

```
src/
  main/
    java/
      com/cikaros/order/
        api/             # HTTP / RPC 适配层（controller）
        service/         # 用例编排
        domain/          # 领域模型与纯函数规则
        infra/           # DB / 外部 SDK 适配（repository 实现）
        OrderApplication.java  # Spring Boot 入口
    resources/
  test/
    java/                # 单测与集成测，与 main 同包结构
    resources/
pom.xml                  # 或 build.gradle + settings.gradle
```

约束：Maven / Gradle 标准布局；多模块按领域拆（`order-api` / `order-domain` / `order-infra`）。
分层清晰：controller（协议适配）→ service（用例编排）→ domain（业务规则）；
禁止 controller 直调 repository（跳过领域层）。

### 2.3 文件大小与拆分

- 一个文件一个顶层类型；文件超过 500 行考虑拆分；方法超过 40 行必须有拆分理由。
- 嵌套类型 ≤ 2 层；超过的应抽成独立文件。
- 测试文件与被测文件同包，命名 `XxxTest`（JUnit 5）。

## 3. import 与依赖

### 3.1 import 风格

```java
import java.util.List;
import java.util.Map;
import java.time.Instant;

import org.springframework.stereotype.Service;

import com.cikaros.order.domain.User;
```

- import 按组排序：`java.*` → `javax.*` → 第三方 → 本地，组间空行。
- 禁止通配 import（`import xxx.*`）；用 IDE 自动管理单类型 import。
- 静态 import 仅用于 `Assertions.assertThat` 等测试场景；
  生产代码禁止静态 import（破坏可读性）。
- 循环依赖零容忍：Maven / Gradle 编译期强制检测，出现即重构。

### 3.2 依赖管理

- 依赖管理用 Maven BOM 或 Gradle platform 统一版本；禁止子模块各自声明版本号。
- 依赖锁定：Maven 用 `maven-enforcer-plugin` 的 `dependencyConvergence`；
  Gradle 用 `dependencyLocking`。
- 升级策略：patch 走 Dependabot / renovate 自动合并；minor 走人工 PR；
  major 必须单独 PR + 回归测试。
- 依赖范围严格：`provided` / `runtime` / `test` 区分清楚，禁止全部 `compile`。

## 4. 错误传播与日志

### 4.1 错误传播链

- 检查异常仅用于可恢复的业务失败；编程错误用 `RuntimeException` 子类。
- 异常链必须保留（`new X("msg", cause)`）；禁止 catch 后仅 `e.printStackTrace()`。
- 全局异常处理器（`@ControllerAdvice`）统一转错误响应；
  消息禁止泄漏内部路径 / SQL / PII（与 `templates/coding/security.md` 一致）。
- 禁止 catch `Exception` / `Throwable` 后吞掉（无日志无 rethrow）。

### 4.2 日志约定

```java
private static final Logger log = LoggerFactory.getLogger(OrderService.class);

log.info("user fetched, userId={}, traceId={}", uid, tid);
log.error("place order failed, userId={}", uid, e);
```

- 用 SLF4J 接口 + Logback / Log4j2 实现；禁止 `System.out.println` 进生产路径。
- 日志用占位符 `{}` 而非字符串拼接（性能与可读性）；
  异常对象作为最后一个参数自动堆栈输出。
- 日志字段固定 schema：traceId 由 MDC 注入全链路透传；
  字段名用 camelCase 与代码一致。
- 禁止日志输出敏感字段（token、密码、完整身份证号）；超过 4 位的敏感字段做掩码。

### 4.3 错误与日志的边界

```java
try {
    orderService.place(input);
} catch (ValidationException e) {
    log.warn("validation failed, code={}, traceId={}", e.code(), tid);
    throw new ApiException(400, e.code());
} catch (Exception e) {
    log.error("place order failed, traceId={}", tid, e);
    throw new ApiException(500, "INTERNAL");
}
```

边界层（controller / RPC handler / CLI 入口）统一 catch + 转换为协议错误响应；
检查异常跨层传递必须用 `RuntimeException` 包装保留链路（避免 `throws` 蔓延）。

## 5. 测试约定

### 5.1 测试组织

- JUnit 5 + AssertJ（流式断言）+ Mockito；测试命名 `should<期望>_when<条件>`。
- 一个测试只断言一件事；`assertThat` 数量 ≤ 5，超过的拆成多个测试方法。
- 测试组织：`@Nested` 分组相关场景；`@ParameterizedTest` 覆盖边界值。

```java
@Nested
class FindById {
    @Test
    void should_return_user_when_id_exists() { ... }
    @Test
    void should_return_empty_when_id_not_found() { ... }
}
```

### 5.2 mock 与夹具

- 单测不依赖真实网络 / DB（Testcontainers 做集成测）；
  mock 用 Mockito 的 `@Mock` / `@InjectMocks`。
- mock 只 mock 边界（网络 / 时钟 / 随机 / DB），不 mock 被测内部方法。
- 时间用注入的 `Clock` bean 而非直接 `Instant.now()`；
  测试用 `Clock.fixed(...)` 控制时间。
- 夹具（builder / factory）独立成 `*TestFixtures` 类，禁止跨测试复制粘贴构造数据。

### 5.3 覆盖率与静态分析

- 覆盖率门禁（JaCoCo）核心模块行覆盖 ≥ 80%；新代码不允许负增长。
- 静态分析 SpotBugs + ErrorProne 进 CI；`@SuppressWarnings` 必须带 reason 注释。
- 集成测试用 Testcontainers（真实 DB / Redis / Kafka）；禁止 H2 替代 PostgreSQL 的语义差异。
- 构建可重现（Gradle wrapper / Maven 锁定插件版本）；CI 跑 `mvn verify` 或 `gradlew check`。
