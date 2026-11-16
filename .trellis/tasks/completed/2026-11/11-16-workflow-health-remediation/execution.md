# W01 实施记录

已接受合同 revision cf474beb71548503a3920871c3d904021fbe307236fd7eb73158d95367b43262，根用户整体批准同时明确包含本仓实施、发布及两端验收。未新增分支／工作树或真实模型调用。

通用 spawn 路径合入已有 teammate 共同角色，再作为受限补充加载自定义／遗留卡。报告提示明确 answer 字符串、安全 evidence ID 和禁止额外字段；原 validator 不放宽，三类原错误继续拒绝。adapter 在公开 server-info 握手后核版本和身份，支持 SDK0.15.3＋daemon0.15.3/0.15.4；未知版本拒绝。实际本机0.15.4 capability的模型／模式元数据通过，无生成。

GitNexus writer 已定位为原生1.6.12的dist/cli/ai-context.js，generateAIContextFiles维护AGENTS与CLAUDE的gitnexus marker。没有修改外部包或生成块；在本项目两份手工正文增加生成块适用条件，明确授权／可用索引／能力前置及有界源码回退，原生writer保留块外正文。

最初定向18项和adapter5项通过；lint、typecheck、build通过，Python lint为0 errors／72项既有warnings。首轮全量中我错误地并行启动build/test，两项调用dist的测试遇构建清理窗口；build完成后顺序重跑，全量CLI2170通过／2跳过、adapter5通过，Core通过。该结果在以下新增观测改动前成立，新增改动仍须完整检查。

HA28补证：当前Teamwork实际缺少旧owner绑定、历史sessions及workers公开CLI，CCH不能只改命令前缀。按根W01既定“生产接口—消费者—费用／未知”范围，选择性恢复231ea8bf祖先中的原生Core session-relations存储、校验／锁／原子写和历史查询，接到现有create、交互式supervisor与managed runtime；不恢复Channel执行器。新session_bound事实与batch provider元数据来自真实adapter／冻结launch。历史native旧ledger只读接纳，首次新绑定写入当前owner存储，保留旧文件；自定义Teamwork root不读取真实HOME旧库。公开workers投影复用Core的worker及coordination reducer，避免修改容量guard或重复计入batch预留。无owner／provider的旧记录不猜归属、不报零。

CCH资产原生dry-run初次失败，未修改其配置／hash。已证实旧config重复两组原生退役注释，scrubConfig只替换首处，第二次安全断言仍判未退役；共享owner改为替换全部精确注释，并加强既有重复注释回归，保留自定义设置。该修复是HA17项目原生迁移的必要前置。后续继续原生预览和冲突候选，不手改生成块、hash或任务状态。

最终源码门禁通过：Core429通过／1条件跳过，CLI2172通过／2条件跳过，adapter5通过；build、typecheck、lint通过。Python没有改动，先前原生lint为0 errors／72项既有warnings。原生三包版本工具同步0.7.2-beta.20，npm和精确tag查询未占用，check-versions通过。新增生产回归、owner输入校验、managed/interactive同名provider隔离、旧ledger接纳、并发／循环／原子失败和真实CLI均通过。root真实CLI→编译CCH collector组合通过，补正all-projects不应重复global范围的边界。

本仓原生update预览只需更新teammate模板，自定义config保留，执行update --skip-all后同步当前角色及版本／hash。源共同卡明确宿主要求的当前任务／工具断点投影与历史检索授权的区别。未发tag／未发布；docs-site发行日志与packed/CI验收按根W08完成。真实模型预算0/12。
