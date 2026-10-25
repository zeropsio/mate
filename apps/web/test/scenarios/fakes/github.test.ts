// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off -- the fake's HTTP and Git surfaces against loopback.
import { expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import { startGithubFake } from "./github.ts";

const rig = Effect.fn("github.rig")(function* () {
  const github = yield* Effect.acquireRelease(Effect.promise(startGithubFake), (github) =>
    Effect.promise(github.close),
  );
  return { github, repository: github.addRepository("acme/shop") };
});
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, headers: Record<string, string>) =>
  Effect.promise(async () => {
    const response = await fetch(url, { headers });
    return { status: response.status, body: (await response.json()) as unknown };
  });

it.effect(
  "a repository answers its metadata, branch rules and an unpushed branch's CI reads to its own token only",
  () =>
    Effect.gen(function* () {
      const { github, repository } = yield* rig();
      const metadata = yield* get(`${github.api}/repos/acme/shop`, bearer(repository.token));
      expect(metadata).toEqual({
        status: 200,
        body: { id: repository.id, full_name: "acme/shop", archived: false, private: true },
      });
      expect(
        yield* get(`${github.api}/repos/acme/shop/rules/branches/main`, bearer(repository.token)),
      ).toEqual({ status: 200, body: [] });
      const ci = (path: string) =>
        get(`${github.api}/repos/acme/shop${path}`, bearer(repository.token));
      expect(yield* ci("/commits/mate%2Fstage/check-runs?per_page=1")).toEqual({
        status: 422,
        body: { message: "No commit found for SHA: mate/stage" },
      });
      expect(yield* ci("/commits/main/status?per_page=1")).toEqual({
        status: 404,
        body: { message: "Ref not found" },
      });
      expect(yield* ci("/actions/runs?per_page=1&branch=main")).toEqual({
        status: 200,
        body: { total_count: 0, workflow_runs: [] },
      });
      expect(github.unmatched()).toEqual([]);
      expect((yield* get(`${github.api}/repos/acme/shop`, bearer("other"))).status).toBe(401);
      expect((yield* get(`${github.api}/repos/acme/none`, bearer(repository.token))).status).toBe(
        404,
      );
    }),
);

it.effect("git reads and the receive-pack discovery are served over smart HTTP", () =>
  Effect.gen(function* () {
    const { github, repository } = yield* rig();
    const advertisement = yield* Effect.promise(() =>
      fetch(`${github.gitUrl}acme/shop.git/info/refs?service=git-receive-pack`, {
        headers: {
          authorization: `Basic ${Buffer.from(`x-access-token:${repository.token}`).toString("base64")}`,
        },
      }),
    );
    expect(advertisement.status).toBe(200);
    expect(advertisement.headers.get("content-type")).toBe(
      "application/x-git-receive-pack-advertisement",
    );
    expect((yield* Effect.promise(() => advertisement.text())).startsWith("001f# service=")).toBe(
      true,
    );
    const refused = yield* Effect.promise(() =>
      fetch(`${github.gitUrl}acme/shop.git/info/refs?service=git-receive-pack`),
    );
    expect(refused.status).toBe(401);
    // Asynchronous: the fake serves from this very process.
    const listed = yield* Effect.promise(
      () =>
        new Promise<number | null>((resolve) =>
          NodeChildProcess.spawn("git", [
            "-c",
            `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${repository.token}`).toString("base64")}`,
            "ls-remote",
            `${github.gitUrl}acme/shop.git`,
          ]).on("close", resolve),
        ),
    );
    expect(listed).toBe(0);
  }),
);
