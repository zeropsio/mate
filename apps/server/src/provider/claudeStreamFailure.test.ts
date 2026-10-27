import { describe, expect, it } from "vite-plus/test";

import { crashLines, describeClaudeStreamFailure, makeStderrTail } from "./claudeStreamFailure.ts";

// Fake secrets, built from parts: never a real-looking credential in the source.
const HEX40 = ["0123456789abcdef", "0123456789abcdef", "01234567"].join("");
const SHORT = ["Q7r8S9t0", "U1v2W3x4", "Y5z6"].join("");
const GH = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_");
const GH_PAT = ["github", "pat", `11ABCDEFG0123456789_${"abcdefghij".repeat(6)}`].join("_");
const ANT = ["sk", "ant", "oat01", "Z".repeat(60)].join("-");
const PASS = ["Sup3r", "S3cret", "Pass"].join("");
const BASIC = ["bWF0ZTpT", "dXAzclMzY3", "JldFBhc3M="].join("");

const exited = (code: number, tail = "") =>
  Object.assign(new Error(`Claude Code process exited with code ${code}${tail}`), {
    exitCode: code,
  });
const signalled = (signal: string) =>
  Object.assign(new Error(`Claude Code process terminated by signal ${signal}`), { signal });

const NEXT = "Send a message to pick up where it left off.";

/** What a Bun-built Claude Code writes to stderr as it aborts (its crash handler). */
const BUN_REPORT = (panic: string) =>
  [
    "============================================================",
    "Bun v1.3.2 (b131639c) Linux x64 (baseline)",
    "Linux Kernel v6.1.0 | glibc v2.36",
    "CPU: sse42 popcnt avx avx2",
    `Args: "claude" "--mcp-config" "{\\"zcp\\":{\\"headers\\":{\\"authorization\\":\\"Bearer ${HEX40}\\"}}}"`,
    "Features: jsc spawn(4) fetch(212) abort_signal(9)",
    "Elapsed: 3661042ms | User: 912345ms | Sys: 81234ms",
    "RSS: 1.95GB | Peak: 2.10GB | Commit: 1.95GB | Faults: 12 | Machine: 2.15GB",
    "",
    `panic(main thread): ${panic}`,
    "oh no: Bun has crashed. This indicates a bug in Bun, not your code.",
    "",
    "To send a redacted crash report to Bun's team,",
    "please file a GitHub issue using the link below:",
    "",
    ` https://bun.report/1.3.2/lr1b131639cAggggE+7X${"A".repeat(40)}`,
    "",
  ].join("\n");

