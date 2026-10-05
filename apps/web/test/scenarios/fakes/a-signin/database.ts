// @effect-diagnostics nodeBuiltinImport:off -- fault injection targets only disposable localhost Postgres.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { deadline } from "../../harness/http.ts";

/** Keep real Core running while its session relation temporarily cannot be read. */
export function sessionDatabase(databaseUrl: string, fixtureSession: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1")
    throw new Error("Session faults require the disposable localhost database");
  const config = NodeChildProcess.spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const bin =
    process.env.MATE_PG_BIN ?? (config.status === 0 ? config.stdout.trim() : "/opt/homebrew/bin");
  const query = (sql: string) =>
    new Promise<string>((resolve, reject) => {
      NodeChildProcess.execFile(
        NodePath.join(bin, "psql"),
        [databaseUrl, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
        { timeout: 10_000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
      );
    });
  let beforeFault: number | undefined;
  const rollbacks = async () =>
    Number(
      await query("SELECT xact_rollback FROM pg_stat_database WHERE datname = current_database()"),
    );
  return {
    unavailable: async () => {
      beforeFault = await rollbacks();
      await query("ALTER TABLE public.hq_session RENAME TO scenario_unavailable_session");
    },
    sawSessionRead: async () => {
      const baseline = beforeFault;
      if (baseline === undefined) throw new Error("Start the session-read fault first");
      let waiting = true;
      try {
        await deadline(
          (async () => {
            while (waiting) {
              const observed = await rollbacks();
              waiting = waiting && observed <= baseline;
            }
          })(),
          "Core attempted a read while its session relation was unavailable",
        );
      } finally {
        waiting = false;
      }
    },
    returns: () => query("ALTER TABLE public.scenario_unavailable_session RENAME TO hq_session"),
    expires: () =>
      query(
        `UPDATE public.hq_session SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL AND token_hash <> '${NodeCrypto.createHash("sha256").update(fixtureSession).digest("hex")}'`,
      ),
  };
}
