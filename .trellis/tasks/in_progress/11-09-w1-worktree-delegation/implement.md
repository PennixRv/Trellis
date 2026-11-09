# W1 实施合同

来源与授权：父任务 `implementation-resumption.md`、`implement.md` 及本次明确派发；不重新构造用户答案。当前需求沿父任务已接受合同，仅将 Trellis W1 投影到源码 owner。

## 实施范围

修改 task.py 控制面及共享 runtime resolver、可选 packages/paseo-adapter、固定角色与一个协作 Skill、节点 Hook 路由、构建/版本/打包/CI。兼容旧记录、containment、ownership、continuity、move、complete/cancel。基准检查使用当前检出，不改其他组件或父记录。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 跨仓、有无 Trellis、两步准入、身份和未知结果安全 | W1 控制面 | Trellis | 隔离 Git/fake adapter fixture | 测试及未提交源码 | 重复 writer、错树、旧候选接受 |
| 固定角色与动态上下文、SDK 公共入口、原生默认 | W1 adapter/资产 | Trellis | adapter fixture、模板检查 | 测试及协议/打包结果 | 私有导入、凭据输出、动态角色 |
| 兼容与发布链完整 | W1 集成 | Trellis | lint/typecheck/tests/pack | execution.md | 必需检查未通过或运行态入 Git |

## 限制与交付

W5 接口固定为 `serve --mcp --bound-worktree PATH`；本树只实现前置核验和 per-agent 配置。真实 daemon 节点、发布、安装与根组合验收由主控执行；组件完成不能替代其接受。
