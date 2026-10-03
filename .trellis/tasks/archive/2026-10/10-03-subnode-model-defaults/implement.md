# Implementation and verification

1. Natively bind this owner task in inline mode with --allow-empty-context; keep root coordination separate.
2. Change CLI JSON/default assertions and add one pristine-legacy native update regression; retain customization protection.
3. Align Marketplace defaults/selection advice and its existing contract test; preserve all other workflow semantics.
4. Run targeted CLI template/init/update/resolver tests and Marketplace unittest, then pnpm lint, pnpm typecheck and pnpm build.
5. Check npm pack dry-run inclusion. Use the built binary in an explicit fresh temporary git project for native init/update dry-run; verify generated JSON and native hash ownership.
6. Run native GitNexus detect-changes on this exact checkout and reconcile any UNKNOWN/partial/truncated outcome with current source. Record actual checks and limitations.
7. Source commits are ready. Under the user's new publication authorization, add the beta.24 manifest and bilingual changelog/navigation, push Marketplace/docs first, commit their pointers, then run native release:beta. Verify CI and the two public npm packages.
8. After native installed CLI upgrade, refresh this repository's dogfood assets through project update and review every modified-file candidate. Commit the accepted generated assets and record the final published/adopted state.

No worker, cache/manual runtime edit, automatic retry, max extension or unrelated cleanup. Root's three downstream tasks remain unstarted.
