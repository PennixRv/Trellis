# Implementation and verification

The approved source boundary is the native AGENTS template, spec-bootstrap guidance and related references, and this checkout's GitNexus instruction/skill/architect integration. Writer logic, public CLI interfaces and third-party project contents are unchanged.

The short template is 660 bytes/16 lines excluding its trailing newline. The two project-specific GitNexus blocks and their conditional preambles are removed; the active TRELLIS block is intentionally left for the public CLI refresh. Exactly 18 reviewed tracked SKILL.md files were removed through git rm after checking for extra files and symlinks. The derived index and software payload cache remain untouched until the parent's final native cleanup.

The focused native suite passed 186 tests in five modules. The first full build, lint and CLI Python analysis passed; full typecheck/tests and the updated-manifest build are continuing. The beta.22 manifest is nonbreaking with no third-party deletion migration. Bilingual docs-site changelogs and navigation pass the native release checker; its precise documentation work package is docs-site/.trellis/tasks/11-17-project-agents-injection-release/prd.md.

No release or production refresh has happened yet. Required public artifact, installation and integration evidence remains with the parent task.

Full checks now pass: Core 429 tests passed/1 condition skipped, CLI 2173 passed/2 condition skipped, adapter 8 passed; all-package build, lint and typecheck pass. CLI Python analysis exits successfully with 0 errors and 72 existing warnings; no Python source was changed. Native packed-CLI/Core pin verification passes.

The built CLI also passed real isolated fresh generation, old public CLI initialization followed by short-block update, synthetic foreign-owner preservation, repeat-update identity, native backup restore of the old block, and reapplication of the new block. These are file/CLI checks, not model compliance or timing claims. Docs-site commit b4622be is pushed to its existing main branch; bilingual formatting, Markdown and shared navigation checks pass.
