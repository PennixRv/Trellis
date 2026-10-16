# 设计

在现有规划合同中加入先展示方案、再取得“封口并批准推进／补充修改”的最终答复。复用原生 seal/approve/start 和文档摘要，不新增字段或拦截器。明确最终合并答复不同于普通设计选择；只封口按真实意图处理；方案实质变化重新展示确认。

修改源模板及有效独立平台入口，原生 Python 只调整旧顺序文案并保持 dogfood 双树一致。Marketplace 在独立仓库的明确任务修改，先推送再更新 gitlink。默认模板与 native 工作流保持一致。冻结后的任务文件不写进度，验证与回执写 execution.md。

beta.51 的发布恢复沿现有 CI-only owner 合同处理：在 `.github/workflows/publish.yml` 增加 `workflow_dispatch` 和必填 `source_ref` 输入，checkout 使用该输入选择已存在的 `v0.7.0-beta.51`；版本校验、构建、测试、发布和 npm 回读保持原有步骤。手动触发只补发当前已创建的 beta.51，不改变版本号、tag 或 Release，也不提供本机发布后门。
