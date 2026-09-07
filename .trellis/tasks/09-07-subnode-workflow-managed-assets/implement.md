# 实施计划

1. 读取当前 CLI template、managed-file registry、agent loader、bundled skill generator、现有 Python scripts、
   template/update tests 与 Channel docs；对准备改动的符号运行 GitNexus impact，先记录其调用面。
2. 实现最小的 `subnode.md`、`subnode_artifact.py` 和 `workspace_note.py`，将它们注册到现有 init/update 管理路径，
   不改 runtime lifecycle。
   同时恢复 Codex inline default，并将 task manifest、phase renderer 和 hook breadcrumb 三个行为入口保持一致；
   `auto` / `sub-agent` 仍是原生 sub-agent 的显式 opt-in。
3. 添加无网络 Python unit/CLI 测试；用临时 project 验证 init/update、template hashes 和冲突 sidecar。workspace
   note 测试验证它不调用 Git 或改变 HEAD、task、journal、index，而不把其自身的预期文件写入误判为 Git status 污染。
4. 泛化 bundled `trellis-channel`，删除项目/Skill 专属旧协议，增加 `subnode-work.md`，以现有 documents/tests 验证
   不影响普通 Channel 操作。
5. 运行 formatter、typecheck、Python lint、目标 unit/integration tests、完整 test 和 `detect_changes`；若指向
   Channel runtime 行为变化，停止并重新界定 scope。
6. 在 Pennix marketplace workflow 提交与 submodule pin 可验证后更新 Gitlink，执行 release preflight、更新 patch
   version/release metadata、提交、推送、tag/release 并核验 npm package。
7. 记录 release version、fork commit、marketplace pin 与未覆盖的 host 验收项；不在本 task 安装用户级资产。
