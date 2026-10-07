import fs from "node:fs";

/** Linux birth identity; unsupported or unreadable hosts cannot authorize orphan signals. */
export function readProcessIdentity(pid: number): string | undefined {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0)
    return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    const ticks = fields[19];
    if (!ticks || !/^\d+$/.test(ticks)) return undefined;
    const boot = fs
      .readFileSync("/proc/sys/kernel/random/boot_id", "utf-8")
      .trim();
    return `${pid}:${boot}:${ticks}`;
  } catch {
    return undefined;
  }
}
