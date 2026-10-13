# 跨层思考指南（Cross-Layer Thinking Guide）

> **目的（Purpose）**：实现前先梳理跨层数据流。

---

## 问题（The Problem）

**大多数错误发生在层之间的边界，而不是层内部。**

常见的跨层错误：

- API 返回格式 A，而前端期望格式 B
- 数据库存储 X，服务转换为 Y 时丢失数据
- 多个层以不同方式实现同一逻辑

---

## 实现跨层功能前（Before Implementing Cross-Layer Features）

### 第一步：绘制数据流（Step 1: Map the Data Flow）

画出数据如何流动：

```
Source → Transform → Store → Retrieve → Transform → Display
```

对每条箭头回答：

- 数据处于什么格式？
- 可能出现什么问题？
- 谁负责校验？

### 第二步：识别边界（Step 2: Identify Boundaries）

| 边界（Boundary）      | 常见问题（Common Issues）         |
| --------------------- | --------------------------------- |
| API ↔ Service         | 类型不匹配、字段缺失              |
| Service ↔ Database    | 格式转换、空值处理                |
| Backend ↔ Frontend    | 序列化、日期格式                  |
| Component ↔ Component | Props 形状变化                    |

### 第三步：定义合同（Step 3: Define Contracts）

对每个边界：

- 精确的输入格式是什么？
- 精确的输出格式是什么？
- 可能出现哪些错误？

---

## 常见跨层错误（Common Cross-Layer Mistakes）

### 错误一：隐含的格式假设（Mistake 1: Implicit Format Assumptions）

**不佳**：未经核对就假定日期格式。

**较好**：在边界处显式进行格式转换。

### 错误二：分散校验（Mistake 2: Scattered Validation）

**不佳**：在多个层中校验同一内容。

**较好**：在入口处校验一次。

### 错误三：抽象泄漏（Mistake 3: Leaky Abstractions）

**不佳**：组件了解数据库 schema。

**较好**：每个层只了解相邻层。

### 错误四：每个消费者都解析同一载荷（Mistake 4: Every Consumer Parses The Same Payload）

**错误示例（Bad）**：命令读取 JSONL 事件时就地转换字段：

```typescript
const thread = (ev as { thread?: string }).thread;
const labels = (ev as { labels?: string[] }).labels;
```

这看似是局部处理，但意味着每个消费者都拥有一份私有事件合同。下次字段变化时，一个命令可能更新了，另一个命令却遗漏了。

**较好**：在事件边界解码一次，然后导出带类型的投影：

```typescript
if (!isThreadEvent(ev)) return false;
return ev.thread === filter.thread;
```

**规则**：对于只追加日志、JSON 流、RPC 载荷或配置文件，应由一个 owner 负责：

- 事件/载荷类型定义
- 从 `unknown` 开始的类型守卫和规范化
- UI 命令使用的元数据投影
- 根据事实来源重放状态的 reducer

渲染代码可以格式化字段，但不得重新定义载荷合同。

---

## 跨层功能清单（Checklist for Cross-Layer Features）

实现前：

- [ ] 已绘制完整数据流
- [ ] 已识别所有层边界
- [ ] 已定义每个边界的格式
- [ ] 已决定校验发生的位置

实现后：

- [ ] 已使用边界情况测试（null、空值、无效值）
- [ ] 已验证每个边界的错误处理
- [ ] 已确认数据能够完整往返
- [ ] 已确认消费者导入共享解码器/投影，而不是在本地转换载荷字段
- [ ] 已确认派生状态指向源事件标识符（`seq`、`id`、`version`），而不是另造第二个游标

---

## 跨平台模板一致性（Cross-Platform Template Consistency）

在 Trellis 中，命令模板（例如 `record-session.md`）存在于**多个平台**，内容相同或近似。这就是一个跨层边界。

### 清单：修改任意命令模板后（Checklist: After Modifying Any Command Template）

