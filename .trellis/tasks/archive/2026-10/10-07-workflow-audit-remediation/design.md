# Owner设计

唯一writer=Trellis，branch=pennix/v0.7-beta。范围：T1–T8：update/uninstall安全、计划内容绑定与ownership、SessionStart/Skills、Channel容量/终态/send/inbox、安全诊断/环境、report验证、局部隔离FIFO/等待/重试、paired发布。

目标files为packages/cli的update/uninstall/managed-paths、task_store/task_planning/subnode_artifact模板、shared SessionStart与Skills、commands/channel/**、packages/core/channel/**、现有tests/release.js及Marketplace/docs子模块。采用根D1–D5：数据保护fail-closed；seal内容冻结进度另记；局部交付错误隔离并继续正常accepted credit FIFO；fresh immutable retry读旧证据仅导航；protocol正文与安全diagnostic分离、worker最小环境不落秘密值；终态/send/guard与进程真实对应，Codex不支持resume明确拒绝。

共同根因补证后确认，同组仍逐条验收。主会话唯一writer/checker。不双写独立Trellis checkout，不加scheduler/第二waiter/report-revision协议。本owner基础提交为860ad8b4，失败只回退本次scoped修改，用户落点按native owner旧版本恢复，保留历史与无关内容。

