# Teamwork 容量与模式配置收敛实施合同

用户已明确批准本轮完整实施、验证、发布重装，并在更新审查包后发起五主题 Copilot 审查。复用当前父任务及 Trellis owner task，不重复请求授权。

## 目标与决定

模式默认成员/并发上限分别为 general 1/8、advisor 3/3、committee 3/3。advisor 允许 1–3 位独立建议者，committee 保留 2–3 位及不同 lens。不是要求 general 每次派满 8 位。资源预算默认 8，跨 batch 与交互进程共享既有 guard/租约；FIFO 完全由 CLI 控制。

容量配置集中在 .trellis/teamwork.json 的新 schema，模式字段与共同资源字段各有唯一来源。代码缺省只作回退。旧 schema/YAML/环境覆盖应明确兼容、来源和迁移诊断，旧的 1 不得静默压制新配置；坏配置不能悄悄回退。CLI config/preflight 显示有效容量及限制。模板、Skill、规范、公开文档和原生项目升级同步；保持旧冻结计划及报告可读，不重写历史事实。

## 实施与验证

Trellis 源仓修改 coordination、runtime config、guard、config/plan/batch/coordinator 消费者及必要迁移入口；补充默认、覆盖、旧配置、冲突、advisor 多成员和共享容量回归，保留现有锁/不确定状态围栏。运行图影响检查、专项及全量测试、lint/typecheck/build、模板打包及隔离升级检查。根侧只写协调材料、组合验收和固定 gitlink。

沿既有 beta 发布流程锁步发布下一未使用 CLI/Core 版本，经 GitHub Actions 核验后用 Pennix 原生 update 重装；原生更新两仓资产，核对有效值、来源、版本、结果及专用配置保护。更新五主题审查包到已验收新 commit，重新冻结真实 route/input/source，执行 preflight，通过后前台 batch --json 派发并回收、复核报告。不得以旧 dry-run 代替新版本预检或删除未决租约。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 模式与容量配置统一，兼容和诊断明确 | 配置及模式 | Trellis | config/plan/guard/batch 回归 | 有效值和失败测试 | 错误配置静默回退或旧值压制则停止 |
| 运行与分发一致，不破坏 FIFO/租约 | 验证分发 | Trellis | lint/typecheck/test/build 与隔离升级 | 测试及包核对 | 必需检查失败不发布 |
| 新版发布重装且两仓资产一致 | 发布安装 | Trellis/根仓 | CI、Pennix、原生 update | 版本/摘要/gitlink | 来源不符停止安装 |
| 五主题审查基于新候选真实完成 | 审查 | 根仓 | plan/preflight/batch --json | 五份报告及主代理复核 | 不确定状态停止重试清理 |

## 接受与停止

成功要求实现/测试/分发/安装一致，新配置不被旧容量压制，advisor 多成员可构造，五主题审查实际完成并形成统一证据。配置/运行失败如实归因，保留现场，不伪报成功；RECONCILIATION_REQUIRED 停止重试和清理。审查发现的额外源码修复不因本次派发自动获得授权。原主任务其他 pending action 不执行，不把该工作包等同父任务整体关闭。

