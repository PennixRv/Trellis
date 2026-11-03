import { Command } from "commander";
import {
  createAssetBackup,
  listAssetBackups,
  loadAssetBackup,
  pruneAssetBackups,
  restoreAssetBackup,
  withAssetMaintenance,
} from "../utils/asset-backup.js";
import {
  getTransactionPaths,
  loadAblationTransaction,
  withAblationProjectLock,
} from "../utils/ablation-store.js";

/** JSON reports contain paths, hashes and metadata, never payload contents. */
export function registerBackupCommand(program: Command): void {
  const command = program
    .command("backup")
    .description(
      "Manage project-local Trellis asset snapshots; task and session data are excluded",
    );
  const report = (action: () => unknown): void => {
    try {
      console.log(JSON.stringify(action(), null, 2));
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  };
  command
    .command("create")
    .description("Create and verify a private asset snapshot")
    .action(() =>
      report(() =>
        withAssetMaintenance(process.cwd(), () =>
          createAssetBackup(process.cwd()),
        ),
      ),
    );
  command
    .command("list")
    .description("List verified, legacy and protected backup objects")
    .action(() => report(() => listAssetBackups(process.cwd())));
  for (const name of ["inspect", "verify"]) {
    command
      .command(`${name} <id>`)
      .description("Verify identity, scope and payload integrity")
      .action((id: string) => report(() => loadAssetBackup(process.cwd(), id)));
  }
  command
    .command("restore <id>")
    .description(
      "Preview a restore; execute only with the current review digest",
    )
    .option(
      "--replace-modified",
      "Preview explicit replacement of modified assets; preserve a recovery snapshot first",
    )
    .option("--review <sha256>", "Bind execution to the current preview")
    .option("-y, --yes", "Execute the reviewed restore")
    .action(
      (
        id: string,
        options: { replaceModified?: boolean; review?: string; yes?: boolean },
      ) =>
        report(() => {
          const root = process.cwd();
          if (!options.yes) return restoreAssetBackup(root, id, options);
          return withAblationProjectLock(getTransactionPaths(root), () => {
            if (loadAblationTransaction(root))
              throw new Error(
                "An ablation transaction exists; use trellis restore first.",
              );
            const recovery = loadAssetBackup(root, id).restore?.recovery;
            const other = listAssetBackups(root).find(
              (item) =>
                item.id !== id &&
                item.id !== recovery &&
                item.problem?.startsWith("Unresolved"),
            );
            if (other)
              throw new Error(
                `Another unresolved asset recovery exists: ${other.id}`,
              );
            return restoreAssetBackup(root, id, options);
          });
        }),
    );
  command
    .command("prune")
    .description(
      "Preview cleanup; retain three complete snapshots unless --all is explicit",
    )
    .option("--keep <count>", "Daily retention, at least three", "3")
    .option("--all", "Explicitly select every resolved complete snapshot")
    .option(
      "--include-legacy",
      "With --all, also select recognized old update snapshots and managed migration sidecars",
    )
    .option("-y, --yes", "Recheck and delete selected backups")
    .action(
      (options: {
        keep: string;
        all?: boolean;
        includeLegacy?: boolean;
        yes?: boolean;
      }) =>
        report(() => {
          const action = (): unknown => {
            const result = pruneAssetBackups(process.cwd(), {
              ...options,
              keep: Number(options.keep),
            });
            if (result.failed.length) process.exitCode = 1;
            return result;
          };
          return options.yes
            ? withAblationProjectLock(
                getTransactionPaths(process.cwd()),
                action,
              )
            : action();
        }),
    );
}
