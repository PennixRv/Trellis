# 落实工作流资源回收修订包

## 目标（Goal）

执行根任务 10-13-workflow-resource-retention-optimization revision 2 已批准的 Trellis R1 R2 R5 R8 范围，补齐回执与事务保护并验收发布

## 需求（Requirements）

- 继承根任务 revision 2 已批准的 R1、R2、R5、R8；保留已发布 beta48 修复，不扩大清理范围。
- 补齐 backup preview/execute 的候选、失败、保留和释放量回执；更新写入阶段与 prune 共用排他锁，未知备份整批闭锁。
- 修改仅涉及 CLI backup/update 及调用者、回归测试和合同说明，不清理用户真实资源。

## 验收标准（Acceptance Criteria）

- [ ] dry-run 不删除，实际删除量仅统计成功对象；部分失败可核验且锁必释放。
- [ ] keep 不低于 3，更新事务和 prune 相互排斥，未知状态保留。
- [ ] 定向测试、类型检查、构建和规定质量门执行；发布、安装和根侧记录一致。

## 备注（Notes）

- 授权来源：根任务当前 revision 2 的用户明确批准。本子任务是原范围执行落点，不新增用户选择。
- 早期 beta48 实施未及时建立组件任务；本记录补齐落点，不冒充当时已有任务。
- 回滚：恢复 beta48 CLI；保留备份，不以回滚触发删除。追加修复需新 beta 发布和原生 lifecycle 安装。
