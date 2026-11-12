# Implementation evidence

The root's accepted requirements and decision space cover this bounded owner
package. Native CLI rejected an initial route omitting the goal phase
(`TASK_PHASE_INVALID_ROUTE`); no state was initialized. The corrected route
retains goal acceptance using the existing actual root approval, omits only
duplicate decision-space work, then records design, implementation and
delivery review. It does not introduce a new user choice.

Initial checkout: `fix/existing-project-spec-convergence`, tracking the same
origin branch, clean before owner-task creation. Release branch/track must be
checked against the native release process before publishing.

Pre-edit GitNexus impact: `set_active_task` HIGH (start/create/compatibility
pointer callers), `_session_file_lock` CRITICAL (six pointer helpers),
`_record_lock` CRITICAL (continuity, transfer, mutation guards and layout),
`_task_lock` HIGH (phase and terminal/delegation mutations), update hint LOW.
The index is 66 commits behind HEAD; missing symbols are UNKNOWN. Confirm
current callers from bounded source; never use missing graph edges to remove
guards. The implementation must preserve the existing write transaction and
prove direct-helper and multi-process behavior.

No real data deletion, provider action or service restart has been executed.

W1 candidate: active views now exclude terminal tasks while retaining completed
child progress. Session pointer clears retain runs and unknown fields and remove
only known empty projections. Direct pointer, continuity, ownership and phase
writers reuse the fixed layout anchor. The old record lock also created parent
directories; initial continuity/transfer failures identified that coupling and
the directory creation was restored within the protected write transaction.
Four task/layout/context suites pass: 75 tests. Eight direct-helper regressions
now pass, including two-process CAS and failed atomic writes. Python type check
passes (0 errors; existing unused import warnings remain).

The native runtime candidate previews only known Task-owned families and uses
exact fingerprints/digest at confirmation. It preserves durable records and
fixed anchors. Linux descriptor inspection includes open-but-not-yet-locked
waiters. This host denies a complete same-user descriptor scan: old anchors are
therefore protected, not silently declared unused. This restriction affects
only legacy anchor retirement, not other verified projections or normal work.
Terminal delegate-inspect now reads historical runtime/metadata without a
provider call or reauthorization. Missing historical context refs are explicitly
diagnostic; accepted history is not rewritten. Ignore rules precede the upcoming
attempt diagnostic writer. Source changes are not yet propagated or published.

W2 candidate: attempt diagnostics now share the attempt evidence directory;
foreground wait release removes only the known empty session directory. The
read-only same-batch recovery path remains available for a malformed wait
projection, without permitting execution. Evidence cleanup and session rm/prune
preview by default, bind confirmation to fingerprints and native settled state,
and protect durable results/recovery references. Inventory mentions remain soft.
One-shot run now uses the same preview/confirm path. Core create --force retains
its input compatibility but cannot bypass evidence cleanup by replacing an
existing session. Core metadata/name safety: 12 tests pass. Teamwork suites: 66
tests pass; the reference and native update suites additionally pass 78 tests.

Native candidate update dry-run adds task_runtime.py and updates 15 generated
assets. The only customized decision file is .trellis/config.yaml, deliberately
retained in full using --skip-all. The .gitignore update is a native preserving
append, covered by an idempotence/custom-rule test; its custom bytes are not
blessed as a template hash. This authorizes candidate dogfood propagation only,
not a published/install completion claim. No task/history/runtime data is removed.

## 发布候选核验

最终全量测试：Core 424 passed / 1 skipped，CLI 2167 passed / 2 skipped，adapter 4 passed。lint、typecheck、Python 静态检查通过（0 errors / 72 warnings）；串行 build 通过。曾并行运行 build 与 typecheck，两者都会 clean Core dist，造成一次缺模块失败；已按实际脚本确认并改为串行验证，没有为工具竞争改源码。

最新模板通过候选原生 update --skip-all 再物化，仅更新两份已核验 Python 资产并保留自定义配置。GitNexus detect-changes --scope all 返回 48 文件、49 符号、84 流程和 critical 聚合风险；索引旧于源码，该结果仅定位调用面。已覆盖 Task/阶段/continuity、Teamwork cleanup/rm/run/Core force、模板注册、原生 update 和 Hook 回归；不把新符号未索引当作无影响。

下一版本核验为 0.7.2-beta.19：npm beta 与远端 tag 均停在 beta.18。新 manifest 明确默认预览、确认参数和 force 行为变化，EN/ZH changelog 与导航已准备。仍须固定源码、原生发布、包校验和安装验收。

审查另补 ZIP 交接语义 core 的有界只读引用检查；Trellis 不复制交接存储写协议，未知/损坏/超预算容器保留。新增与既有引用、cleanup 两组 17 项通过，CLI 全量更新为 2168 passed / 2 skipped。新 Task runtime CLI 已通过真实参数解析默认预览和过期摘要拒绝回归；其实际接口是 `task.py runtime [<task>] [--confirm <digest>]`，无额外 preview/cleanup 子命令，文档已按此修正。

打包 preflight 通过；全新隔离 init 安装 task_runtime.py 等四份 Python 模板，逐字与源码一致且在原生 hashes 登记，runtime 默认预览可运行，后续 update dry-run 为 already up to date。第一次 smoke 错读 hashes 的字段名及多传 preview 位置参数均为本次验证脚本错误；已读取真实格式/解析器后纠正，没有据此改动正常实现。
# 固定发行及安装后验收

源码实现提交 `c7af347717cc921e5ace1d2c42662042d027b9e2`，原生 `pnpm release:beta` 生成 `v0.7.2-beta.19`，tag 指向 `9d13904aaa88bbfaa3ed2a5282b954b27a4692cd`。Core、CLI、adapter 版本一致。完整验证最终为 Core 424 passed / 1 skipped、CLI 2168 passed / 2 skipped、adapter 4 passed，lint/typecheck/build 通过，Python 0 errors / 72 warnings；必要 release 检查及 packed CLI 精确 Core 依赖核验通过。

Publish to npm run `43201970940` 首次在包已上传但公共 registry 尚未可见时耗尽等待窗口；未改 tag 或本地重发。随后原生 verify-npm 三包通过，沿既有幂等 publish plan 重跑同一 CI 成功。文档提交 `aa0c119` 已推送并由 source gitlink 固定。

根侧完成 `pennix update` 精确 .19 和 CLI/adapter 原生 repair；两个 owner 均 changed，锁、receipt、实际安装 package 三者一致。根、Trellis、Skills 通过 native update --skip-all 与 bundled native 复核；分别 4222/1591/462 项保护指纹不变，27 个生成脚本/Hook 与源码逐字相等。Trellis 自定义 config.yaml 保留。自动生成的迁移提示任务已通过原生分析审查完成，未执行无条目的 --migrate。

根 Node 24.16.0 full-local 55 passed / 0 failed / 0 blocked / 4 not_run；offline 11 passed，session-handoff 六模块通过。4 项是测试明确未覆盖的历史冲突、跨进程写入、远端 registry 和宿主实际加载边界，未伪称通过。真实运行资产、Teamwork 和历史迁移的安装后预览交由根任务处理；本 owner 包没有真实历史删除，也没有改变未决 provider 状态。
