# 设计

## Owner 与数据流

`packages/cli/src/templates/trellis/workflow.md` 是 bundled workflow 的唯一源。保留已有 Phase 2.2 质量检查入口，只把当前通用指引写得可执行，并让普通 dispatch 与 Codex inline 两个活动 breadcrumb 都显式携带相同闭环要求。`workflowMdTemplate` 的现有模板测试负责锁定两种 breadcrumb 和 2.2 文案，防止某条执行入口遗漏。

Marketplace 不拥有 workflow 逻辑：仅同步 `workflows/native/workflow.md`，更新 `index.json` 中 native 项的 SHA-256，并由其 owner task 记录验收。先提交 Marketplace，再在候选 Trellis 中固定该提交的唯一嵌套 gitlink。

## 行为合同

每个 checkpoint 写入 `execution.md`，包含已完成、未完成、阻塞/范围变化、改动路径、验证及结果、下一动作。质量检查对照完整实际 diff 与已批准的任务产物和 spec；根据复杂度/影响选择测试和复审深度，补足未覆盖行为，必要时增加独立复审；在范围内修复发现并重跑受影响检查。task lifecycle 只经原生命令更新，验收通过前保持 `in_progress`。

低风险局部修改复用现有检查，不强制重复独立审查。状态/持久化/安全/公共接口/跨包或相当影响的修改，需判断是否加深用例与独立复审，并记录判断依据。

## 边界

- 不新建 phase、workflow、task status、Skill、checker checklist 或额外任务状态机。
- 不更改生成副本或平台专属入口；由既有模板物化机制负责下游同步。
- 不改根仓库工作流、集成门禁、生产 gitlink、docs-site 或远端分支。
