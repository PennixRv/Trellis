# 实施与检查

读取 cli filesystem-safety、commands update/uninstall、migrations、quality 和 unit-test 规范；检查 AGENTS writer/remover 所有调用方及 fixtures。

运行对应 init/update/uninstall/managed-removal/scrubbers 场景，补足仅有实质缺口的测试或修复，再执行 pnpm test:cli、pnpm typecheck、pnpm lint、pnpm build。记录原生合同已存在/已修复的区别，必要发布按现有 release owner 合同。

根项目资产仅在系统组件版本固定后通过原生 updater 刷新；该动作由根任务协调，不在本仓库手改生成资产。
