# 实施与验证

用户已明确批准完整方案并持续推进至既定停止点；本任务经原生 seal、approve revision 1 和 start，处于实施中。封口文档保持原字节，维护分支为 pennix/v0.7-beta。

F-007/F-011 新增 22 项回归，旧源码 20 项失败、2 项普通改名通过；修复后 ownership 与 archive 36 项通过。正式记录按规范 JSON 任务 ID 查询，不再依赖日期目录名；任何正式 ownership 记录均阻止 rename，拒绝前后的任务、引用、指针与记录字节不变。

完整测试初轮发现普通任务的旧夹具与受支持 symlink workflow 目录被额外要求 ownership 快照。已将正式存储不存在时的普通行为保留；存储存在或路径不安全时仍执行严格校验及错误转换。没有为普通任务增加新的身份要求。再次完整运行 core 432 项通过、1 项既有跳过，CLI 2303 项通过、2 项既有跳过；lint、typecheck 和 build 通过。

额外 `lint:py` 报 4 个未修改 session-start Hook 的 common.io 导入错误、68 个警告。将原 HEAD 通过 git archive 解至隔离临时目录后运行相同检查，错误位置与数量完全相同；本次差异没有新增 Python 静态错误。该既有问题未纳入本任务。GitNexus runner 与索引缺失，图检查 not_run，未安装或重建。

源码 Python 双树保持一致。正式发行、受管安装、三个项目物化、现场回执和根集成验收仍在根任务推进，未据源码通过声明整体完成。
