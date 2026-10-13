# 实施设计

## 责任边界

本子任务只修改 `/home/penn/devel/Trellis` 源仓库及其测试。根协调仓库负责跨仓库发布、lifecycle pin、安装和集成验收；Pennix Skills 子任务负责用户规则与工具路由模板。项目生成资产和第三方 Marketplace workflow 不在本仓库直接修改。

## 内容与合同

- 纳入 workflow、默认 PRD、workspace/index、个人 index/journal，以及 backend 6、frontend 7、guides 4 共 17 个 spec 源模板。
- 面向人正文默认简体中文，标题中文优先并保留括号中的英文结构锚点；文件名、字段、状态、命令、路径、代码、机器标记、托管块和稳定锚点保持。
- workflow parser 与所有实际消费者兼容旧纯英文标题和新中文优先双语标题；journal 兼容旧英文和新格式，不增加翻译迁移器。
- `trellis update` 继续使用原生 hash/conflict/protected paths；Marketplace workflow 保持第三方所有权。

## 验证

新增或扩展 task-create、workflow、journal、init/update 和模板快照/内容回归；运行 CLI test、build、lint、typecheck 及适用的图检查。文案检查属于根协调计划中的 Pennix Skills 任务，不由 Trellis 自己引入英语语法门禁。
