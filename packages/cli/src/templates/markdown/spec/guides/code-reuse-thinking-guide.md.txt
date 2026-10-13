# 代码复用思考指南（Code Reuse Thinking Guide）

> **目的（Purpose）**：创建新代码前先停下来思考：它是否已经存在？

---

## 问题（The Problem）

**重复代码是不一致错误的首要来源。**

复制粘贴或重写已有逻辑会导致：
- 错误修复无法传播
- 行为随时间逐渐分化
- 代码库更难理解

---

## 编写新代码前（Before Writing New Code）

### 第一步：先搜索（Step 1: Search First）

```bash
# Search for similar function names
grep -r "functionName" .

# Search for similar logic
grep -r "keyword" .
```

### 第二步：回答这些问题（Step 2: Ask These Questions）

| 问题（Question） | 如果是……（If Yes...） |
|----------|-----------|
| 是否存在相似函数？ | 使用或扩展它 |
| 其他地方是否使用了这种模式？ | 遵循已有模式 |
| 它是否可以成为共享工具？ | 在正确位置创建它 |
| 是否正在复制其他文件中的代码？ | **停止**：提取为共享逻辑 |

---

## 常见重复模式（Common Duplication Patterns）

### 模式一：复制粘贴函数（Pattern 1: Copy-Paste Functions）

**不佳**：将校验函数复制到另一个文件。

**较好**：提取为共享工具，在需要的位置导入。

### 模式二：相似组件（Pattern 2: Similar Components）

**不佳**：创建一个与现有组件有 80% 相似度的新组件。

**较好**：通过 props/变体扩展现有组件。

### 模式三：重复常量（Pattern 3: Repeated Constants）

**不佳**：在多个文件中定义同一个常量。

**较好**：保留唯一事实来源，在各处导入。

### 模式四：重复提取载荷字段（Pattern 4: Repeated Payload Field Extraction）

**错误示例（Bad）**：多个消费者各自在本地转换同一组 JSON/事件字段：

```typescript
const description = (ev as { description?: string }).description;
const context = (ev as { context?: ContextEntry[] }).context;
```

即使只有两行代码，这也是重复的合同逻辑。此时每个消费者都有一份自己对“有效载荷”的定义。

**较好**：将解码器、类型守卫或投影放在数据 owner 旁边：

```typescript
if (isThreadEvent(ev)) {
  renderThreadEvent(ev);
}
```

**规则**：如果同一个无类型载荷字段在两个或更多位置被读取，在增加第三个读取者前创建共享类型守卫、规范化器或投影。

---

## 何时抽象（When to Abstract）

**在以下情况进行抽象**：
- 相同代码出现三次或更多
- 逻辑复杂到足以产生错误
- 多个人可能需要使用它

**在以下情况不要抽象**：
- 只使用一次
- 只是简单的一行代码
- 抽象后的复杂度高于重复代码

---

## 批量修改后（After Batch Modifications）

对多个文件进行相似修改后：

1. **复核**：是否覆盖了所有实例？
2. **搜索**：运行 grep 查找遗漏
3. **考虑**：是否应该进行抽象？

### Reducer 应使用穷举结构（Reducers Should Use Exhaustive Structure）

当状态由类似 action 的值（`action`、`kind`、`status`、`phase`）派生时，优先使用一个 `switch` 的 reducer，而不是分散的 `if/else` 更新。

```typescript
// BAD - action-specific state transitions are hard to audit
if (action === "opened") { ... }
else if (action === "comment") { ... }
else if (action === "status") { ... }

// GOOD - one reducer owns the transition table
switch (event.action) {
  case "opened":
    ...
    return;
  case "comment":
    ...
    return;
}
```

当事件日志是事实来源时，这一点尤其重要。Reducer 是有文档记录的重放模型；展示代码和命令不应重复该重放模型的局部逻辑。

---

## 提交前清单（Checklist Before Commit）

