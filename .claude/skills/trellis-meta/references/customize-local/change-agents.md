# 调整项目协作角色

主会话负责需求、决策、授权、集成和结果接受。协作只有两类，各自由原生 owner 管理：

| 机制与实例 | 适用工作 | 项目资产与入口 |
| --- | --- | --- |
| trellis teamwork / trellis teammates | 明确工作包的只读研究、审查与验证 | `.trellis/agents/teammate.md`、`teammate-profiles.json`、`profiles/`；使用 `trellis-teamwork` |
| paseo-based-parallelism / paseo delegated-agent | 已授权实施阶段的完整实施结果包 | `.trellis/agents/delegated-worktree-primary-agent.md`、`worktree-delegation-node.md`；使用 `trellis-worktree-delegation` |

修改前读取当前任务合同、目标角色文件和对应 Skill 的原生说明。角色卡描述职责、输入、写入边界和报告格式；任务状态、接受与授权仍由 Task CLI 管理。节点收到明确工作包后执行，遇到缺失输入或权限冲突向主会话报告，由主会话处理用户决策。

工程规范写入 `.trellis/spec/`；可复用方法写入 Skills。可选 JSONL 只是上下文清单，存在清单不授权协作。禁止通过宿主角色文件、裸 CLI 进程或历史启动记录另建派发路线。

Kiro 的 `.kiro/agents/trellis.json` 是主会话入口；普通 `trellis-check` 是检查方法 Skill。两者都不承担旧角色分发。修改安装资产必须沿所属组件的原生更新入口；只修改源模板不会更新既有项目。
