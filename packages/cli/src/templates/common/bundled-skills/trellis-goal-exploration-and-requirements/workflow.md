# 目标探索与需求核对阶段流程

先核对用户请求、目标对象和项目背景。新项目明确问题、用户、领域及系统边界；既有项目核对目标仓库、组件、当前版本、适用规则、现状和影响范围。按问题选择本地源码、历史记录、外部资料或用户维护知识等证据来源；只在独立取证有净收益时使用 Trellis Teamwork。

整理目标、范围、成功条件、关键约束和责任方。区分已知事实、假设、证据冲突和未知事项；缺少会改变目标或路线的用户事实时，通过 `pennix-decision-grill` 同步询问。记录会阻断推进的问题及恢复条件；不影响当前路线的事项可明确责任方和后续处理。

形成 `phase_output`，至少包含当前目标与需求基线、必要证据、不确定性、`phase_result` 和非约束性的 `route_advice`。阶段可等待用户补充或因依赖阻塞；只有用户确认当前基线且阶段产物有效时，才以 `accepted` 离开本阶段。将阶段产物及引用提交 Trellis CLI 核验后，向用户展示简明基线并请求确认或修订。

```mermaid
flowchart TD
  request["核对请求、项目背景和目标对象"] --> evidence["选择必要证据并核验现状"]
  evidence --> baseline["整理目标、范围、成功条件与约束"]
  baseline --> enough{"关键事实是否足以形成基线？"}
  enough -->|"否，需用户补充"| ask["Trellis CLI 记录 needs_user_input；同步询问"]
  ask --> wait["等待答复并留在阶段 1"]
  wait --> evidence
  enough -->|"否，依赖阻断"| blocked["记录 blocked 与恢复条件"]
  blocked -->|"依赖恢复后"| evidence
  enough -->|"是"| output["形成 phase_output 并由 Trellis CLI 核验"]
  output --> confirm["向用户展示当前基线并请求确认"]
  confirm --> decision{"用户是否明确确认当前版本？"}
  decision -->|"要求修订"| evidence
  decision -->|"尚未确认"| wait
  decision -->|"明确确认"| gate["以当前 artifact_revision 记录确认并接受阶段"]
  gate --> route["按当前路线选择下一阶段；跳过阶段 2 也保留此确认"]
```

### 离开阶段的条件

- `accepted` 及明确用户确认必须绑定当前 `artifact_revision`；产物改变后重新核验并取得确认。
- `needs_user_input` 或 `blocked` 时不推进阶段游标。
- `terminated` 不代表用户撤回任务；如用户明确撤回，按阶段 5 的取消审查处理。
- 阶段 1 可直接进入阶段 3，但不能绕过需求基线确认。