describe("describeClaudeStreamFailure", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly error?: unknown;
    readonly stderr?: string;
    readonly defect?: boolean;
    readonly reason: string;
    readonly next?: string;
  }> = [
    {
      name: "a Node heap out of memory",
      error: exited(134),
      stderr:
        "<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n",
      reason: "Claude Code ran out of memory.",
    },
    {
      name: "Bun's own crash report, out of memory",
      error: signalled("SIGABRT"),
      stderr: `${BUN_REPORT("Bun has run out of memory.")}`,
      reason: "Claude Code ran out of memory.",
    },
    {
      name: "Bun's own crash report, a fault",
      error: signalled("SIGABRT"),
      stderr: `${BUN_REPORT("Segmentation fault at address 0x0")}`,
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "aborted with nothing on stderr",
      error: signalled("SIGABRT"),
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "killed by the system, an overloaded API line beside it",
      error: signalled("SIGKILL"),
      stderr: "API Error: 529 overloaded, retrying\n",
      reason: "Claude Code was stopped by the system, most often for lack of memory.",
    },
    {
      name: "an exit code over a stack that names a status",
      error: exited(1),
      stderr: "TypeError: x is undefined\n    at handleError (/$bunfs/root/claude:512:33)\n",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "an exit code over a line that says 500ms",
      error: exited(1),
      stderr: "Error: ENOENT: no such file, status 500ms\n",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "a signal over an MCP server's own hang-up",
      error: signalled("SIGTERM"),
      stderr: "[MCP] zcp: Error: socket hang up (recovered)\n",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "a signal over an MCP server's 502",
      error: signalled("SIGTERM"),
      stderr: 'MCP server "zcp" error: HTTP 502 Bad Gateway\n',
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "an exit over a parse error",
      error: exited(1),
      stderr: "SyntaxError: Unexpected token } in JSON at position 512\n",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "an expired sign-in",
      error: exited(1),
      stderr: "Error: OAuth token has expired. API Error: 401\n",
      reason: "Claude's sign-in has expired.",
      next: "Sign Claude in again, then send a message to pick up where it left off.",
    },
    {
      name: "a key the API refuses",
      error: exited(1),
      stderr: "Error: Invalid API key · Please run /login\n",
      reason: "Claude's sign-in has expired.",
      next: "Sign Claude in again, then send a message to pick up where it left off.",
    },
    {
      name: "the API stopped answering, no exit known",
      error: new Error("API Error: 529 Overloaded"),
      reason: "The Claude API stopped answering.",
    },
    {
      name: "a dropped connection, no exit known",
      error: new Error("stream closed"),
      stderr: "Error: socket hang up\n",
      reason: "The Claude API stopped answering.",
    },
    {
      name: "a dropped connection in the SDK's own error",
      error: new Error("socket hang up"),
      reason: "The Claude API stopped answering.",
    },
    {
      name: "a 5xx in a stack frame, no exit known",
      error: new Error("stream closed"),
      stderr: "    at Object.status500 (/srv/x.js:500:12)\n",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "our own failure to read its output",
      error: new TypeError("Cannot read properties of undefined (reading 'type')"),
      defect: true,
      reason: "Mate failed to read Claude's output.",
    },
    { name: "nothing to go on", reason: "Claude Code stopped unexpectedly." },
  ];
  it.each(
    Array.from(cases, ({ name, error, stderr, defect, reason, next }) => ({
      title: name,
      error,
      stderr,
      defect,
      reason,
      next,
    })),
  )("$title", ({ error, stderr, defect, reason, next }) => {
    const failure = describeClaudeStreamFailure({
      error,
      stderr: stderr ?? "",
      ...(defect ? { defect } : {}),
    });
    expect(failure.reason).toBe(reason);
    expect(failure.words).toBe(`${reason} ${next ?? NEXT}`);
  });

  it("logs the error's head, its code or signal, and its crash lines only", () => {
    const failure = describeClaudeStreamFailure({
      error: exited(1, `. stderr: Authorization: token ${HEX40}\nfatal: boom`),
      stderr: `password=${HEX40}\nTypeError: x is undefined\nrandom line ${PASS}\n`,
    });
    expect(failure.log).toEqual({
      error: "Claude Code process exited with code 1",
      exitCode: 1,
      signal: null,
      crashLines: ["TypeError: x is undefined"],
      stack: null,
    });
  });

  it("logs what Bun's crash report says, never its arguments or its link", () => {
    const failure = describeClaudeStreamFailure({
      error: signalled("SIGABRT"),
      stderr: BUN_REPORT("Bun has run out of memory."),
    });
    expect(failure.log).toEqual({
      error: "Claude Code process terminated by signal SIGABRT",
      exitCode: null,
      signal: "SIGABRT",
      crashLines: [
        "Bun v1.3.2 (b131639c) Linux x64 (baseline)",
        "Elapsed: 3661042ms | User: 912345ms | Sys: 81234ms",
        "RSS: 1.95GB | Peak: 2.10GB | Commit: 1.95GB | Faults: 12 | Machine: 2.15GB",
        "panic(main thread): Bun has run out of memory.",
        "oh no: Bun has crashed. This indicates a bug in Bun, not your code.",
      ],
      stack: null,
    });
  });

  it("logs a defect's own message and stack", () => {
    const defect = new TypeError("Cannot read properties of undefined (reading 'type')");
    const failure = describeClaudeStreamFailure({ error: defect, stderr: "", defect: true });
    expect(failure.log.error).toBe(
      "TypeError: Cannot read properties of undefined (reading 'type')",
    );
    expect(failure.log.stack).toContain("TypeError");
  });
});

