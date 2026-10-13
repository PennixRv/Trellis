# 思考指南（Thinking Guides）

> **目的（Purpose）**：扩展思考，发现可能遗漏的因素。

---

## 为什么需要思考指南（Why Thinking Guides?）

**大多数错误和技术债务来自“没有想到”，而不是能力不足：**

- 没有思考层边界会发生什么 → 出现跨层错误
- 没有注意代码模式重复 → 到处产生重复代码
- 没有考虑边界情况 → 出现运行时错误
- 没有考虑未来维护者 → 代码难以阅读

这些指南帮助你在编码前**提出正确的问题**。

---

## 可用指南（Available Guides）

| 指南（Guide） | 目的（Purpose） | 使用时机（When to Use） |
|-------|---------|-------------|
| [代码复用思考指南（Code Reuse Thinking Guide）](./code-reuse-thinking-guide.md) | 识别模式并减少重复 | 发现重复模式时 |
| [跨层思考指南（Cross-Layer Thinking Guide）](./cross-layer-thinking-guide.md) | 梳理跨层数据流 | 功能跨越多个层时 |

---

## 快速参考：思考触发条件（Quick Reference: Thinking Triggers）

### 何时思考跨层问题（When to Think About Cross-Layer Issues）

- [ ] 功能涉及三个或更多层（API、Service、Component、Database）
- [ ] 数据格式在层之间发生变化
- [ ] 多个消费者需要同一份数据
- [ ] 不确定某段逻辑应放在哪里
- [ ] 正在增加事件类型、JSONL 记录、RPC 载荷或配置字段
- [ ] UI/命令代码开始直接断言原始载荷字段

→ 阅读 [跨层思考指南（Cross-Layer Thinking Guide）](./cross-layer-thinking-guide.md)

### 何时思考代码复用（When to Think About Code Reuse）

- [ ] 正在编写与已有代码相似的代码
- [ ] 看到同一模式重复三次或更多
- [ ] 正在多个位置增加新字段
- [ ] **正在修改任意常量或配置**
- [ ] **正在创建新的工具/辅助函数** ← 先搜索！
- [ ] 两个文件使用本地断言读取同一个无类型载荷字段
- [ ] 多个分支根据 `kind` / `action` 更新同一派生状态

→ 阅读 [代码复用思考指南（Code Reuse Thinking Guide）](./code-reuse-thinking-guide.md)

### 核验 AI 交叉审查结果时（When Verifying AI Cross-Review Results）

- [ ] 审查者声称“用户输入可能恶意” → 检查实际数据来源（内部 manifest？用户配置？外部 API？）
- [ ] 审查者指出“缺少校验” → 数据是否来自可信内部来源？
- [ ] 审查者说“行为发生变化” → 阅读代码注释，确认是否属于有意设计。
- [ ] 审查者在测试中指出“错误” → 在脑中删除被测功能，测试是否仍然通过？如果是 → 这是同义反复测试

**AI 审查者常见的误报模式**：
1. **信任边界混淆**：将内部数据（打包的 JSON manifest）当作不可信外部输入
2. **忽略设计注释**：将代码注释中记录的有意行为标记为错误
3. **误读变量**：不追踪变量的实际定义（例如 Map 以路径而不是名称为键）

**核验规则**：每个 CRITICAL/WARNING 发现都必须对照实际代码核验后再排序。

---

## 修改前规则（Pre-Modification Rule，CRITICAL）

> **修改任何值之前，始终先搜索！**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

这一习惯可以预防大多数“忘记更新 X”的错误。

---

## 如何使用本目录（How to Use This Directory）

1. **编码前**：浏览相关思考指南
2. **编码中**：如果某处感觉重复或复杂，查阅这些指南
3. **出现错误后**：将新经验加入相关指南，从错误中学习

---

## 贡献（Contributing）

发现新的“没有想到”时刻？将它加入相关指南。

---

**核心原则（Core Principle）**：30 分钟的思考可以节省 3 小时的调试时间。
