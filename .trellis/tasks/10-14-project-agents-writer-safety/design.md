# 设计

保留当前模板、managed-paths/removal/scrubbers 以及命令所有权。语义兼容性在模板/治理变更时审查，writer 负责确定性路径、marker、symlink 和块外保留，不增加用户规则 hash 绑定。

先核验现有测试覆盖和隔离共存 fixture；发现缺口时修改共同 owner 与真实调用方。Codex 完整生效链由 pennix-skills 只读治理 helper 补齐，Trellis 不另造全局治理协议。
