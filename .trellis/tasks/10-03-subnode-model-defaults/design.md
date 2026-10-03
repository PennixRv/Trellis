# Authoritative subnode defaults

The CLI template owns generated defaults; Marketplace owns the published workflow contract. Change both sources, not only the root consumer.

- Use gpt-6.1-sol as default_model. Six judgment profiles retain high, evidence_synthesis retains medium, docs_source explicitly uses gpt-5.6-luna/xhigh for identified-source extraction. Contract conflicts/source judgment use an explicit Sol/high override. Keep the existing xhigh reason guard; max is outside this change.
- Remove code_path only from defaults. Ordinary lookup stays inline; independent call-chain evidence uses correctness_test/fault_diagnosis/architecture_compat with the appropriate brief lens. Arbitrary project IDs and historical receipts remain unchanged.
- Minimum source files: CLI JSON template, existing template/init assertions, one pristine-legacy update regression; Marketplace workflow and its existing contract test. No production TS/Python functions, schemas, dependencies or user configuration change.
- Verify current getAllAgents/init/update wiring and resolver contract. GitNexus UNKNOWN is supplemented by actual text references, never interpreted as unused. Build/pack and native temporary-project smoke prove artifact inclusion and generation; these do not prove publication.
- Commit Marketplace separately before its Trellis pointer. Local source readiness is the authorized implementation boundary. Existing CI-only release, native lifecycle upgrade and immutable-source root consumption remain with the coordinator pending remote authorization. Do not substitute a different root workflow source kind or unpublished provenance.
- Rollback is the two recorded baseline commits, limited to this task's source changes; native update continues protecting project customization.

Planning closure: source targets, branches, eight defaults, removal boundary, tests, local artifact proof and commit order are fixed. No max expansion or terminal-wait repair. A native update/routing contradiction returns this task to planning.
