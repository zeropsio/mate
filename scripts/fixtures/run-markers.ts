// @effect-diagnostics nodeBuiltinImport:off -- reads process environments the way zboard's reaper does.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

/** The PIDs of this user's processes whose environment carries `marker`, read as zboard's reaper does. */
export const processesCarrying = (marker: string): number[] => {
  const carries = (value: string) => value.split(",").includes(marker);
  // Linux exposes every environment under /proc; macOS only through ps.
  if (!NodeFS.existsSync("/proc/self/environ")) {
    const listed = NodeChildProcess.spawnSync(
      "/bin/ps",
      ["-E", "-ww", "-u", String(process.getuid!()), "-o", "pid=,command="],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return listed.stdout.split("\n").flatMap((line) => {
      const found = /^\s*(\d+)\s.*(?:^|\s)ZBOARD_RUN_MARKERS=([0-9a-f,]+)(?:\s|$)/u.exec(line);
      return found && carries(found[2]!) ? [Number(found[1])] : [];
    });
  }
  return NodeFS.readdirSync("/proc").flatMap((entry) => {
    if (!/^\d+$/u.test(entry)) return [];
    try {
      const environ = NodeFS.readFileSync(`/proc/${entry}/environ`, "utf8").split("\0");
      return environ.some(
        (field) => field.startsWith("ZBOARD_RUN_MARKERS=") && carries(field.slice(19)),
      )
        ? [Number(entry)]
        : [];
    } catch {
      return [];
    }
  });
};
