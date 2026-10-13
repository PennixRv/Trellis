# 工作区索引（Workspace Index）

> 记录所有开发者的 AI Agent 工作记录。

---

## 概览（Overview）

本目录跟踪本项目所有使用 AI Agent 的开发者记录。

### 文件结构（File Structure）

```
workspace/
|-- index.md              # This file - main index
+-- {developer}/          # Per-developer directory
    |-- index.md          # Personal index with session history
    |-- tasks/         # Task files
    |   |-- *.json        # Active tasks
    |   +-- archive/      # Archived tasks by month
    +-- journal-N.md     # Journal files (sequential: 1, 2, 3...)
```

---

## 活跃开发者（Active Developers）

| 开发者（Developer） | 最近活动（Last Active） | 会话（Sessions） | 活动文件（Active File） |
|-----------|-------------|----------|-------------|
| （暂无） | - | - | - |

---

## 开始使用（Getting Started）

### 新开发者（For New Developers）

运行初始化脚本：

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

此命令将：
1. 创建身份文件（由 git 忽略）
2. 创建进度目录
3. 创建个人索引
4. 创建初始日志文件

### 已有开发者（For Returning Developers）

1. 获取开发者名称：
   ```bash
   python3 ./.trellis/scripts/get_developer.py
   ```

2. 阅读个人索引：
   ```bash
   cat .trellis/workspace/$(python3 ./.trellis/scripts/get_developer.py)/index.md
   ```

---

## 指南（Guidelines）

### 日志文件规则（Journal File Rules）

- 每个日志文件最多 **2000 行**
- 达到上限后创建 `journal-{N+1}.md`
- 创建新文件时更新个人 `index.md`

### 会话记录格式（Session Record Format）

每个会话应包含：
- 摘要（Summary）：一行描述
- 分支（Branch）：工作的分支
- 主要变更（Main Changes）：修改内容
- Git 提交（Git Commits）：提交哈希和消息
- 下一步（Next Steps）：后续工作

---

## 会话模板（Session Template）

记录会话时使用以下模板：

```markdown
## 会话（Session） {N}：{Title}

**日期（Date）**: YYYY-MM-DD
**任务（Task）**: {task-name}
**分支（Branch）**: `{branch-name}`

### 摘要（Summary）

{One-line summary}

### 主要变更（Main Changes）

- {Change 1}
- {Change 2}

### Git 提交（Git Commits）

| Hash | Message |
|------|---------|
| `abc1234` | {commit message} |

### 测试（Testing）

- [OK] {Test result}

### 状态（Status）

[OK] **Completed** / # **In Progress** / [P] **Blocked**

### 下一步（Next Steps）

- {Next step 1}
- {Next step 2}
```

---

**语言（Language）**：所有文档默认使用**简体中文**。
