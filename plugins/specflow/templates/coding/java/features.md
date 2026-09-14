---
title: Java 语言特性
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

# Java 语言特性（templates/coding/java/features.md）

> 本文是 Java 在 specflow 体系下的「特性清单」，列出团队约定的现代语法、
> 类型系统能力、并发模型、错误处理范式与模块系统。语言规范基线见
> `templates/coding/java/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。读到这份文档即应能在不查外部资料的前提下，
> 写出符合本仓库约定的 Java 代码。

## 1. 现代语法演进

### 1.1 版本与语法坐标

- 目标 Java 17 LTS（record、sealed、switch 表达式、文本块已稳定）；
  新项目不选非 LTS 版本，升级走 LTS → LTS（17 → 21）。
- 21 LTS 可用虚拟线程（Loom）、模式匹配增强、`SequencedCollection`；
  生产环境 17 与 21 并存时，21 特性必须隔离在可选模块内。
- 格式化统一（IDE 共享 config 或 palantir-java-format）；行宽 120。
- import 按组排序并消除通配（`import xxx.*` 禁止）；一个顶层类型一个文件。

### 1.2 record 与不可变数据

```java
public record Order(UUID id, List<OrderItem> items, BigDecimal total) {
    public Order {
        if (total.signum() < 0) {
            throw new IllegalArgumentException("total must be non-negative");
        }
        items = List.copyOf(items); // 防御性拷贝，保证不可变
    }
}
```

约束：record 用于不可变数据载体（DTO / 值对象）；可变实体才用 class。
禁止 record 里放可变数组 / 集合并暴露引用（防御性拷贝在紧凑构造器）。

### 1.3 sealed 与 switch 表达式

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double r) implements Shape {}
public record Square(double s) implements Shape {}
public record Triangle(double a, double b, double c) implements Shape {}

public double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        case Triangle t -> heron(t.a(), t.b(), t.c());
        // exhaustive：sealed 保证编译器知道所有实现
    };
}
```

sealed interface 限定实现集 → 替代「类型标签 + if-else」；
配合 switch 表达式 exhaustive 检查（少一个 case 编译失败）。

### 1.4 文本块

```java
String json = """
    {
      "id": "%s",
      "name": "%s"
    }
    """.formatted(id, name);
```

约束：多行字符串必须用文本块（`"""`）；禁止 `+` 拼接多行字符串。
缩进由闭合 `"""` 的位置决定（自动剥离公共前导空白）。

## 2. 类型系统

### 2.1 Optional 与可空语义

```java
public Optional<User> findById(UUID id) {
    return repo.find(id).map(User::from); // 可能空，用 Optional 表达
}

public String nameOrFallback(UUID id) {
    return findById(id).map(User::name).orElse("anonymous");
}
```

约束：`Optional<T>` 仅用于返回值与字段边界；参数不接受 Optional（用重载或 `@Nullable` 注解 + 检查）。
Optional 链不超 3 层；`Optional.get()` 禁止（用 `orElse` / `orElseThrow`）。
禁止 `Optional` 作为字段类型（序列化与内存开销问题）。

### 2.2 泛型与 PECS

```java
// Producer-Extends, Consumer-Super
public void pushAll(Iterable<? extends T> src) {
    for (T t : src) stack.push(t);
}
public void popAll(Collection<? super T> dst) {
    while (!stack.isEmpty()) dst.add(stack.pop());
}
```

约束：泛型通配符遵循 PECS；禁止 raw type（`List` 而非 `List<String>`）。
`@SuppressWarnings("unchecked")` 必须带注释说明为何类型安全。

### 2.3 模式匹配（17+）

```java
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toLowerCase());
}

// 21+：record 模式
if (shape instanceof Circle(double r)) {
    System.out.println("radius " + r);
}
```

`instanceof` 模式匹配消除强制转换；record 模式（21+）直接解构字段。
禁止用 `instanceof` + 类型标签做分发，用 sealed + switch 代替。

## 3. 并发模型

### 3.1 线程池与虚拟线程

