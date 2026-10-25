// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- fake PostgreSQL binaries for the supervisor's rebuild cases.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * One script behind the initdb, pg_ctl, postgres and psql shims a test writes to MATE_PG_BIN.
 * State lives in the data directory like PostgreSQL's own: `global/pg_control` other than
 * "valid" makes start PANIC, a `crashed` file makes it log crash recovery, and each database is
 * a directory under `base`.
 */
const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1]!;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};
const postmasterOf = (data: string) => {
  try {
    return Number(
      NodeFS.readFileSync(NodePath.join(data, "postmaster.pid"), "utf8").split("\n")[0],
    );
  } catch {
    return undefined;
  }
};
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (command === "initdb") {
  const data = flag("-D");
  if (NodeFS.existsSync(data) && NodeFS.readdirSync(data).length > 0)
    fail(`initdb: error: directory "${data}" exists but is not empty`);
  NodeFS.mkdirSync(NodePath.join(data, "base"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(data, "global"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(data, "PG_VERSION"), "17\n");
  NodeFS.writeFileSync(NodePath.join(data, "global", "pg_control"), "valid");
} else if (command === "pg_ctl") {
  const data = flag("-D");
  const running = postmasterOf(data);
  if (args.at(-1) === "start") {
    const log = (line: string) => NodeFS.appendFileSync(flag("-l"), `${line}\n`);
    if (running !== undefined && alive(running)) {
      log(`FATAL:  lock file "postmaster.pid" already exists`);
      fail("pg_ctl: could not start server");
    }
    if (NodeFS.readFileSync(NodePath.join(data, "global", "pg_control"), "utf8") !== "valid") {
      log("PANIC:  could not locate a valid checkpoint record");
      fail("pg_ctl: could not start server");
    }
    if (NodeFS.existsSync(NodePath.join(data, "crashed")))
      log("LOG:  database system was not properly shut down; automatic recovery in progress");
    const postmaster = NodeChildProcess.spawn(
      process.execPath,
      [import.meta.filename, "postgres", "-D", data],
      { detached: true, stdio: "ignore" },
    );
    postmaster.unref();
    NodeFS.writeFileSync(NodePath.join(data, "postmaster.pid"), `${postmaster.pid}\n${data}\n`);
    log("LOG:  database system is ready to accept connections");
  } else {
    if (running === undefined || !alive(running)) fail("pg_ctl: no server running");
    process.kill(running!, args.includes("immediate") ? "SIGQUIT" : "SIGTERM");
    while (alive(running!)) pause(10);
  }
} else if (command === "postgres") {
  const data = flag("-D");
  setInterval(() => {}, 1 << 30);
  process.once("SIGTERM", () => {
    NodeFS.rmSync(NodePath.join(data, "postmaster.pid"), { force: true });
    process.exit(0);
  });
} else if (command === "psql") {
  const data = NodePath.join(process.env["MATE_TEST_PG_HOME"]!, "data");
  const running = postmasterOf(data);
  if (running === undefined || !alive(running)) fail("psql: error: connection refused");
  const base = NodePath.join(data, "base");
  const query = args.at(-1)!;
  const dropped = /^DROP DATABASE (?:IF EXISTS )?(\w+)/u.exec(query)?.[1];
  const created = /^CREATE DATABASE (\w+)/u.exec(query)?.[1];
  if (query.startsWith("SELECT datname FROM pg_database"))
    for (const name of NodeFS.readdirSync(base))
      if (name.startsWith("mate_test_")) process.stdout.write(`${name}\n`);
  if (dropped !== undefined) NodeFS.rmSync(NodePath.join(base, dropped), { recursive: true });
  if (created !== undefined) NodeFS.mkdirSync(NodePath.join(base, created));
} else fail(`fake-postgres: unknown command ${command}`);
