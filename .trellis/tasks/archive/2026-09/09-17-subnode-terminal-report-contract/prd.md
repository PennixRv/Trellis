# 修复 Codex 子节点终态与报告协议

## Goal

使 Trellis Channel 的 `subnode` 在正常交付证据后稳定呈现为 `done`，且不会要求受 `workspace-write` 限制的 Codex 节点自行写入工作区外的 Channel 存储。

## Confirmed Facts

- 通用 Channel worker 有意在 adapter `done` 后保持可复用的 `running` / `idle` 状态；`packages/core/src/channel/internal/store/worker-state.ts` 的现有回归测试锁定该行为。
- `subnode` 角色是一次性交付：其角色卡要求写入 `report.json` 后结束 runtime，协调器则要求从 worker projection 读取 `done` 才能处置报告。
- 现有 `subnode` 的普通 `done` 被投影为 `running` / `idle`，五分钟后 idle cleanup 写入 `killed`，与上述角色合同冲突。
- Channel 存储默认位于 `~/.trellis/channels`；Codex `workspace-write` 只允许当前工作区内写入。历史节点执行 `trellis channel send` 因该工作区外锁文件返回 `EROFS`，但 supervisor 已自动将节点最终回复写为 Channel `message` / `done`。
- 同批次中其他节点可以写入工作区内的 `worklog.md` 和 `report.json`，所以现有证据不支持把少数报告缺失归为统一的 Trellis 文件写权限故障。
- `pnpm release` 的已发布版本连续性检查发现 `0.6.36` 缺自身 manifest；已发布 tarball 只包含 `0.6.35.json`，而 release 脚本此前没有强制即将发布版本预先具备 manifest。
- `0.6.37` 两个 npm publish step 均完成，但公共 registry 在原 `6 × 10s` 回读窗口内仍返回 `E404`，本机稍后已核验两个版本可见，说明发布校验存在传播延迟假阴性。

## Requirements

- R1: `--agent subnode` 的普通 adapter `done` 必须在 durable worker projection 中成为终态 `done`；普通 worker 的 `done` 仍只表示一轮完成。
- R2: subnode 在普通 `done` 后必须停止接收后续 inbox 工作并完成 supervisor 清理，不追加把正常完成伪装成失败的 `killed` 终态。
- R3: 已有历史日志中，subnode 在普通 `done` 后的清理型 `killed` 不能覆盖该已完成的语义结果。
- R4: subnode 角色卡与 coordinator 指南必须要求以最终回复交付简短状态和报告路径；不得要求节点运行 `trellis channel send`。
- R5: 修改必须保持 event kind、通用 worker 复用、外部 `channel send` 命令和既有 report/disposition schema 的兼容性。
- R6: 发布脚本必须在任何测试或暂存前计算目标版本并拒绝缺失其 manifest；补偿 `0.6.36` 的无迁移 manifest，并为 `0.6.37` 提供 manifest。
- R7: 公共 npm 可见性校验必须容忍已观测的正常传播延迟，保留有界等待且不将短暂 `E404` 误报为发布失败。

## Acceptance Criteria

- [x] AC1: reducer 测试证明 subnode 的普通 `done` 投影为 `lifecycle: "done"`、`terminal: true`，普通 worker 的等价事件仍为非终态。
- [x] AC2: reducer 测试证明 subnode 已 `done` 后的清理型 `killed` 不改变 `done` 结果；未完成 subnode 仍按真实 `killed` / `crashed` 投影。
- [x] AC3: supervisor stdout 路径在 subnode normal `done` 后调用完成清理回调，且完成清理不写 `killed` 事件。
- [x] AC4: 角色卡和子节点工作流程不再指示 worker 执行 `trellis channel send`，明确最终回复由 supervisor 路由为 Channel 消息。
- [x] AC5: `pnpm --filter @pennixrv/trellis-core test`、`pnpm --filter @pennixrv/trellis test`、`pnpm lint`、`pnpm typecheck` 通过；发布前预检与模板产物检查通过。
- [x] AC6: release regression 覆盖目标 manifest 门；`pnpm release` 通过连续性和目标 manifest 检查后发布 `0.6.37`。
- [x] AC7: 发布回读回归覆盖至少约三分钟的有界 npm 传播窗口；`0.6.38` 的 CI 发布全绿并可在公共 npm 查询到。

## Out Of Scope

- CCH 的渲染、成本或缓存缺陷。
- 修改 Codex 或 OpenViking 的运行时、权限或源码。
- 为独立子节点增加路径级 sandbox、工作树、自动重试或新的 Channel event kind。
