# 保留 Git 工作流来源并完成原生复核

## Goal

修复根协调任务最终组合验收发现的来源丢失：SSH 或自托管 Git 来源写入 provenance 后不能变成丢失协议、host、port 或目录的公共 provider 别名。原生 workflow 物化后必须可以用同一不可变来源重新 verify，不依赖 push。

## Scope

仅修改 workflow resolver 的来源保存、Git URL 在 commit ref 前的可选 `.git` 后缀处理、相关回归测试及来源合同。保持 provenance schema、任务状态机、安装和发布接口不变。原已归档的状态机任务保持终态，根协调任务保持既有 `in_progress / plan_closed`。

## Verification

- 使用隔离 Git fixture 验证公共 SSH、自托管 SSH（含 port 和子目录）、自托管 HTTPS 的原生物化和 verify 往返，禁止依赖公网 HTTP 回退；覆盖 `.git#<commit>` 输入。
- 不将 HTTPS 内嵌凭据持久化；继续使用本机 Git 凭据机制。
- 定向测试、typecheck、lint、build 和提交钩子要求的完整测试通过；根真实工作流按 Marketplace 确定提交物化且原生 verify 通过。
- 本地提交并原生归档本修复任务，再由根固定新的 Trellis gitlink；不安装、push、发布或合并。

## Rollback

修改前源提交为 `32a04e39`，归档记录由其后的原生归档提交保存。修复失败时保留根协调任务，不伪造 provenance 或宣称组合验收通过。