- [ ] 已搜索现有相似代码
- [ ] 没有应当共享却被复制粘贴的逻辑
- [ ] 共享解码器之外没有重复提取无类型载荷字段
- [ ] 常量只在一个位置定义
- [ ] 相似模式遵循相同结构
- [ ] Reducer/action 转换集中在一个 reducer 或命令分发器中

---

## 注意：Python 的 if/elif/else 穷举检查（Gotcha: Python if/elif/else Exhaustive Check）

**问题**：Python 的 if/elif/else 链没有编译期穷举检查。向 `Literal` 类型（例如 `Platform`）增加新值时，已有 if/elif/else 链可能静默落入 `else`，使用错误的默认值。

**表现**：新平台只能部分工作，一些方法返回 Claude 默认值而不是平台专属值，并且不会抛出错误。

**示例**（`cli_adapter.py`）：
```python
# BAD: "gemini" falls through to else, returns "claude"
@property
def cli_name(self) -> str:
    if self.platform == "opencode":
        return "opencode"
    else:
        return "claude"  # gemini silently gets "claude"!

# GOOD: explicit branch for every platform
@property
def cli_name(self) -> str:
    if self.platform == "opencode":
        return "opencode"
    elif self.platform == "gemini":
        return "gemini"
    else:
        return "claude"
```

**预防**：向 Python `Literal` 类型增加新值时，搜索所有基于该类型分支的 if/elif/else 链，并增加显式分支。不要假定 `else` 对新值仍然正确。

---

## 注意：产生相同输出的非对称机制（Gotcha: Asymmetric Mechanisms Producing Same Output）

**问题**：当两个不同机制必须产生相同文件集合时（例如 init 的递归目录复制与 update 的手动 `files.set()`），结构变化（重命名、移动、增加子目录）只会通过自动机制传播，手动机制会静默漂移。

**表现**：init 完全正常，但 update 将文件创建到错误路径，或完全遗漏文件。

**预防**：
- **最佳做法**：消除非对称性，让手动路径调用自动路径（例如让 `collectTemplateFiles()` 调用 `getAllScripts()`，而不是维护自己的列表）。
- **如果无法避免非对称性**：增加回归测试，比较两种机制的输出。
- 迁移目录结构时，搜索所有引用旧结构的代码路径。

**真实示例**：`trellis update` 曾为 11 个脚本维护手动 `files.set()` 列表，而 `getAllScripts()` 已经跟踪这些脚本。修复方式是用 `for..of getAllScripts()` 循环替换手动列表。参见 v0.4.0-beta.3 的 `update.ts` 重构。

---

## 模板文件登记（Trellis-specific）

向 `src/templates/trellis/scripts/` 增加文件时：

**唯一登记点**：`src/templates/trellis/index.ts`

1. 增加 `export const xxxScript = readTemplate("scripts/path/file.py");`
2. 加入 `getAllScripts()` Map。

完成这两步即可。`commands/update.ts` 直接使用 `getAllScripts()`，不需要手动同步列表。

**原因**：如果没有在 `getAllScripts()` 中登记，`trellis update` 就不会把文件同步到用户项目，错误修复和新功能也无法传播。

**历史**：在 v0.4.0-beta.3 之前，`update.ts` 有一份自己维护的文件列表，经常与 `getAllScripts()` 不同步，导致 `trellis update` 静默跳过 11 个 Python 文件。修复方式是删除重复列表，并将 `getAllScripts()` 作为唯一事实来源。

### 新增脚本快速清单（Quick Checklist for New Scripts）

```bash
# After adding a new .py file, verify it's in getAllScripts():
grep -l "newFileName" src/templates/trellis/index.ts  # Should match
```

### 模板同步约定（Template Sync Convention）

`.trellis/scripts/`（自用代码）与 `packages/cli/src/templates/trellis/scripts/`（模板）必须保持一致。编辑 `.trellis/scripts/` 后始终同步：

```bash
rsync -av --delete --exclude='__pycache__' .trellis/scripts/ packages/cli/src/templates/trellis/scripts/
```

**注意**：使用错误的 rsync 源路径或目标路径可能创建嵌套的垃圾目录（例如 `.trellis/scripts/packages/cli/...`）。运行前始终复核路径。
