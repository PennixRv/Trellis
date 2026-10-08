# Verification

- Source fix 0f31c85f; paired release tag a04054b0 / beta.40. Official CI
  https://github.com/PennixRv/Trellis/actions/runs/37718738225 succeeded.
- Public npm exposes both packages and beta dist-tag beta.40. Packed/published
  CLI dependency is exactly @pennixrv/trellis-core beta.40.
- Core 414 passed / 1 existing skip; CLI 2262 passed / 2 existing skips.
  Lint, typecheck, build, release checks and CI repeated required gates passed.
- Native lifecycle global upgrade/verify passed. Seven projects are beta.40;
  native workflows retain content and refresh provenance, while the two selected
  Marketplace workflows retain their immutable ref. Custom files were preserved.
- Installed public SDK → CLI → installed CCH renderer passed owner isolation,
  duplicate/retry/indirect descendants, cross-project querying, and Channel rm
  retention. Store mode is 0600. No paid workers were spawned for this verification.
- Actual main-session query is not_started because no new real binding occurred
  after upgrade. Pre-upgrade recovery was explicitly excluded by the user.
- Five accepted byte-identical workflow sidecars and the two exact native update
  backups were removed. The isolated installation fixture was cleaned in finally.

No remaining implementation, publication, installation, or acceptance blocker.
