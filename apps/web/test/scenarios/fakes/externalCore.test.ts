// @effect-diagnostics nodeBuiltinImport:off -- process and network are the fixture's public boundary.
import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { emptyWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import { startExternalCore } from "../harness/externalCore.ts";
import { serve } from "../harness/http.ts";

const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

it.effect.each([0, 23])(
  "external Core uses the caller's Zerops API and awaits shutdown with exit code %s",
  (exitCode) =>
    Effect.gen(function* () {
      let stopped = false;
      const api = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve(() => {
            stopped = true;
            return { body: {} };
          }),
        ),
        (api) => Effect.promise(api.close),
      );
      const script = `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ api: process.env.HQ_ZEROPS_API }));
      });
      server.listen(0, "127.0.0.1", () => {
        process.stdout.write(JSON.stringify({ origin: "http://127.0.0.1:" + server.address().port }) + "\\n");
      });
      process.stdin.resume();
      process.stdin.once("end", async () => {
        await fetch(process.env.HQ_ZEROPS_API + "/stopped");
        server.close(() => { process.exitCode = ${exitCode}; });
      });
    `;
      const result = yield* Effect.exit(
        Effect.gen(function* () {
          const core = yield* startExternalCore(`${quote(process.execPath)} -e ${quote(script)}`, {
            baseUrl: api.origin,
            world: emptyWorld(),
          });
          const answer = yield* core.call("GET", "/");
          expect(answer.status).toBe(200);
          expect(answer.body).toEqual({ api: api.origin });
        }).pipe(Effect.scoped),
      );
      if (exitCode === 0) expect(Exit.isSuccess(result)).toBe(true);
      else {
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result))
          expect(Cause.pretty(result.cause)).toContain("External Core exited (23)");
      }
      expect(stopped, "the command's shutdown receipt arrives before the scope closes").toBe(true);
    }).pipe(Effect.scoped),
);
