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
  // A backend reports a failed read to the statistics views only seconds later when it idles, so
  // the read's receipt is a sequence step, which the read's rollback does not undo.
  const reads = "SELECT is_called FROM public.scenario_session_reads";
  return {
    unavailable: () =>
      query(`ALTER TABLE public.hq_session RENAME TO scenario_unavailable_session;
        CREATE SEQUENCE public.scenario_session_reads;
        CREATE FUNCTION public.scenario_session_unavailable() RETURNS boolean
          LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
          BEGIN
            PERFORM nextval('public.scenario_session_reads');
            RAISE EXCEPTION 'scenario: the session relation is unavailable';
          END $$;
        CREATE VIEW public.hq_session AS SELECT * FROM public.scenario_unavailable_session
          WHERE public.scenario_session_unavailable();
        GRANT SELECT ON public.hq_session TO PUBLIC`),
    sawSessionRead: async () => {
      let waiting = true;
      try {
        await deadline(
          (async () => {
            while (waiting) waiting = (await query(reads)) !== "t";
          })(),
          "Core attempted a read while its session relation was unavailable",
        );
      } finally {
        waiting = false;
      }
    },
    returns: () =>
      query(`DROP VIEW public.hq_session;
        DROP FUNCTION public.scenario_session_unavailable();
        DROP SEQUENCE public.scenario_session_reads;
        ALTER TABLE public.scenario_unavailable_session RENAME TO hq_session`),
    expires: () =>
      query(
        `UPDATE public.hq_session SET expires_at = now() - interval '1 second' WHERE token_hash <> '${NodeCrypto.createHash("sha256").update(fixtureSession).digest("hex")}'`,
      ),
  };
}
