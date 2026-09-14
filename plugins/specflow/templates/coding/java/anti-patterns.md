---
title: Java 反模式与陷阱
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

# Java 反模式与陷阱（templates/coding/java/anti-patterns.md）

> 本文收录 Java 项目中高频出现且代价昂贵的反模式，每条都给出 ❌ 反例、
> ✅ 正例与一句话原因。语言规范基线见 `templates/coding/java/spec.md`；
> 安全相关反模式见 `templates/coding/security.md`。
> 所有反例均来自真实 PR review，禁止以「我这次是特例」为由复现。

## 1. 类型与对象类反模式

### 1.1 `==` 比较对象引用

❌ 反例：

```java
if (str == "expected") { ... }  // 引用比较，不一定为 true
Integer a = 127, b = 127;
if (a == b) { ... }  // Integer 缓存陷阱：-128~127 为 true，超出为 false
```

✅ 正例：

```java
if ("expected".equals(str)) { ... }  // 常量在前防 NPE
if (Objects.equals(a, b)) { ... }
```

`==` 比较引用而非值；包装类型的缓存陷阱让 `==` 在小整数上「偶然」为 true，超出则失败；
必须用 `equals` 比较值，且 `equals` 必须连同 `hashCode` 一起实现。

### 1.2 静态可变字段承载业务状态

❌ 反例：

```java
public class UserService {
    private static Map<String, User> cache = new HashMap<>();  // 全局共享，并发与测试不可控
}
```

✅ 正例：

```java
@Service
public class UserService {
    private final Map<String, User> cache = new ConcurrentHashMap<>();
    // 或注入 Cache<K, V> 由调用方控制生命周期
}
```

静态可变字段在多线程下并发不可控，且测试间状态污染；
业务状态必须用实例字段 + 依赖注入。

### 1.3 用 `new Date()` / `Calendar`

❌ 反例：

```java
Date now = new Date();  // 可变，线程不安全
Calendar cal = Calendar.getInstance();
cal.setTime(now);
cal.add(Calendar.DAY_OF_MONTH, 1);
```

✅ 正例：

```java
Instant now = Instant.now();
Instant tomorrow = now.plus(1, ChronoUnit.DAYS);
// 或用注入的 Clock：clock.instant()
```

`Date` 与 `Calendar` 是可变且线程不安全的旧 API；
`java.time`（`Instant` / `LocalDate` / `ZonedDateTime`）不可变且线程安全。

## 2. 异常处理类反模式

### 2.1 捕获 Exception 后吞掉

❌ 反例：

```java
try {
    risky();
} catch (Exception e) {
    e.printStackTrace();  // 仅打印，不记日志不 rethrow
}
```

✅ 正例：

```java
try {
    risky();
} catch (ValidationException e) {
    log.warn("validation failed, code={}", e.code());
    throw new ApiException(400, e.code());
} catch (Exception e) {
    log.error("unexpected failure", e);
    throw new ApiException(500, "INTERNAL");
}
```

吞掉异常让排障无从下手，且可能掩盖数据损坏；
必须按异常类型分支处理，至少记日志并 rethrow。

### 2.2 在 `finally` 中 `return`

❌ 反例：

```java
public int f() {
    try {
        return doWork();
    } finally {
        return 0;  // 覆盖 try 里的返回值与异常
    }
}
```

✅ 正例：

```java
public int f() {
    int result = doWork();
    cleanup();
    return result;
}
```

`finally` 里的 `return` 会吞掉 `try` 块抛出的异常并覆盖返回值；
`finally` 仅用于资源释放，禁止包含控制流语句。

### 2.3 catch `Throwable` / `Exception` 后丢失异常链

❌ 反例：

```java
try {
    risky();
} catch (Exception e) {
    throw new RuntimeException("failed");  // 丢失原异常
}
```

✅ 正例：

```java
try {
    risky();
} catch (Exception e) {
    throw new AppException("FETCH_FAILED", "fetch failed", e);
}
```

catch 后重新抛出必须保留 `cause`（`new X(msg, cause)`）；
否则排障时无法追溯到根因。

## 3. 并发与资源类反模式

### 3.1 `Executors.newCachedThreadPool()` 无界线程

❌ 反例：

```java
ExecutorService pool = Executors.newCachedThreadPool();  // 无上限，OOM 风险
```

✅ 正例：

```java
ExecutorService pool = new ThreadPoolExecutor(
    4, 16, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000),
    new ThreadFactoryBuilder().setNameFormat("worker-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

`newCachedThreadPool` 在高并发下会无上限创建线程导致 OOM；
必须显式参数化 `ThreadPoolExecutor`，含命名工厂与拒绝策略。

### 3.2 事务方法内做 RPC / 长阻塞

❌ 反例：

```java
@Transactional
public void place(OrderInput input) {
    repo.save(order);
    httpClient.send(notification);  // 长阻塞，连接池耗尽
}
```

✅ 正例：

```java
@Transactional
public void place(OrderInput input) {
    repo.save(order);
    eventPublisher.publish(new OrderPlaced(order));  // 事务提交后异步处理
}
// 监听器单独处理通知
```

事务方法持有 DB 连接，长阻塞会耗尽连接池；
RPC / IO 必须在事务外（用 `@TransactionalEventListener` 在提交后处理）。

### 3.3 字符串拼接 SQL

❌ 反例：

```java
String sql = "SELECT * FROM users WHERE id = '" + uid + "'";  // SQL 注入
stmt.execute(sql);
```

✅ 正例：

```java
try (var ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?")) {
    ps.setString(1, uid);
    try (var rs = ps.executeQuery()) {
        // ...
    }
}
// 或用 JPA / Spring Data JPA Repository
```

字符串拼接 SQL 是经典注入漏洞；`PreparedStatement` 让驱动做参数转义。

## 4. 设计类反模式

### 4.1 深继承层级 > 2

❌ 反例：

```java
class BaseRepository<T> { ... }
class AbstractUserRepository extends BaseRepository<User> { ... }
class JdbcUserRepository extends AbstractUserRepository { ... }
class AdminUserRepository extends JdbcUserRepository { ... }  // 4 层
```

✅ 正例：

```java
interface UserRepository { ... }
class JdbcUserRepository implements UserRepository { ... }  // 1 层实现
class AdminUserRepository implements UserRepository { ... }  // 平行实现
```

深继承层级让方法解析不可预测且测试困难；
GoF 设计原则优先组合 + 接口，继承层级 ≤ 2。

### 4.2 反射调用替代显式接口

❌ 反例：

```java
Method m = obj.getClass().getMethod("process", String.class);
m.invoke(obj, input);  // 运行时才失败的隐式契约
```

✅ 正例：

```java
public interface Processor { void process(String input); }
Processor p = (Processor) obj;  // 编译期检查
p.process(input);
```

反射调用绕过类型系统，方法签名错误在运行时才暴露；
必须用显式接口让编译器校验，反射仅用于框架内部（如 Spring 容器）。
