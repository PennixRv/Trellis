# 项目入口、通用 spec 与 AGENTS 原生写入实现

## Goal

承接根任务 trellis-project-governance-spec-orchestration 已批准合同 W1：通用 spec 生成消费、AGENTS 严格块写入与恢复、必要导航和兼容验证。根任务统一实施与发布部署授权，不另设方案或请求批准。

## Requirements

- This is W1 implementation bookkeeping under the single approved root task `trellis-project-governance-spec-orchestration`, not a new planning or approval workflow.
- Follow the root task's accepted `implementation-contract.md`, `implementation-approval.md` and applicable component specs. Root artifacts are at `../.trellis/tasks/in_progress/11-11-trellis-project-governance-spec-orchestration/` relative to this component root.
- Implement generic spec generation/consumption, safe AGENTS managed-block operations and bounded navigation fixes. Keep legacy specs, explicit registry inputs, task bindings and foreign blocks. Exclude the independent lost-wait-handle defect.
- Root owner retains phase, integration, Git commits, release and deployment control. Implementer changes product/test/doc sources only, uses Codex, and does not spawn children or ask the user.

## Acceptance Criteria

- [x] W1 and regression tests satisfy the approved root contract, including D3 and N2.
- [x] Native checks, build and affected caller/template coverage have exact results and limits.
- [x] No unapproved runtime, user configuration, index, dependency or unrelated source changes.

## Notes

- The root task owns the approved plan; this local record supplies component ownership and implementation evidence only.

## W1 实施证据（2026-11-11）

本节只记录已授权 W1 的实施与验证；不改变任务原生状态，不代表根任务集成、发布或部署通过。

- 通用规范：默认仅生成根索引与实际包索引，不再预建 frontend/backend；bootstrap、before-dev/check、平台 agent 和 Hook 支持根／包／旧层入口，并先按包作用域过滤。规范化 scoped package 的 default_package，补齐本仓实际包配置与索引。
- AGENTS：共用严格块解析与普通文件预检，初始化默认追加缺失 T、保留合法 T，force／交互覆盖仅替换 T；更新、卸载、资产恢复与受影响 ablate 保留块外字节，拒绝异常标记、不安全文件及可检测的陈旧快照。未登记旧块不自动认领；仍使用原生全文件摘要，不宣称跨 writer 锁或 CAS。
- 重复初始化：普通重新初始化快速路径也处理缺失 T；force 未重写 AGENTS 时保留原有摘要记录，不把后加正文重新登记为模板基线。
- 导航：修正无 route 的处理顺序，提供无 Hook 时的 phase show／显式规范读取回退，补齐 AWAITING_REVIEW 与原生 review 入口。未修改独立等待句柄缺陷。

验证命令与真实结果：

