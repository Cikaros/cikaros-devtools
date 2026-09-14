# {{project.name}} — specflow 项目级配置

## 需求分析
- [x] 格式化输出
- [x] 验收标准

## 架构设计
- [x] ADR 必需
- [x] 模块拆分图

## 编码实现
- [x] 严格类型
- [ ] 自动提交
- [x] 签名提交
- [x] 提交规范

## 代码评审
- [x] 启用评审
- [x] 安全扫描
- [x] 隐私扫描
- [x] 复杂度阈值: 15

## 测试验证
- [x] 覆盖率门槛
- [x] 行覆盖率: 80
- [x] 分支覆盖率: 70
- [ ] E2E 测试
- [ ] 突变测试

## 隐私过滤
- [x] 输出脱敏

## Shell 适配
- [x] 双轨指令

## 产出物

产出声明（v0.4.0 / B2）：以下 `codex:json` 块会被 session-start 导入 default
agent 的阶段 outputs；`sf.sh workflow advance` 在必需产出缺失时会真实阻塞。
路径相对项目根；required: false 表示建议产出（缺失仅告警不阻塞）。

```codex:json
{
  "req-analysis.outputs": [
    {"path": "docs/requirements/REQUIREMENTS.md", "required": true}
  ],
  "arch-design.outputs": [
    {"path": "docs/design/architecture.md", "required": true}
  ],
  "coding.outputs": [
    {"path": "src/", "required": false}
  ],
  "testing.outputs": [
    {"path": "tests/", "required": false}
  ]
}
```
