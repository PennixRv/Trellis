# 统一 Trellis 用户文档模板为简体中文

## 目标（Goal）

实现根协调任务 10-13-unify-trellis-template-writing 的 Trellis 源仓库部分：统一纳入范围的用户维护/共维护模板正文为简体中文，保留解析锚点和机器合同；适配工作流阶段解析及 journal 新旧格式续写；验证原生 init/update 保护。等待根任务方案批准后再启动。

## 要求（Requirements）

- 按根任务已封口范围更新原生 workflow、默认任务 PRD、workspace 总索引、个人 index/journal 生成与追加逻辑，以及 backend 6、frontend 7、guides 4 共 17 个 spec 源模板；纳入的用户可读自然语言默认使用简体中文，标题中文优先并保留括号中的英文结构锚点。
- 保留文件名、frontmatter、JSON 字段、命令、路径、配置键、枚举/状态、代码块、稳定英文锚点、机器标记、托管块和生成/更新协议；项目 managed `AGENTS.md`、AI 专属资产与第三方 Marketplace workflow 排除。
- 更新实际 workflow 阶段消费者，使中文优先双语标题和既有纯英文标题均可解析；保持步骤编号、状态注入、校验和跨平台复制一致。
- 更新 journal 新写格式并兼容旧英文格式，保留 session/date/counter、跨 ref、指纹、历史合并和轮转合同；不新增翻译迁移器或静默重写既有资产。
- 用真实 init/update fixture 验证新模板、哈希匹配更新、用户修改冲突、workspace/spec 保护和 Marketplace 边界。
- 按根任务的写作边界，将 Trellis 机械合同与可调整的自然语言分层；中文文案 linter 不是 parser/generator 或英文语法门禁。

## 验收标准（Acceptance Criteria）

- [ ] 17 个 spec 与其他纳入源模板全部按清单覆盖，默认用户自然语言为简体中文，英文锚点和机器合同保持。
- [ ] workflow 旧英文和新中英标题在所有实际消费者中解析一致，平台生成副本和状态注入回归通过。
- [ ] journal 旧/新格式可续写，任务 PRD 只影响新任务，既有 workspace/spec/历史数据不被静默迁移。
- [ ] init/update fixture 证明 hash/conflict/protected paths 和 Marketplace 所有权边界。
- [ ] 通过组件测试、构建、lint、typecheck 及适用的 GitNexus 检查；未覆盖的平台或宿主限制有真实回执记录。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
