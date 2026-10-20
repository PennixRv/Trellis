# 实施与验证

用户已明确批准完整方案并持续推进至既定停止点；本任务经原生 seal、approve revision 1 和 start，处于实施中。封口文档保持原字节，维护分支为 pennix/v0.7-beta。

F-007/F-011 新增 22 项回归，旧源码 20 项失败、2 项普通改名通过；修复后 ownership 与 archive 36 项通过。正式记录按规范 JSON 任务 ID 查询，不再依赖日期目录名；任何正式 ownership 记录均阻止 rename，拒绝前后的任务、引用、指针与记录字节不变。

完整测试初轮发现普通任务的旧夹具与受支持 symlink workflow 目录被额外要求 ownership 快照。已将正式存储不存在时的普通行为保留；存储存在或路径不安全时仍执行严格校验及错误转换。没有为普通任务增加新的身份要求。再次完整运行 core 432 项通过、1 项既有跳过，CLI 2303 项通过、2 项既有跳过；lint、typecheck 和 build 通过。

额外 `lint:py` 报 4 个未修改 session-start Hook 的 common.io 导入错误、68 个警告。将原 HEAD 通过 git archive 解至隔离临时目录后运行相同检查，错误位置与数量完全相同；本次差异没有新增 Python 静态错误。该既有问题未纳入本任务。GitNexus runner 与索引缺失，图检查 not_run，未安装或重建。

源码 Python 双树保持一致。正式发行、受管安装、三个项目物化、现场回执和根集成验收仍在根任务推进，未据源码通过声明整体完成。

正式发行提交 2fff60e5、tag v0.7.0-beta.52，Publish to npm CI 39439528268 成功；CLI/core 正式包、精确依赖和目标脚本内容已核验。本机经 pennix update trellis-cli 安装 beta.52，根/Trellis/CCH 三项目均已使用原生 update --create-new 物化。各项目两个目标脚本与模板字节及原生 hash 相同；真实物化脚本的隔离日期任务围栏、拒绝 rename 和写前后快照检查通过。三个 workflow --verify 通过；根 Marketplace 固定来源和两处 Marketplace 工作树/gitlink 保持。当前仅提交本仓库原生 version/hash/provenance 记账和本记录，不提前关闭任务；根的 CCH 安装被新增 Lifecycle 候选校验缺陷阻断，正在进行增量规划。
