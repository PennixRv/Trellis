# Technical Design

## Scope and ownership

The implementation target is the Trellis fork at `/home/penn/devel/Trellis`,
on `pennix/v0.7-beta`. The root coordination repository is evidence-only for
this task. Marketplace changes, if required, are made in its own submodule and
then consumed through the Trellis gitlink. Stable `main` and npm `latest` are
not changed by this beta release.

## Audit model

Use one reconciliation matrix with these dimensions:

1. upstream beta commit and file/function behavior;
2. Pennix stable-main contracts carried into beta;
3. Pennix-specific behavior and task records;
4. Marketplace and generated template parity;
5. package manifests, migrations, build output, and tarball contents;
6. remote refs, tags, CI publication, npm dist-tags, and isolated install.

Each finding receives one disposition: retained, ported, intentionally excluded,
fixed in this task, or evidence-only. A source claim is not accepted as a
release claim until the generated package and a clean consumer directory prove
it.

## Release shape

Keep the existing beta branch and release mechanism. Determine the next valid
beta version from the current published version rather than hard-coding a tag.
If code or release metadata changes, publish through the existing CI tag path;
never publish npm directly from the workstation. Marketplace is pushed before
the Trellis gitlink and release tag when it changes.

## Minimal-change rule

Prefer existing registries, migration manifests, release checks, and smoke
commands. Add only the missing source/test/metadata needed to make an audited
contract true and reproducible.