| 命令／检查 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm --filter @pennixrv/trellis exec vitest run test/commands/init-uninstall-overdelete.integration.test.ts test/commands/init-joiner.integration.test.ts test/commands/init.integration.test.ts` | 3 文件，89 项通过 | `/tmp/w1-reinit-tests.log` |
| `pnpm test` | Core 423 通过、1 跳过；CLI 2368 通过、2 跳过；Paseo adapter 4 通过 | `/tmp/w1-tests-handoff.log` |
| `pnpm lint` | 通过 | `/tmp/w1-lint-handoff.log` |
| `pnpm typecheck` | 通过 | `/tmp/w1-typecheck-handoff.log` |
| `pnpm build` | Core、CLI、Paseo adapter 全部通过 | `/tmp/w1-build-handoff.log` |
| `pnpm --filter @pennixrv/trellis lint:py` | 未通过：1 error、72 warnings；唯一 error 为未修改的 `shared-hooks/guard-teamwork-wait.py:36:13 reportUnusedVariable`，属于明确排除项 | `/tmp/w1-lintpy-final.log` |
| `git diff --check` | 通过 | 原生空输出，退出码 0 |
| 中文文案检查：`python3 /home/penn/.agents/skills/pennix-skills/pennix-chinese-tech-writing/scripts/lint_copy_rules.py README_CN.md` | 通过 | `/tmp/w1-chinese.log` |
| Python 源码双份文件比较 | `packages_context.py` 模板与本仓脚本逐字节一致 | 原生断言通过 |

构建后的原生 CLI 在临时项目依次执行 `init --codex --yes --user w1-smoke`、同命令重复、`init --codex --yes --force --user w1-smoke`、`update --dry-run`，四次退出码均为 0。每步断言手工正文与 CodeGraph 块的 CRLF／非 ASCII 原始字节保留、T 仅一个、全文件摘要管理记录存在且稳定、通用索引存在、默认 frontend/backend 不存在。该操作只针对临时目录，不是当前项目更新。

验证期间曾把定向测试与会清理 Core dist 的 typecheck 并行，导致两个测试文件加载失败；构建完成后串行复跑 8 文件 739 项通过，最终全仓测试也通过。初次冒烟发现的 force 管理记录丢失已修正并加入回归。Context Mode 因宿主 threadId/session_meta 参数错误不可用，采用有界原生读取与本地结果筛选；未安装、同步或重建索引。

当前完整差异摘要（原生命令 `git diff --stat=180`，不包含未跟踪文件）如下。`docs-site` 子模块差异来自既有／并行现场，不是本执行器修改；保留给父执行器处理。

```text
 .trellis/config.yaml |  13 ++++
 .trellis/scripts/common/packages_context.py |  30 ++++++++-
 .trellis/spec/cli/backend/commands-uninstall.md |   5 +-
 .trellis/spec/cli/backend/commands-update.md |   8 +--
 .trellis/spec/cli/backend/uninstall-scrubbers.md |   2 +-
 .trellis/spec/tech/repo/index.md |   7 ++-
 README.md |  14 +++++
 README_CN.md |   4 ++
 docs-site |   2 +-
 packages/cli/src/commands/init.ts | 221 ++++++++++++++++++++++++++++++++++++-----------------------------
 packages/cli/src/commands/update.ts | 114 ++++++++++++++++++----------------
 packages/cli/src/configurators/workflow.ts |  69 +++++---------------
 packages/cli/src/templates/claude/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/codebuddy/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/codex/hooks/session-start.py |  39 +++---------
 packages/cli/src/templates/common/bundled-skills/trellis-spec-bootstrap/references/spec-writing.md |   6 ++
 packages/cli/src/templates/common/bundled-skills/trellis-teamwork/references/teamwork-plan-construction.md |   8 ++-
 packages/cli/src/templates/common/commands/continue.md |   6 ++
 packages/cli/src/templates/common/skills/before-dev.md |   4 +-
 packages/cli/src/templates/common/skills/check.md |   4 +-
 packages/cli/src/templates/copilot/hooks/session-start.py |  39 +++---------
 packages/cli/src/templates/cursor/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/droid/droids/trellis-implement.md |   2 +-
 packages/cli/src/templates/dsh/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/gemini/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/grok/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/kimi/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/kiro/agents/trellis-implement.json |   2 +-
 packages/cli/src/templates/markdown/agents.md |   9 +++
 packages/cli/src/templates/markdown/index.ts |   1 +
 packages/cli/src/templates/opencode/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/opencode/lib/session-utils.js |  22 +++++--
 packages/cli/src/templates/qoder/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/shared-hooks/session-start.py |  12 ++--
 packages/cli/src/templates/snow/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/trae/agents/trellis-implement.md |   2 +-
 packages/cli/src/templates/trellis/scripts/common/packages_context.py |  30 ++++++++-
 packages/cli/src/templates/zcode/agents/trellis-implement.md |   2 +-
 packages/cli/src/utils/asset-backup.ts |  61 +++++++++++-------
 packages/cli/src/utils/file-writer.ts |   2 +-
 packages/cli/src/utils/managed-removal.ts |  37 ++++++++++-
 packages/cli/src/utils/manifest-prune.ts |  24 ++++---
 packages/cli/src/utils/uninstall-scrubbers.ts |  18 ++----
 packages/cli/test/commands/ablate.integration.test.ts |   8 ++-
 packages/cli/test/commands/init-uninstall-overdelete.integration.test.ts |  98 ++++++++++++++++++++++++-----
 packages/cli/test/commands/init.integration.test.ts |  73 +++++++---------------
 packages/cli/test/commands/update.integration.test.ts |  64 +++++++++++++------
 packages/cli/test/scripts/session-start.integration.test.ts |  39 ++++++++++++
 packages/cli/test/templates/codex.test.ts |   4 +-
 packages/cli/test/templates/copilot.test.ts |   4 +-
 packages/cli/test/templates/opencode.test.ts | 112 ++++++++++++++++++++++++++-------
 packages/cli/test/templates/shared-hooks.test.ts |   4 +-
 packages/cli/test/utils/asset-backup.test.ts |  43 +++++++++++--
 packages/cli/test/utils/managed-removal.test.ts |  36 +++++++++++
 packages/cli/test/utils/uninstall-scrubbers.test.ts |  17 +++--
 55 files changed, 856 insertions(+), 485 deletions(-)
```

当前未跟踪文件（原生命令 `git ls-files --others --exclude-standard`）如下。组件记账目录中的 `task.json`、`implement.jsonl`、`check.jsonl` 由父执行器提供，本执行器只追加本 PRD 的实施证据。

```text
.trellis/spec/cli/index.md
.trellis/spec/core/index.md
.trellis/spec/docs-site/index.md
.trellis/spec/index.md
.trellis/spec/paseo-adapter/index.md
.trellis/tasks/planning/11-11-project-governance-spec-implementation/check.jsonl
.trellis/tasks/planning/11-11-project-governance-spec-implementation/implement.jsonl
.trellis/tasks/planning/11-11-project-governance-spec-implementation/prd.md
.trellis/tasks/planning/11-11-project-governance-spec-implementation/task.json
packages/cli/src/templates/markdown/spec/index.md.txt
packages/cli/src/utils/managed-markdown.ts
packages/cli/test/fixtures/agents-before-governance.md
packages/cli/test/utils/managed-markdown.test.ts
```

限制：Python 全量检查未达到全绿；根任务的跨组件联合验收、正式集成、Git、发布和部署由父执行器负责。本执行器未提交，未执行安装、发布、标签、推送、实际项目 update、索引生成或 Copilot。

## 主执行器核验与组件记账收尾

上述“未提交／未发布”等限制描述 W1 角色返回时点。主执行器已补齐真实 CodeGraph marker、无 after 的手工 backup 和项目内 AGENTS 链接三个安全反例的共享修复；稳定候选全量 2801 项通过、3 项跳过，39 项安全定向回归及 32 项根侧真实组合检查通过，类型、lint、build 和发行预检通过。已知未修改的 Python 检查错误及 locale 限制保留在根任务 `validation.md`。

功能提交为 `020cc8a3`，版本提交为 `9b62779d835f6cb82449e9750891cc3dc77efced`，固定标签为 `v0.7.2-beta.11`。本组件任务只核验根任务已授权并完成的 W1 结果及归属记账；使用目标核对→交付审查的简化 analysis 路线，不另建实施方案、不倒填实施前阶段。根任务继续负责公开发行、实际部署、项目资产与最终组合验收。
