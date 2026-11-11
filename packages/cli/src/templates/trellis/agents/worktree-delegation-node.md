---
name: worktree-delegation-node
description: Shared preparation, execution and recovery method for delegated nodes.
---

# Paseo 委派 Agent 节点方法

这是明确引用的协作资料，不代表目标仓库安装了 Trellis 或新增全局规则。全局及项目 AGENTS 继续由宿主原生加载，不从主控规则复制派生。需求与接受标准以 `contract_ref` 为准，执行同时受当前有效绑定、许可和所引用的能力合同约束。

每次 prepare、execute、followup 和恢复后，重读 `TRELLIS_DELEGATION_CONTEXT` 指向的文件、其 `record_ref`、`contract_ref`、要求的规则及 Skills；核对原生 `PASEO_AGENT_ID`、workspace、实际 Git checkout、branch、base、attempt、binding、模型和 effort。投影与记录不一致时停止受影响动作。主控持有的资料可只读，不修改控制仓库的任务、接受、运行记录或其他包。

准备许可只允许合同明确的准备和候选报告。`role_ref`、`node_method_ref`、`contract_ref` 及可选 `setup_ref` 指向当前 attempt 的冻结快照；只读取这些已验证引用，不改读主控实时文件。`requirements.setup_ref` 有值时，读取投影的 `setup_ref` 快照，只运行其中已批准的原生准备动作。不存在时不能初始化 Trellis、安装依赖、索引或修改共享配置。检查实际 cwd、用户和目录规则、必需 Skill 的准确来源和可读性、工具连接及真实能力。必需 CodeGraph 只能使用本树原生 bound MCP 和本树索引；查询须看到本树 provenance，不能借祖先或兄弟索引。记录观察和缺项，不要求底层权限或上下文窗口默认值的完整回执。

候选目录为本树 `.trellis-delegation/<attempt_id>/`，只允许 `ready.json`、`result.json`、`blocked.json` 三个普通 JSON 文件，每个不超过 256 KiB，不含链接。不要提交这些运行资料，也不要创建其他报告文件。每个候选的公共字段为：

```json
{"version":1,"kind":"ready","attempt_id":"来自投影","binding_revision":"来自投影","base_commit":"来自 binding","head_commit":"本树 git rev-parse HEAD","workspace_id":"来自投影","agent_id":"来自投影","observations":{},"limitations":[]}
```

ready 增加 `missing` 数组；只有实际满足全部必需项时才为空。observations 记录规则/Skills 来源、必需工具的实际探测、Git 和设置摘要；不保存凭据、完整配置或历史。身份映射尚未完整时只报告阻断，等待主控核验后恢复准备。

收到 execute 时，重新读取投影，仅在 `execution_permission=implementation`、当前 attempt/绑定仍有效时完成整个包：按允许路径改源码、运行合同检查、提交源码。不得发起实施子代理或嵌套委派。result 在公共字段之外包含 `changed_paths`、`source_commits`、`checks`、`remaining` 数组，分别记录相对 base 的真实文件、全部真实提交、已运行/未运行及结果、未结事项。准备时的 ready 也保留；result 的 HEAD 必须是当前源码 HEAD。源码之外只保留指定候选报告，不接受自己的成果。

blocked 使用公共字段并在 observations 说明阻断、真实错误、已保全成果和所需 owner 动作；只停止依赖动作。不直接询问用户，不把用户提问工具作为必需能力，不重启前三阶段；范围外选择返回主 Agent。原生权限/问答不替用户答复，不自动批准、不降级模型或工具。返工重新核对当前投影和 owner 指示，不把历史许可当新增授权；父任务离开第四阶段后不得继续实施，需主控恢复有效授权。完成后保全工作树、源码提交和候选，等待 owner 审查、集成及资源处置；不主持第五阶段接受，turn 结束、idle 或 cancel 均不证明后台 writer 已停止。
