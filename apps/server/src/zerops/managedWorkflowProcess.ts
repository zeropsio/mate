// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalTimers:off -- owned child stdio JSON-RPC adapter with captured-process cleanup timers.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import type { ToolInvocationResult } from "../spi/toolInvocation.ts";

export const INVOCATION_META = "io.zerops.mate/invocation";
export interface InvocationEnvelope {
  readonly v: 1;
  readonly id: string;
  readonly scope:
    | { readonly kind: "manual" }
    | { readonly kind: "task"; readonly taskId: string; readonly assignment: string };
}
const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

/** One invocation owns one private child; no shared stdin or mutable call context. */
export const managedWorkflowProcess = (
  input: unknown,
  invocation: InvocationEnvelope | undefined,
  signal: AbortSignal,
  options: {
    readonly cwd: string;
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
  },
): Promise<ToolInvocationResult> =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      options.command ?? "zcp",
      [...(options.args ?? []), "serve", "--mate-invocation"],
      { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = NodeReadline.createInterface({ input: child.stdout });
    let answer: ToolInvocationResult | undefined;
    let failure: Error | undefined;
    let output = 0;
    let closing = false;
    let stage: "initialize" | "call" | "done" = "initialize";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const close = (error?: Error) => {
      if (error !== undefined) failure ??= error;
      if (closing) return;
      closing = true;
      stage = "done";
      lines.close();
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.end();
      // Only the captured child is terminated. Completion waits for its close receipt.
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2000);
      if (error !== undefined) child.kill("SIGTERM");
    };
    const abort = () => close(new Error("managed invocation canceled"));
    const timeout = setTimeout(() => close(new Error("managed invocation timed out")), 5 * 60_000);
    const write = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.on("error", () => close(new Error("managed invocation pipe closed")));
    child.stderr.on("data", () => {
      /* Child diagnostics may contain tool arguments or credentials. */
    });
    child.stdout.on("data", (bytes: Buffer) => {
      output += bytes.byteLength;
      if (output > 4 * 1024 * 1024) close(new Error("managed zcp response exceeded its bound"));
    });
    child.once("error", () => close(new Error("managed zcp could not start")));
    child.once("close", () => {
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
      lines.close();
      if (failure !== undefined) reject(failure);
      else if (answer !== undefined) resolve(answer);
      else reject(new Error("managed zcp exited without a tool receipt"));
    });
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return close(new Error("managed zcp returned invalid JSON-RPC"));
      }
      if (!record(message) || closing) return;
      if (message.id === 1) {
        if (stage !== "initialize") return;
        const result = message.result;
        if (
          !record(result) ||
          !record(result.capabilities) ||
          !record(result.capabilities.experimental) ||
          result.capabilities.experimental[INVOCATION_META] !== 1
        ) {
          return close(new Error("zcp does not support owned invocation context"));
        }
        if (invocation === undefined) {
          answer = { text: "", isError: false };
          close();
          return;
        }
        stage = "call";
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "zerops_workflow",
            arguments: input,
            _meta: { [INVOCATION_META]: invocation },
          },
        });
      } else if (message.id === 2) {
        if (stage !== "call")
          return close(new Error("managed zcp returned an unexpected tool receipt"));
        const result = message.result;
        if (!record(result) || !Array.isArray(result.content))
          return close(new Error("managed zcp refused the tool invocation"));
        const text = result.content
          .flatMap((part: unknown) =>
            record(part) && part.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("\n");
        answer = { text, isError: result.isError === true };
        close();
      }
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else
      write({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "zerops-mate-owned-workflow", version: "1" },
        },
      });
  });

export class ManagedWorkflowFailed extends Data.TaggedError("ManagedWorkflowFailed")<{}> {}

/** Cancellation finalizes and joins the captured child before the owned effect ends. */
export const managedWorkflow = (
  input: unknown,
  invocation: InvocationEnvelope | undefined,
  options: Parameters<typeof managedWorkflowProcess>[3],
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const owned = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const abort = new AbortController();
          const result = managedWorkflowProcess(input, invocation, abort.signal, options);
          // Attach a rejection observer before cancellation can interrupt the await below.
          void result.catch(() => undefined);
          return { abort, result };
        }),
        (owned) =>
          Effect.promise(async () => {
            owned.abort.abort();
            await owned.result.catch(() => undefined);
          }),
      );
      return yield* Effect.tryPromise({
        try: () => owned.result,
        catch: () => new ManagedWorkflowFailed(),
      });
    }),
  );

export const managedWorkflowReady = (options: Parameters<typeof managedWorkflowProcess>[3]) =>
  managedWorkflow(undefined, undefined, options).pipe(
    Effect.timeout("10 seconds"),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
