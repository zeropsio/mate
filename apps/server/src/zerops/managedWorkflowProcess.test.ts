// @effect-diagnostics nodeBuiltinImport:off -- disposable real child process and its owned files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  managedWorkflow,
  managedWorkflowReady,
  INVOCATION_META,
  type InvocationEnvelope,
} from "./managedWorkflowProcess.ts";

const scope: InvocationEnvelope = {
  v: 1,
  id: "a".repeat(64),
  scope: { kind: "task", taskId: "actual-task", assignment: "9007199254740993" },
};
const program = `
const fs=require('node:fs');
let count=0;
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{
 const req=JSON.parse(line);
 if(req.method==='initialize') {
  const answer=JSON.stringify({jsonrpc:'2.0',id:1,result:{capabilities:{experimental:{'io.zerops.mate/invocation':Number(process.env.CAPABILITY)}}}});
  console.log(answer);if(process.env.DUPLICATE_INIT==='1')console.log(answer);
 }
 if(req.method==='tools/call') {
  fs.writeFileSync(process.env.MARKER+'.tmp',JSON.stringify({pid:process.pid,request:req,count:++count}));
  fs.renameSync(process.env.MARKER+'.tmp',process.env.MARKER);
  if(process.env.HOLD==='1') return;
  console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:JSON.stringify(req.params)}]}}));
 }
});
`;

const fixture = Effect.acquireRelease(
  Effect.promise(() =>
    NodeFS.promises.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-managed-workflow-")),
  ),
  (path) => Effect.promise(() => NodeFS.promises.rm(path, { recursive: true, force: true })),
);

