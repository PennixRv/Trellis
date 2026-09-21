# Implementation

1. Verify the Marketplace branch, remote reachability, index entry, and the
   existing Trellis Gitlink.
2. Commit and push the Marketplace documentation origin correction; tag and
   publish `v0.6.22` from that commit.
3. Update Trellis `.gitmodules`, its Marketplace Gitlink, and the `0.6.22`
   migration manifest. Stage only those paths and this task's artifacts.
4. Run the targeted workflow/template tests, package/version preflight, packed
   CLI validation, and a clean recursive-clone plus pinned-init smoke test.
5. Run the existing patch release command from `main`, then verify the remote
   tag, GitHub Actions publication, and public npm versions.
6. Record the exact SHAs and checks in task research before archiving.

Rollback before the Trellis tag is a normal revert of the two source commits.
After tagging, preserve the published tag and diagnose/re-run the existing CI
path rather than locally publishing or rewriting release history.
