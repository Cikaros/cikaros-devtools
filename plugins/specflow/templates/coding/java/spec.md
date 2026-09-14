---
title: Java 语言规范
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-02T00:00:00+08:00
author: specflow
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
---

# Java 语言规范（templates/coding/java/spec.md）

> 按需加载层：session-start 检测到主语言为 Java 时注入摘要。
> 与语言无关的通用基线见 `spec/coding-standards.md`；安全补充见 `templates/coding/security.md`。

## 1. 语法

### 1.1 版本与语法基线

- 目标 Java 17 LTS（record、sealed、switch 表达式、文本块已稳定）；
  新项目不选非 LTS 版本，升级走 LTS → LTS。
- 格式化统一（IDE 共享 config 或 palantir-java-format）；
  行宽 120；import 按组排序并消除通配（`import xxx.*` 禁止）。
- 一个顶层类型一个文件（文件名 = 类名）；嵌套类型 ≤ 2 层。

### 1.2 类型系统

- 禁止裸 `null` 语义蔓延：返回可空用 `Optional<T>`（仅返回值/字段边界），
  参数不接受 Optional（用重载或 `@Nullable` 注解 + 检查）。
- record 承载不可变数据载体（DTO/值对象）；可变实体才用 class。
- 泛型通配符遵循 PECS（Producer-Extends, Consumer-Super）；
  禁止 raw type（`List` 而非 `List<String>`）。

### 1.3 命名

- 类/接口/枚举 PascalCase；方法/字段 camelCase；常量 UPPER_SNAKE。
- 布尔方法 `is/has/can/should` 前缀；禁止否定式命名（`isNotEmpty`
  优于 `isEmpty` 的反义 `notEmpty`）。
- 包名全小写倒序域名（`com.acme.order`）；禁止复数包名（`utils`、`misc`）。

## 2. 高级特性

### 2.1 record 与 sealed

- record 用于不可变数据：自动 equals/hashCode/toString；
  紧凑构造器里做参数校验。
- sealed interface 限定实现集（`permits`）→ 替代「类型标签 + if-else」；
  配合 switch 表达式 exhaustive 检查（少一个 case 编译失败）。
- 禁止 record 里放可变数组/集合并暴露引用（防御性拷贝）。

### 2.2 并发

- 线程池必须显式命名与容量上限（`ThreadPoolExecutor` 参数化）；
  禁止 `Executors.newCachedThreadPool()`（无界线程）。
- 共享可变状态优先 `java.util.concurrent`（ConcurrentHashMap /
  LongAdder）；synchronized 仅短临界区。
- 虚拟线程（Loom）用于 IO 密集任务；挂起期间不能持有 synchronized
  （pinning 风险，用 ReentrantLock 替代）。

### 2.3 Stream 与 Optional

- Stream 用于声明式转换（map/filter/collect）；
  有副作用的 peek / 循环内短路 break 复杂逻辑改回 for 循环。
- Collectors.toUnmodifiableList/Set 为默认收集；
  `Collectors.toList()` 返回可变集合仅在确需可变时使用并注明。
- Optional 链不超 3 层；`Optional.get()` 禁止（用 orElse/orElseThrow）。

### 2.4 异常

- 检查异常仅用于可恢复的业务失败；编程错误用 RuntimeException 子类。
- 异常链必须保留（`new X("msg", cause)`）；禁止 catch 后仅
  `e.printStackTrace()`。
- 全局异常处理器（@ControllerAdvice / similar）统一转错误响应；
  消息禁止泄漏内部路径/SQL/PII。

## 3. 编码规范

### 3.1 工程结构

- Maven/Gradle 标准布局（src/main/java、src/test/java）；
  多模块按领域拆（order-api / order-domain / order-infra）。
- 依赖注入走构造器（final 字段）；禁止字段 @Autowired 反射注入
  （Spring 团队规范同向）。
- 分层清晰：controller（协议适配）→ service（用例编排）→ domain（业务规则）；
  禁止 controller 直调 repository（跳过领域层）。

### 3.2 资源管理

- 资源（流/连接/锁）一律 try-with-resources；
  禁止手动 close 配对（异常路径泄漏）。
- 数据库事务边界在 service 层（@Transactional）；
  禁止事务方法内做 RPC/IO 长阻塞（连接池耗尽）。

### 3.3 测试

- JUnit 5 + AssertJ（流式断言）+ Mockito；测试命名
  `should<期望>_when<条件>`。
- 单测不依赖真实网络/DB（Testcontainers 做集成测）；
  参数化测试（@ParameterizedTest）覆盖边界值。
- 覆盖率门禁（JaCoCo）核心模块行覆盖 ≥ 80%；新代码不允许负增长。

### 3.4 工具链

- 构建可重现（Gradle wrapper / Maven 锁定插件版本）；CI 跑
  `mvn verify` 或 `gradlew check`。
- 静态分析 SpotBugs + ErrorProne 进 CI；unused/suppress 警告
  必须带 reason 注释。
- 依赖升级走 Dependabot/renovate 小步 PR；禁止一次性大版本跳跃。

## 4. 反模式（禁止）

- ❌ 静态可变字段承载业务状态（并发与测试不可控）。
- ❌ 字符串拼接 SQL / Statement 而非 PreparedStatement（注入）。
- ❌ `new Date()` / `Calendar`（可变且线程不安全；用 java.time）。
- ❌ `==` 比较对象引用（包装类型缓存陷阱）；equals 必须连同 hashCode。
- ❌ 捕获 Exception 后吞掉（无日志无 rethrow）。
- ❌ 深继承层级 > 2（用组合 + 接口）。
- ❌ 在 finally 中 return（吞异常）。
- ❌ 反射调用替代显式接口（运行时才失败的隐式契约）。
