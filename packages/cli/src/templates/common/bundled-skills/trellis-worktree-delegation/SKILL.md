---
name: trellis-worktree-delegation
description: 在 Trellis 已授权实施阶段，把完整结果包交由同机 Paseo 独立工作树执行，管理绑定、准备、返工、恢复及 owner 集成；不用于 Teamwork 只读审查或普通研究。
---

# Paseo 并行协作（Paseo-based-parallelism）

执行者称为 Paseo 委派 Agent（Paseo delegated-agent；复数 Paseo delegated-agents）。Trellis 团队协作（Trellis Teamwork）的执行者称为 Trellis 团队成员（Trellis teammate；复数 Trellis teammates）。两类机制、执行者和运行对象分别命名；本 Skill 的原生命名与 `task.py delegate-*` 命令保持不变。

先读取 [操作合同](workflow.md)。此入口只编排已批准的完整工作包；任务阶段、授权和接受由主控 Trellis 维护，workspace、agent 和 provider thread 由 Paseo 维护。Teamwork 用于有界只读研究或审查，不获得源码实施权。

主控按依赖与包大小选择可同时推进的结果包；不为每个普通实现步骤另建委派。目标可为独立仓库、submodule 或 linked worktree，可没有 Trellis。不要复制全局 AGENTS、安装目录或主控整个上下文。必要方法通过明确只读引用提供；没有目标项目资产不构成自动初始化许可。

原生 `task.py delegate-*` 负责校验绑定与当前父授权；可选 `trellis-paseo-adapter` 只通过公开 SDK 操作同机 daemon。缺包、版本、身份或必需能力不符时停止相应动作，沿 Lifecycle 修复；不调用旧 start、不换 host/provider、不把弱角色提示词当兼容模式。创建/发送结果不明时 inspect 并核验原生资源，使用显式 recover 接回，不能重放未知操作。