describe("crashLines never lets a secret through", () => {
  const secrets = [HEX40, SHORT, GH, GH_PAT, ANT, PASS, BASIC, "horse"];
  const leaks: ReadonlyArray<string> = [
    `fatal: could not read from ${GH}`,
    `token ${GH_PAT}`,
    `Error: fetch https://mate:${PASS}@gitea.example.com/org/repo.git failed`,
    `Error: remote: https://oauth2:${HEX40}@gitea.example.com/x.git`,
    `Authorization: token ${HEX40}`,
    `Authorization: Basic ${BASIC}`,
    `cookie: a=1; session=${HEX40}`,
    `set-cookie: zsess=${HEX40}; Path=/; HttpOnly`,
    `{ ZEROPS_TOKEN: '${HEX40}', HOME: '/root' }`,
    `ZCP_API_KEY: ${HEX40}`,
    `{"ZEROPS_TOKEN":"${HEX40}"}`,
    `{"access_token":"${HEX40}","refresh_token":"${HEX40}x"}`,
    `{"client_secret":"${HEX40}"}`,
    `{"authorization":"token ${HEX40}"}`,
    `{"cookie":"zsess=${HEX40}"}`,
    `password=${HEX40}`,
    `GET /api/v1/repos?token=${HEX40} 500`,
    `PASSWORD="correct horse battery staple"`,
    `headers: { authorization: 'token ${HEX40}' }`,
    `HTTPS_PROXY=http://user:${HEX40}@proxy:3128`,
    `db_password=${SHORT}`,
    `storage_secretAccessKey=${SHORT}`,
    `zcp_apiKey=${SHORT}`,
    `db_connectionString=postgresql://db:${SHORT}@db:5432/db`,
    `"db_password": "${SHORT}"`,
    `Error: token=${SHORT}`,
    `TypeError: bad header "x-api-key": "${SHORT}"`,
    `Error: connect ECONNRESET https://user:${PASS}@host`,
    `FATAL ERROR: ${ANT}`,
    `API Error: 401 ${ANT}`,
    `Claude Code process exited with code 1. stderr: ${HEX40}`,
    `panic(main thread): token=${HEX40}`,
    `oh no: Bun has crashed ${GH}`,
    `Bun v1.3.2 (b131639c) Linux x64 ${ANT}`,
    `RSS: 1.95GB | ${PASS}`,
  ];
  it.each(Array.from(leaks, (line) => ({ title: line.slice(0, 48), line })))(
    "$title",
    ({ line }) => {
      const kept = crashLines(`${line}\n`).join("\n");
      for (const secret of secrets) expect(kept).not.toContain(secret);
    },
  );

  it("keeps the lines that say what crashed", () => {
    expect(
      crashLines(
        [
          "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
          "random chatter",
          "TypeError: x is undefined",
          "    at handleError (/srv/claude:512:33)",
          "Error: connect ECONNRESET 10.0.0.1:443",
          "API Error: 529 overloaded",
          "Claude Code process exited with code 134",
        ].join("\n"),
      ),
    ).toEqual([
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
      "TypeError: x is undefined",
      "Error: connect ECONNRESET 10.0.0.1:443",
      "API Error: 529 overloaded",
      "Claude Code process exited with code 134",
    ]);
  });

  it.each([
    ["KEY_".repeat(2048)],
    ["AUTH".repeat(2048)],
    ["ABCDEF0123456789".repeat(512)],
    [`"${"a".repeat(8190)}`],
    [`Error: ${"KEY_=".repeat(1600)}`],
    [`TypeError: ${":a".repeat(4000)}`],
  ])("reads a pathological line in linear time (%#)", (line) => {
    const started = performance.now();
    crashLines(`${line}\n`);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("makeStderrTail", () => {
  it("keeps whole lines only: a cut never starts mid-line", () => {
    const tail = makeStderrTail(64);
    tail.push(`${"x".repeat(20)}${ANT}\n`);
    expect(tail.text()).toBe("");
    tail.push("short\n");
    expect(tail.text()).toBe("short\n");
  });

  it("drops what came before its last reset", () => {
    const tail = makeStderrTail();
    tail.push("Error: socket hang up\n");
    tail.reset();
    tail.push("TypeError: new\n");
    expect(tail.text()).toBe("TypeError: new\n");
  });

  it("keeps the newest lines within its bound", () => {
    const tail = makeStderrTail(32);
    tail.push(`${"y".repeat(5000)}\nsecond\nthird\n`);
    expect(tail.text()).toBe("second\nthird\n");
  });
});