- [ ] 找到包含同一命令的所有平台：`find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] 更新所有平台副本（Markdown `.md` 和 TOML `.toml`）
- [ ] 对 Gemini TOML 适配续行符（`\\` 与 `\`）和三引号字符串
- [ ] 运行 `/trellis:check-cross-layer`，确认没有遗漏

**真实示例**：在 Claude 中将 `record-session.md` 更新为使用 `--mode record`，却遗漏了 iFlow、Kilo、OpenCode 和 Gemini，最终由跨层检查发现。

---

## 生成运行时模板的升级一致性（Generated Runtime Template Upgrade Consistency）

一些生成文件同时是文档和运行时输入。在 Trellis 中，`.trellis/workflow.md` 会被 `get_context.py`、`workflow_phase.py`、SessionStart 过滤器和逐轮 Hook 解析。模板变更必须同时通过全新 init 和升级路径验证。

### 清单：修改运行时解析的模板后（Checklist: After Modifying A Runtime-Parsed Template）

- [ ] 找到读取模板的所有运行时解析器，而不只是安装模板的文件写入器
- [ ] 检查相关语法是否位于明显托管区域（例如标记块）之外
- [ ] 验证全新 `init` 输出，以及写入旧 `.trellis/.version` 的版本化 `update` 场景
- [ ] 使用旧的干净模板 fixture 增加升级回归，并断言安装文件达到当前打包形态
- [ ] 更新负责运行时合同的后端 spec

---

## 版本化文档边界（Versioned Documentation Boundary）

版本化文档是一个跨层边界：源路径、`docs.json` 版本路由和渲染后的版本选择器必须描述同一条发布线。

### 清单：编辑版本化文档前（Checklist: Before Editing Versioned Docs）

- [ ] 确认目标发布线：stable、beta 或 RC
- [ ] 确认编辑的 MDX 路径与发布线匹配：
  - stable：`docs-site/{start,advanced,...}` 和 `docs-site/zh/{start,advanced,...}`
  - beta：`docs-site/beta/**` 和 `docs-site/zh/beta/**`
  - RC：`docs-site/rc/**` 和 `docs-site/zh/rc/**`
- [ ] 确认 `docs.json` 导航将版本标签指向相同路径
- [ ] 提交前在另一棵目录树中 grep 发布线专属术语
- [ ] 将根发布路径下出现 beta 内容视为源路径错误，而不是渲染错误

**真实示例**：一个仅属于 beta 的任务工作流变更，将 `prd.md`、`design.md`、`implement.md`、任务创建确认和 Codex 模式提示写到了根 `start/` 与 `advanced/` 路径。文档站点随后在 Release 选择器下提供了 0.6 beta 行为。修复方式是恢复根发布文档，将 0.6 内容移动到 `beta/` 和 `zh/beta/`，并对根发布目录中的 beta 标记增加 grep 审查。

**真实示例**：Codex inline 模式将工作流平台标记从 `[Codex]` / `[Kilo, Antigravity, Windsurf]` 改为 `[codex-sub-agent]` / `[codex-inline, Kilo, Antigravity, Windsurf]`。全新 init 正确，但 `trellis update` 只合并了 `[workflow-state:*]` 块，保留了这些块之外的旧标记。结果是升级项目获得了新 Hook 脚本，却仍使用旧工作流路由，`get_context.py --mode phase --platform codex` 可能返回空的 Phase 2.1 详情。

---

## 模式检测探针清单（Mode-Detection Probe Checklist）

当 CLI 通过探测远程资源自动检测模式时（例如检查是否存在 `index.json`，以决定使用 marketplace 还是直接下载）：

### 实现前（Before implementing）

- [ ] 探针在使用该结果的**所有**代码路径中运行（交互式、`-y`、`--flag` 组合）
- [ ] 区分 404 与临时错误，不要都当作“未找到”
- [ ] 临时错误必须**中止或重试**，不能静默切换模式
- [ ] 上下文变化时重置共享状态（缓存、预取数据）（例如用户切换来源）
- [ ] **快捷路径**（例如 `--template` 跳过选择器）必须与探测路径具有相同的错误处理质量，检查下游函数是否调用了兜底包装器

### 实现后（After implementing）

- [ ] 跟踪从探针结果到模式决策分支的每条路径，不允许无意落入其他路径
- [ ] 外部格式合同（giget URI、原始 URL）已经测试，或至少以注释记录
- [ ] 元数据读取完整响应，或使用流式解析器，不能把固定大小的前缀当作完整 JSON 解析
- [ ] 从解析部分重建复合标识符时，确认包含**所有**字段且位置**正确**（例如 `provider:repo/path#ref`，而不是 `provider:repo#ref/path`）
- [ ] 确认快捷路径之后调用的**动作函数**没有内部使用旧的兜底获取逻辑；需要区分错误时必须使用具备探测质量的变体

**真实示例**：自定义 registry 流程在三轮审查中发现了 8 个错误：(1) 探针只在交互模式运行；(2) 临时错误落入错误模式；(3) giget URI 中 `#ref` 位置错误；(4) 预取模板泄漏到来源切换之后；(5) `--template` 快捷路径绕过探针，但 `downloadTemplateById` 内部使用兜底的 `fetchTemplateIndex`，将超时变成“模板未找到”。

**真实示例**：Agent session 更新提示使用 `response.read(4096)` 获取 npm `latest` 元数据，然后把它作为完整 JSON 解析。`@pennixrv/trellis` 的包元数据超过 4 KB，JSON 被截断，解析静默失败，第一次会话注入没有显示更新提示。修复方式是解析前读取完整响应，并增加 `version` 后跟随 8 KB 元数据尾部的回归测试。

---

## 跨平台模板一致性（Cross-Platform Template Consistency）

在 Trellis 中，命令模板（例如 `record-session.md`）存在于**多个平台**，内容相同或近似。这就是一个跨层边界。

### 清单：修改任意命令模板后（Checklist: After Modifying Any Command Template）

- [ ] 找到包含同一命令的所有平台：`find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] 更新所有平台副本（Markdown `.md` 和 TOML `.toml`）
- [ ] 对 Gemini TOML 适配续行符（`\\` 与 `\`）和三引号字符串
- [ ] 运行 `/trellis:check-cross-layer`，确认没有遗漏

**真实示例**：在 Claude 中将 `record-session.md` 更新为使用 `--mode record`，却遗漏了 iFlow、Kilo、OpenCode 和 Gemini，最终由跨层检查发现。

---

## 生成运行时模板的升级一致性（Generated Runtime Template Upgrade Consistency）

一些生成文件同时是文档和运行时输入。在 Trellis 中，`.trellis/workflow.md` 会被 `get_context.py`、`workflow_phase.py`、SessionStart 过滤器和逐轮 Hook 解析。模板变更必须同时通过全新 init 和升级路径验证。

### 清单：修改运行时解析的模板后（Checklist: After Modifying A Runtime-Parsed Template）

- [ ] 找到读取模板的所有运行时解析器，而不只是安装模板的文件写入器
- [ ] 检查相关语法是否位于明显托管区域（例如标记块）之外
- [ ] 验证全新 `init` 输出，以及写入旧 `.trellis/.version` 的版本化 `update` 场景
- [ ] 使用旧的干净模板 fixture 增加升级回归，并断言安装文件达到当前打包形态
- [ ] 更新负责运行时合同的后端 spec

**真实示例**：Codex inline 模式将工作流平台标记从 `[Codex]` / `[Kilo, Antigravity, Windsurf]` 改为 `[codex-sub-agent]` / `[codex-inline, Kilo, Antigravity, Windsurf]`。全新 init 正确，但 `trellis update` 只合并了 `[workflow-state:*]` 块，保留了这些块之外的旧标记。结果是升级项目获得了新 Hook 脚本，却仍使用旧工作流路由，`get_context.py --mode phase --platform codex` 可能返回空的 Phase 2.1 详情。

---

## 模式检测探针清单（Mode-Detection Probe Checklist）

当 CLI 通过探测远程资源自动检测模式时（例如检查是否存在 `index.json`，以决定使用 marketplace 还是直接下载）：

### 实现前（Before implementing）
- [ ] 探测覆盖使用其结果的**所有**代码路径（交互式、`-y`、`--flag` 组合）
- [ ] 区分 404 与临时错误，不把两者都当成“未找到”
- [ ] 临时错误会**中止或重试**，不会静默切换模式
- [ ] 上下文变化时（如用户切换来源），共享状态（缓存、预取数据）会**重置**
- [ ] **快捷路径**（如 `--template` 跳过选择器）具有与探测路径相同的错误处理质量；检查下游函数没有调用笼统捕获错误的包装器

### 实现后（After implementing）
- [ ] 跟踪从探测结果到模式决策分支的每条路径，不发生意外贯穿
- [ ] 外部格式合同（giget URI、原始 URL）经过测试，或至少有注释说明
- [ ] 元数据读取完整响应或使用流式解析器，不把固定长度前缀当成完整 JSON
- [ ] 从解析结果重建复合标识时，核对**全部**字段均包含且处于**正确位置**（如 `provider:repo/path#ref`，而非 `provider:repo#ref/path`）
- [ ] 核对快捷路径后的**动作函数**没有在内部使用旧的笼统捕获错误的获取逻辑；需要区分错误时，必须使用与探测同等质量的版本

**真实示例**：自定义 registry 流程在三轮审查中发现了 8 个错误：(1) 探针只在交互模式运行；(2) 临时错误落入错误模式；(3) giget URI 中 `#ref` 位置错误；(4) 预取模板泄漏到来源切换之后；(5) `--template` 快捷路径绕过探针，但 `downloadTemplateById` 内部使用兜底的 `fetchTemplateIndex`，将超时变成“模板未找到”。

**真实示例**：Agent session 更新提示使用 `response.read(4096)` 获取 npm `latest` 元数据，然后把它作为完整 JSON 解析。`@pennixrv/trellis` 的包元数据超过 4 KB，JSON 被截断，解析静默失败，第一次会话注入没有显示更新提示。修复方式是解析前读取完整响应，并增加 `version` 后跟随 8 KB 元数据尾部的回归测试。

---

## 何时创建流程文档（When to Create Flow Documentation）

在以下情况创建详细流程文档：

- 功能跨越三个或更多层
- 涉及多个团队
- 数据格式复杂
- 该功能过去曾经引发错误

---

## 事件日志/投影边界（Event Log / Projection Boundary）

只追加日志是跨层合同。单个事件会经过：

```
CLI input → event writer → events.jsonl → reader → filter → reducer → display
```

### 清单：增加新的事件类型或字段后（Checklist: After Adding A New Event Kind Or Field）

- [ ] 将事件类型加入中央事件分类
- [ ] 在事件层增加带类型的事件变体或类型守卫
- [ ] 为来自用户输入或 JSON 的数组/对象字段增加规范化辅助函数
- [ ] 只在事件写入器中分配 `seq` / `id`
- [ ] 让过滤器和 reducer 使用带类型的事件守卫，而不是本地断言
- [ ] 让展示代码使用 reducer 输出或带类型事件，而不是原始 JSON
- [ ] 至少增加一项回归测试，证明历史重放和实时过滤使用相同的过滤模型

**真实示例**：Thread channel 增加了 `kind: "thread"`、`description`、`context`、labels 和 `lastSeq`。首版实现能够正确重放 thread 状态，但多个命令仍使用本地断言重新解析事件载荷字段。修复方式是让核心事件层负责 `ThreadChannelEvent` 和 `isThreadEvent`，让 `reduceChannelMetadata` 成为唯一的 channel 元数据投影，让 `reduceThreads` 成为唯一的 thread 重放 reducer。
