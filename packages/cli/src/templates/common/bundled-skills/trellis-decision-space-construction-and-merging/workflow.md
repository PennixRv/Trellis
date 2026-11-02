# 决策空间构造与归并阶段流程

核对目标探索与需求核对阶段已确认的目标基线及当前 `artifact_revision`。判断候选差异、条件分支是否会影响交付、验收、风险或下游选择。若没有实质差异，可记录基线引用、跳过理由、解决方案设计与收敛阶段的最低输入和需要重新进入本阶段的变化条件，再由 Trellis CLI 核验跳过。

需要构造时，梳理决策项及其权限、候选、重要排除项与理由；按需补齐证据、适用约束、标准、阈值、依赖、影响和优先级。证据足够时给出推荐；证据不足则保留未知或待决项，不伪造结论。仅当选择之间存在条件依赖时使用决策树，并标明分支条件、来源、未知路径及其下游影响。互斥、共享依赖或汇合关系可用依赖图；独立候选用比较表或清单即可。

新颖机制、重大重构、跨组件边界变化或关键取舍缺少可信本地先例时，进行有界的 `prior-art review`，记录适用性与采纳或排除理由。只读 Teamwork 可按需补充证据；主代理核验报告后归并。将 `DecisionSpace` 或有据跳过记录交由 Trellis CLI 接受，待用户决定交由解决方案设计与收敛阶段处理。

```mermaid
flowchart TD
  input["核对已确认且仍有效的需求基线"] --> material{"差异或条件分支会改变交付、验收、风险或下游选择？"}
  material -->|"否"| skip["记录 revision、理由、解决方案设计与收敛阶段所需的最低输入和重入条件"]
  skip --> accepted["Trellis CLI 核验并接受跳过记录"]
  material -->|"是"| items["整理决策项、权限、候选和重要排除项"]
  items --> evidence["补充适用证据、标准、依赖、优先级和影响"]
  evidence --> prior{"触发 prior-art review 条件？"}
  prior -->|"是"| review["有界核对相关开源实现或公开提案"]
  prior -->|"否"| merge["汇总当前证据"]
  review --> merge
  evidence --> teamwork_gate{"只读 Teamwork 评议有净收益？"}
  teamwork_gate -->|"是"| teamwork["获取并核验只读 Teamwork 报告"]
  teamwork_gate -->|"否"| merge
  teamwork --> merge
  merge --> representation{"候选关系需要条件分支吗？"}
  representation -->|"是"| tree["建立可追溯决策树并标明相关未知路径"]
  representation -->|"否"| simple["使用清单、比较表或适用的依赖图"]
  tree --> assess["核对证据、覆盖范围、关系与当前 revision"]
  simple --> assess
  assess -->|"目标或范围变化"| goal_exploration_and_requirements["回到目标探索与需求核对阶段，更新基线"]
  assess -->|"证据或候选仍有缺口"| items
  assess -->|"可供方案收敛"| output["Trellis CLI 接受 DecisionSpace"]
  accepted --> solution_design_and_convergence["进入解决方案设计与收敛阶段"]
  output --> solution_design_and_convergence
```

### 离开阶段的条件

- 有实质决策空间时，候选、关键证据、关系、未知项和推荐均能支持下一阶段比较；不要求固定字段数量或同时使用多种图表。
- 无实质差异时，跳过记录须能说明当前基线、判断依据和重新进入条件。
- 保留用户决定不在本阶段锁定；外部参考不替代项目事实或用户选择。