```java
ExecutorService pool = new ThreadPoolExecutor(
    4, 16, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000),
    new ThreadFactoryBuilder().setNameFormat("worker-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()
);

// 21+：虚拟线程用于 IO 密集任务
try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = ids.stream().map(id -> exec.submit(() -> fetch(id))).toList();
    for (var f : futures) results.add(f.get());
}
```

约束：线程池必须显式命名与容量上限（`ThreadPoolExecutor` 参数化）；
禁止 `Executors.newCachedThreadPool()`（无界线程）。
虚拟线程用于 IO 密集任务；挂起期间不能持有 `synchronized`（pinning 风险，用 `ReentrantLock` 替代）。

### 3.2 共享可变状态

```java
private final ConcurrentHashMap<UUID, User> cache = new ConcurrentHashMap<>();
private final LongAdder counter = new LongAdder();

public void increment() {
    counter.increment(); // 高并发计数器，比 AtomicLong 更高效
}
```

约束：共享可变状态优先 `java.util.concurrent`（`ConcurrentHashMap` / `LongAdder`）；
`synchronized` 仅短临界区。
`CompletableFuture` 是组合异步任务的标准模式：

```java
CompletableFuture<User> userF = CompletableFuture.supplyAsync(() -> repo.find(id), pool);
CompletableFuture<Profile> profileF = CompletableFuture.supplyAsync(() -> profile.find(id), pool);
userF.thenCombine(profileF, UserWithProfile::new)
     .orTimeout(5, TimeUnit.SECONDS)
     .exceptionally(ex -> { log.warn("fetch failed", ex); return null; });
```

## 4. Stream API 与集合

### 4.1 Stream 声明式转换

```java
List<String> activeNames = users.stream()
    .filter(User::active)
    .map(User::name)
    .sorted()
    .collect(Collectors.toUnmodifiableList());
```

约束：Stream 用于声明式转换（map / filter / collect）；
有副作用的 `peek` / 循环内短路 `break` 复杂逻辑改回 for 循环。
`Collectors.toUnmodifiableList/Set` 为默认收集；
`Collectors.toList()` 返回可变集合仅在确需可变时使用并注明。

### 4.2 集合工厂

```java
List<User> empty = List.of();
Set<String> single = Set.of("a");
Map<String, Integer> map = Map.of("a", 1, "b", 2);
```

`List.of` / `Set.of` / `Map.of` 返回不可变集合；禁止 `Collections.unmodifiableList(new ArrayList<>())`。
`Stream.toList()`（16+）返回不可变 list；与 `Collectors.toList()` 返回可变 list 注意区分。

## 5. 错误处理与模块系统

### 5.1 异常体系

```java
public class AppException extends RuntimeException {
    private final String code;
    public AppException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }
    public String code() { return code; }
}
```

约束：检查异常仅用于可恢复的业务失败；编程错误用 `RuntimeException` 子类。
异常链必须保留（`new X("msg", cause)`）；禁止 catch 后仅 `e.printStackTrace()`。
全局异常处理器（`@ControllerAdvice`）统一转错误响应；消息禁止泄漏内部路径 / SQL / PII。

### 5.2 try-with-resources

```java
try (var in = Files.newInputStream(path);
     var reader = new BufferedReader(new InputStreamReader(in, UTF_8))) {
    return reader.lines().toList();
}
```

资源（流 / 连接 / 锁）一律 try-with-resources；禁止手动 close 配对（异常路径泄漏）。
实现 `AutoCloseable` 的自定义资源必须保证 `close()` 幂等。

### 5.3 JPMS 模块系统

```java
// module-info.java
module com.cikaros.sdk {
    requires java.net.http;
    requires transitive com.fasterxml.jackson.databind;
    exports com.cikaros.sdk.api;
    opens com.cikaros.sdk.dto to com.fasterxml.jackson.databind;
}
```

约束：多模块项目用 JPMS（`module-info.java`）；`requires transitive` 谨慎使用（传递依赖暴露）。
`opens` 仅用于反射框架（Jackson / Hibernate）；非模块化的传统 jar 走 classpath 兼容。
