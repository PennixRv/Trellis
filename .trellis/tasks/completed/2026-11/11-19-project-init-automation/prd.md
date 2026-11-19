# 接入完整新项目自动初始化

## Goal

承接根任务 project-init-trust-automation 已批准P3，完成Lifecycle策略查询、Trellis首次及重入共同收尾、CodeGraph委托和原生Codex精确信任及回读，正式发行。

## Requirements

- 承接根任务 project-init-trust-automation 已接受的 P3。用户已明确要求“现在开始推进到停止点吧”，根路线 revision 2 已记录完整实现、发行和两机部署授权；不重复索取相同批准。
- 一次 Lifecycle 策略，显式 opt-in／opt-out 优先，独立 Trellis 默认保留；首次和已有平台重入通过共同收尾委托 CodeGraph 原生接入及索引，调用 Codex 原生精确信任及回读。
- 已核验模板与实际资产，保留拒绝、未知配置和修改脚本；不计算批准指纹，不绕过信任。CodeGraph 项目边界、索引和运行态归其 owner。
- 仅 WSL 内部项目，真实 home-network 只读。组件沿 v0.7.1 正式发行，根任务完成设备部署、联合验收和归档。

## Acceptance Criteria

- [ ] 首次／重入及策略覆盖一致，默认旧行为不变；失败有非零退出及最小重入指引。
- [ ] 原生信任与 currentHash 精确回读，未知／修改／拒绝不被覆盖；隔离 canary 不执行。
- [ ] CodeGraph 接入、健康索引、MCP 待新会话加载分别报告；bootstrap 任务保留。
- [ ] 原生类型、lint、Python lint、构建和适用测试通过；正式来源可核验。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 首次与重入完整编排 | P3 | Trellis | 实际 init 组合 fixture | execution.md | 默认副作用或漏共同路径 |
| 精确信任和不误执行 | P3 | Trellis、Codex | 原生 RPC 和拒绝／修改 fixture | 测试结果 | 越权、未知内容或假成功 |
| 原生验证与发行 | P3 | Trellis | lint／typecheck／build／test／release | CI 和载荷 | 身份不一致 |

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
