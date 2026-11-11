# 组件交付核验

本组件承接根任务 `teamwork-lost-wait-handle-recovery` 合同 v2 的 W1，由当前主会话直接实施、验证、发布和部署；未启动实施子代理。本地路线只核验组件交付归属，不另建方案、独立授权或倒填历史实施阶段。

## 接受条件

| 条件 | 实际证据 |
| --- | --- |
| 恢复同一原执行且保持接受规则 | 新增 reconcile --wait 有界只读观察、可选定位投影及窄 Hook；受控原协调器＋真实 CLI／Hook 断言 pending、settled、dispatch=1、报告待审和原协调器收尾。旧 continuation 保持 |
| 异常退出与兼容保护 | 死 owner 的 RUNNING 批次可显式 preview／execute；未知 provider 退出保留 lease 和容量。错身份、路径／参数／shell 拼接、旧投影、缺 receipt 和 reservation 消失竞态均有回归 |
| 固定发行与现场一致 | 产品 `7c446154`；版本／标签 `v0.7.2-beta.12` 为 `9c79b413ea3fc1cc0291068947c0d6df5ed68ac6`；docs-site `e541d59`。原生 GitHub 发布成功，三包公共精确版本及 beta 标签一致；Lifecycle 精确 update 和 repair 均完成，check 退出 0、recover idle |
| 项目资产 | 根、Trellis、pennix-skills 通过已安装 CLI 原生更新为 beta.12。安装实现与本地构建、项目 Hook／Skill 与发行模板逐字一致。spec、tasks、workspace、workflow、项目配置和 AGENTS 块外内容更新前后保持；两份冲突配置候选已逐一拒绝并仅删除精确 sidecar |
| 适用验证 | Core 423 passed／1 skipped，CLI 2379 passed／2 skipped，adapter 4 passed；lint、typecheck、build、清单连续性、docs guard、打包和相关格式检查通过。Python 全量 0 errors／72 既有 warnings，受影响 Hook 单独 0 errors／0 warnings。根 Node 24.16.0 full-local 为 54 passed／0 failed／0 blocked／4 条明确覆盖边界 |

发布流水线：https://github.com/PennixRv/Trellis/actions/runs/43000643917 。源码和 docs-site 分支已推送，标签不移动；后续现场资产与组件收尾提交由根 gitlink 固定。安装锁定 tarball SHA256：CLI `60f631e940d1ef262b2ab3128141d051eae8e195263251c312c9bfb5a30100e8`，adapter `bab21b9448ec28b492169e5d0e3c58e9cf96a1cbc9c0c2a07ec808b53825e547`。

## 边界及资源

两个既有 Git 诊断测试在中文 locale 下失败；CI 一致的 C locale 完整通过，未修改用户 locale。根首轮 Node 26 因 CodeGraph 组合夹具不支持而阻断；使用既有发行目录 Node 24 后完整通过，未下载或安装运行时。旧 GitNexus 索引不足已记录并以当前调用关系及回归补核，未重建。

未运行付费 provider 故障及宿主内部压缩复现；不声称修复宿主内部句柄保存。没有待处置的本任务外部执行者或实施子代理，当前 Paseo 会话和工作区保留。原始日志、安装树、备份、运行态不入 Git。合同内交付缺口已解决，按原生第五阶段接受 delivery_ready 并完成组件记账；根任务继续负责最终 gitlink、只读复核及根 Git 收尾。
