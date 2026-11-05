# Migration Task: Upgrade to v0.7.2-beta.0

**Created**: 2026-11-05
**From Version**: 0.7.1-beta.19
**To Version**: 0.7.2-beta.0
**Assignee**: penn

## Status

- [ ] Review migration guide
- [ ] Update custom files
- [ ] Run `trellis update --migrate`
- [ ] Test workflows

---

## v0.7.2-beta.0 Migration Guide

使用 beta 渠道精确升级到 0.7.2-beta.0，并运行 trellis update。保持用户自定义 spec 和 config；schema-2 项目忽略退休 YAML 容量键，需按实际冲突合并。默认初始化仅提供规范索引、指南和基于源码的 bootstrap；预制规范必须明确指定 --registry。原计划和旧 schema 报告兼容读取；需要本轮冻结配置和重试合同的新批次请通过 plan 构造器生成。保留全部 attempt 报告和 worklog，清理须使用 cleanup-artifacts 的预览摘要。

### AI Assistant Instructions

When helping with this migration:

不要覆盖自定义规范或重开旧终态批次。使用原生 reconcile/retry/cleanup-artifacts/delegate-bind/delegate-reconcile/transfer recover；未知进程保持围栏。CLI 控制 FIFO，主代理静默续接同一等待句柄；Hook 不保证阻止普通模型消息或宿主唤醒。

