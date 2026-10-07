# Owner验证与交付

根任务issue-ledger的T1–T8为输入；原事前planning/seal/approve/start存在。本owner源码修复归9d184633/cdc8367f/d84d80ab/3703c14c。β36/37失败保留，β38发布成功；逐条关闭回查补齐T7/T8后最终β39。禁止把中间已发版当作全部条目关闭。

- 最终3703c14c commit hook全量测试：core411 passed/1既存skip、CLI2260 passed/2既存skip；lint/typecheck/build通过。
- isolated negative/positive：custom rename source保留、歧义marker不删；archive ownership首写前拒绝；seal bytes变更拒绝旧授权；subnode scope/evidence/concern/init排他；Channel guard/idle/orphan身份/terminal/interrupt/not-ready/strict send；Codex resume明确unsupported。
- T7 synthetic credential：protocol重放不改正文，core诊断及messages raw/formatted视图屏蔽已知模式，worker raw logs不保留；private log/config0600；ticket不保存command/host_cwd；artifact拒绝Bearer及显式赋值。未知任意秘密不承诺识别。
- T8 isolated bare remote：unpublished submodule拒绝且无tag，published ancestor接受；release入口在build/版本/tag前执行，所有recursive子模块适用。
- docs5ffc86a、Marketplace179fe74已先推送；正式发布经native pnpm release:beta与官方GitHub CI。最终registry、安装、七消费者和cleanup回执在根verification，不复制运行日志或用户状态到本任务。