describe("owned workflow process", () => {
  it.effect("readiness proves the managed handshake without calling a workflow", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fixture;
        const marker = NodePath.join(cwd, "request.json");
        const script = NodePath.join(cwd, "fixture.cjs");
        yield* Effect.promise(() =>
          NodeFS.promises.writeFile(
            script,
            `process.env.CAPABILITY='1';process.env.MARKER=${JSON.stringify(marker)};${program}`,
          ),
        );
        expect(
          yield* managedWorkflowReady({ cwd, command: process.execPath, args: [script] }),
        ).toBe(true);
        expect(NodeFS.existsSync(marker)).toBe(false);
        yield* Effect.promise(() =>
          NodeFS.promises.writeFile(
            script,
            `process.env.CAPABILITY='0';process.env.MARKER=${JSON.stringify(marker)};${program}`,
          ),
        );
        expect(
          yield* managedWorkflowReady({ cwd, command: process.execPath, args: [script] }),
        ).toBe(false);
        expect(NodeFS.existsSync(marker)).toBe(false);
      }),
    ),
  );
  it.effect("a duplicate initialization reply cannot dispatch the same mutation twice", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fixture;
        const script = NodePath.join(cwd, "fixture.cjs");
        const marker = NodePath.join(cwd, "request.json");
        yield* Effect.promise(() =>
          NodeFS.promises.writeFile(
            script,
            `process.env.CAPABILITY='1';process.env.DUPLICATE_INIT='1';process.env.MARKER=${JSON.stringify(marker)};${program}`,
          ),
        );
        yield* managedWorkflow({ action: "open" }, scope, {
          cwd,
          command: process.execPath,
          args: [script],
        });
        const actual = JSON.parse(
          yield* Effect.promise(() => NodeFS.promises.readFile(marker, "utf8")),
        );
        expect(actual.count).toBe(1);
      }),
    ),
  );
  it.effect(
    "an oversized refused response closes its decoder while joining a termination-ignoring child",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = yield* fixture;
          const script = NodePath.join(cwd, "fixture.cjs");
          const marker = NodePath.join(cwd, "closed.json");
          const flood = `
const fs=require('node:fs');
process.on('SIGTERM',()=>{});
process.stdout.on('error',error=>{fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({code:error.code,pid:process.pid}));process.exit(0)});
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const req=JSON.parse(line);
if(req.method==='initialize')console.log(JSON.stringify({id:1,result:{capabilities:{experimental:{'io.zerops.mate/invocation':1}}}}));
if(req.method==='tools/call') {const bytes=Buffer.alloc(128*1024,'x');let remaining=8*1024*1024;const more=()=>{while(remaining>0){remaining-=bytes.length;if(!process.stdout.write(bytes)){process.stdout.once('drain',more);return}}};more()}
});`;
          yield* Effect.promise(() => NodeFS.promises.writeFile(script, flood));
          expect(
            (yield* Effect.result(
              managedWorkflow({}, scope, { cwd, command: process.execPath, args: [script] }),
            ))._tag,
          ).toBe("Failure");
          expect(NodeFS.existsSync(marker)).toBe(true);
          const actual = JSON.parse(
            yield* Effect.promise(() => NodeFS.promises.readFile(marker, "utf8")),
          );
          expect(actual.code).toBe("EPIPE");
          expect(() => process.kill(actual.pid, 0)).toThrow();
        }),
      ),
  );
  it.effect(
    "the private initialized child receives unchanged model arguments and only committed sideband",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = yield* fixture;
          const script = NodePath.join(cwd, "fixture.cjs");
          const marker = NodePath.join(cwd, "request.json");
          yield* Effect.promise(() =>
            NodeFS.promises.writeFile(
              script,
              `process.env.CAPABILITY='1';process.env.MARKER=${JSON.stringify(marker)};${program}`,
            ),
          );
          const input = {
            action: "open",
            title: "Actual work",
            _meta: { scope: "model supplied" },
          };
          const result = yield* managedWorkflow(input, scope, {
            cwd,
            command: process.execPath,
            args: [script],
          });
          const params = JSON.parse(result.text);
          expect(params.arguments).toEqual(input);
          expect(params._meta).toEqual({ [INVOCATION_META]: scope });
          expect(result.isError).toBe(false);
          const request = JSON.parse(
            yield* Effect.promise(() => NodeFS.promises.readFile(marker, "utf8")),
          );
          expect(() => process.kill(request.pid, 0)).toThrow();
        }),
      ),
  );
  it.effect("an older zcp cannot receive a context-required workflow call", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fixture;
        const script = NodePath.join(cwd, "fixture.cjs");
        const marker = NodePath.join(cwd, "request.json");
        yield* Effect.promise(() =>
          NodeFS.promises.writeFile(
            script,
            `process.env.CAPABILITY='0';process.env.MARKER=${JSON.stringify(marker)};${program}`,
          ),
        );
        expect(
          (yield* Effect.result(
            managedWorkflow({}, scope, { cwd, command: process.execPath, args: [script] }),
          ))._tag,
        ).toBe("Failure");
        expect(NodeFS.existsSync(marker)).toBe(false);
      }),
    ),
  );
  it.effect("interrupting an admitted tool joins its captured child before the owner ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fixture;
        const script = NodePath.join(cwd, "fixture.cjs");
        const marker = NodePath.join(cwd, "request.json");
        yield* Effect.promise(() =>
          NodeFS.promises.writeFile(
            script,
            `process.env.CAPABILITY='1';process.env.HOLD='1';process.env.MARKER=${JSON.stringify(marker)};${program}`,
          ),
        );
        // Atomic rename is the actual child boundary receipt, subscribed before it starts.
        const entered = yield* Effect.acquireRelease(
          Effect.sync(() => {
            let complete!: () => void;
            const ready = new Promise<void>((resolve) => {
              complete = resolve;
            });
            const watcher = NodeFS.watch(cwd, (_event, name) => {
              if (name === "request.json") complete();
            });
            return { ready, watcher };
          }),
          (owned) => Effect.sync(() => owned.watcher.close()),
        );
        const fiber = yield* Effect.forkScoped(
          managedWorkflow({}, scope, { cwd, command: process.execPath, args: [script] }),
        );
        yield* Effect.promise(() => entered.ready);
        const actual = JSON.parse(
          yield* Effect.promise(() => NodeFS.promises.readFile(marker, "utf8")),
        );
        yield* Fiber.interrupt(fiber);
        expect(() => process.kill(actual.pid, 0)).toThrow();
      }),
    ),
  );
});
