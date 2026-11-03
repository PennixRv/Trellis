---
name: contribute
description: "维护 PennixRv/Trellis fork 的源码、内置工作流、Skill 和文档；用于确定贡献落点、同步生成资产及核验交付。"
---

# 维护 Trellis fork

先读取仓库 AGENTS.md、.trellis/workflow.md 及目标包规范，确定实际修改仓库和已选分支。沿用当前授权的分支与任务；本项目的 Trellis 源码目标为既有 v0.7.1，不自行创建分支或 worktree。

## 修改落点

| 内容 | 源码位置 | 核验入口 |
| --- | --- | --- |
| CLI 与平台配置器 | packages/cli/src/ | pnpm lint、pnpm typecheck、pnpm test |
| Core SDK | packages/core/src/ | Core 规范及对应测试 |
| 内置工作流 | packages/cli/src/templates/trellis/workflow.md | 构建产物、原生 init/update |
| 内置 Skill | packages/cli/src/templates/common/skills/ 或 bundled-skills/ | 当前解析器、生成文件和哈希登记 |
| 文档 | docs-site/ 独立 submodule | 文档规范、双语页面、docs.json 导航 |
| 仓库专用辅助 Skill、命令 | 当前 .agents/、.claude/、.cursor/、.codex/ 中相应文件 | 核对其他宿主副本、真实命令及引用 |

源码远端为 PennixRv/Trellis，文档远端为 PennixRv/docs；通过 git remote get-url origin、git -C docs-site remote get-url origin 和 .gitmodules 核对当前配置。

项目 .trellis/spec/ 是项目维护的编码规范；可复用的远程 spec 模板由其独立 owner 维护。当前 fork 默认使用 CLI 内置的 native workflow。只有用户明确指定外部自定义工作流来源时才单独处理该来源，不把外部仓库纳入本 fork 的安装与发布依赖。

## 文档与 Skill 同步

- 用户可见文档保持英文与中文页面同步；新增页面同时更新 docs-site/docs.json 中对应语言与版本的导航。
- 文档根目录对应稳定版，开发版本位于 beta/ 或 rc/，中文位于 zh/ 下的对应目录。按 .trellis/spec/docs-site/docs/release-lifecycle.md 确认落点。
- 新增指南、博客、展示页面时，以目标版本当前存在的相邻页面及导航分组为依据；更新其实际概览页，核对 frontmatter、链接和图片。
- 修改内置 Skill 或工作流后，从源码构建并通过原生 Trellis CLI 同步生成资产；修改仓库专用辅助文件时核对宿主副本。不要把生成目录当成第二份模板源码。
- 页面或 Skill 说明中的包名、命令、字段和路径，以当前源码和真实 CLI 回执为准。目录、命令退役前核对调用方；改名后的有效功能应修正引用。

## 验证与交付

源码变更按目标规范执行相关测试和检查。涉及生成资产时，检查 npm 打包内容，并在临时项目运行当前构建的 init 与 update --dry-run，核对生成文件及模板哈希。

文档验证按 docs-site/package.json 的现有脚本和文档规范执行，检查对应双语页面及导航；需要渲染验收时运行文档预览。文档提交先推送其已选远端分支，再提交父仓库 gitlink，确保该提交可被新检出取得。

发布迁移清单时使用仓库 create-manifest 辅助入口，并读取 .trellis/spec/cli/backend/release-process.md。CLI 与 Core 均使用 @pennixrv 作用域、保持版本一致，正式 npm 发布由标签触发的 CI 完成。

提交前核对差异和影响，保留无关用户修改。交付说明列出真实修改、验证结果和未运行检查；创建 PR 或执行发布以当前用户授权为准。
