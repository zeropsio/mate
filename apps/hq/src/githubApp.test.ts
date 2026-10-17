// @effect-diagnostics nodeBuiltinImport:off -- the tests sign GitHub's webhook and check the app's JWT.
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import type { HqGithubManifestView, HqGithubView } from "@t3tools/shared/hqGithub";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import {
  GITHUB_TOKEN,
  attention,
  connectedRepo,
  deliver,
  issueEvent,
  mateLinked,
  overviewAt,
} from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  GITHUB_APP_EVENTS,
  GITHUB_APP_PERMISSIONS,
  LANDING_WORDS,
  appJwt,
  trustedReturn,
} from "./githubApp.ts";
import { githubMirrorAbsentLayer } from "./githubMirror.ts";
import { TASK_SOURCES_SINCE } from "./mateTasks.ts";

const RETURN = "https://mate.zerops.io/settings/automation";
/** A fake Nebius key, built from parts so no scanner takes it for one. */
const NEBIUS_KEY = ["v1", "fake", "nebius", "key", "0123456789"].join(".");

/**
 * A Core with the application `Tea Shop`, and GitHub faked. The fake GitHub has no git, so the
 * mirror is stood in: what following GitHub does on connecting is the mirror's own tests'.
 */
const appCore = Effect.gen(function* () {
  const github = yield* githubFake;
  const core = yield* startCore(true, {
    githubApi: github.url,
    githubMirror: githubMirrorAbsentLayer,
  });
  yield* untilHealth(core.call, "active");
  const owner = yield* sessionFor(core.call, "door-owner");
  const made = yield* core.call("POST", "/api/apps", {
    session: owner,
    body: { name: "Tea Shop" },
  });
  const appId = (made.body as { readonly id: string }).id;
  return { ...core, github, owner, appId };
});
type AppCore = Effect.Success<typeof appCore>;

/** The manifest an owner asks for, for the organization `acme`. */
const manifestFor = (core: AppCore, owner: string | null = "acme") =>
  Effect.gen(function* () {
    const answer = yield* core.call("POST", "/api/org/github/manifest", {
      session: core.owner,
      body: { owner, name: "Tea Shop Mate", returnTo: RETURN },
    });
    assert.strictEqual(answer.status, 200);
    const view = answer.body as HqGithubManifestView;
    return { ...view, manifest: JSON.parse(view.manifest) as Record<string, unknown> };
  });

/**
 * The app made and installed on `acme/tea-shop` through GitHub's pages, as the person's browser
 * goes: the state of that trip, and where the app's events are delivered.
 */
const connected = (core: AppCore) =>
  Effect.gen(function* () {
    core.github.state.installations.set(7001, {
      account: "acme",
      repositories: [{ id: 501, full_name: "acme/tea-shop" }],
    });
    const { state, manifest } = yield* manifestFor(core);
    const created = yield* core.call("GET", `/api/github/app/created?code=code-1&state=${state}`);
    assert.strictEqual(created.status, 302);
    const installed = yield* core.call(
      "GET",
      `/api/github/app/installed?installation_id=7001&setup_action=install&state=${state}`,
    );
    const hook = manifest["hook_attributes"] as { readonly url: string };
    return {
      state,
      installed,
      hook: { path: new URL(hook.url).pathname, secret: core.github.state.app.webhookSecret },
    };
  });

const viewOf = (core: AppCore) =>
  Effect.map(
    core.call("GET", "/api/org/github", { session: core.owner }),
    (answer) => answer.body as HqGithubView,
  );

describe("the organization's GitHub app", () => {
  it("the app's JWT is signed with its private key, and its public key verifies it", () => {
    const keys = NodeCrypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const now = Date.UTC(2026, 9, 17, 12);
    const jwt = appJwt(42, Redacted.make(keys.privateKey), now);
    const [header, payload, signature] = jwt.split(".");
    assert.isTrue(
      NodeCrypto.verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    );
    assert.deepStrictEqual(JSON.parse(Buffer.from(header!, "base64url").toString()), {
      alg: "RS256",
      typ: "JWT",
    });
    // Issued a minute back against clock drift; good for nine minutes, below GitHub's ten.
    assert.deepStrictEqual(JSON.parse(Buffer.from(payload!, "base64url").toString()), {
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
      iss: 42,
    });
  });

  it.each([
    [RETURN, RETURN],
    ["http://localhost:5733/settings/automation", "http://localhost:5733/settings/automation"],
    [
      "https://zcp-1a2b.prg1.zerops.app/mate/settings",
      "https://zcp-1a2b.prg1.zerops.app/mate/settings",
    ],
    ["https://evil.test/settings/automation?x=1", "https://mate.zerops.io/settings/automation?x=1"],
    ["not a url", "https://mate.zerops.io/settings/automation"],
  ])("the browser goes back from GitHub to %s only on a Mate origin", (asked, back) => {
    assert.strictEqual(trustedReturn(asked), back);
  });

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "the manifest asks GitHub for the organization's own app: HQ's addresses, the permissions and events Mate needs, one state for the trip",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { postUrl, state, manifest } = yield* manifestFor(core);
          assert.strictEqual(
            postUrl,
            `https://github.com/organizations/acme/settings/apps/new?state=${state}`,
          );
          const hook = manifest["hook_attributes"] as { url: string; active: boolean };
          assert.match(
            hook.url,
            /^https:\/\/hqzone\.prg1-zerops\.zone\/api\/github\/app\/webhook\/[\w-]{20,}$/u,
          );
          assert.deepInclude(manifest, {
            name: "Tea Shop Mate",
            url: "https://mate.zerops.io",
            redirect_url: "https://hqzone.prg1-zerops.zone/api/github/app/created",
            setup_url: "https://hqzone.prg1-zerops.zone/api/github/app/installed",
            setup_on_update: true,
            public: false,
          });
          assert.deepStrictEqual(manifest["default_permissions"], {
            contents: "write",
            pull_requests: "write",
            issues: "write",
            metadata: "read",
            checks: "read",
            statuses: "read",
            actions: "read",
          });
          assert.deepStrictEqual(manifest["default_permissions"], GITHUB_APP_PERMISSIONS);
          assert.deepStrictEqual(manifest["default_events"], [...GITHUB_APP_EVENTS]);
          // The person's own account, and a second manifest naming the same webhook.
          const own = yield* manifestFor(core, null);
          assert.strictEqual(
            own.postUrl,
            `https://github.com/settings/apps/new?state=${own.state}`,
          );
          assert.notStrictEqual(own.state, state);
          assert.deepStrictEqual(own.manifest["hook_attributes"], hook);
        }),
    );

    it.effect("only an owner or admin of the organization may make or forget the app", () =>
      Effect.gen(function* () {
        const core = yield* appCore;
        for (const door of ["door-dev", "door-reader"]) {
          const session = yield* sessionFor(core.call, door);
          const asked = yield* core.call("POST", "/api/org/github/manifest", {
            session,
            body: { owner: "acme", name: "Tea Shop Mate", returnTo: RETURN },
          });
          assert.strictEqual(asked.status, 403);
          const forgotten = yield* core.call("DELETE", "/api/org/github", { session });
          assert.strictEqual(forgotten.status, 403);
          // Any member reads whether the organization has one.
          const read = yield* core.call("GET", "/api/org/github", { session });
          assert.deepStrictEqual(read.body, { state: "none" });
        }
      }),
    );

    it.effect(
      "GitHub's return keeps the app, its secrets sealed, and sends the browser on to install it",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { state } = yield* manifestFor(core);
          const created = yield* core.call(
            "GET",
            `/api/github/app/created?code=code-1&state=${state}`,
          );
          assert.strictEqual(created.status, 302);
          assert.strictEqual(
            created.headers.get("location"),
            `https://github.com/apps/tea-shop-mate/installations/new?state=${state}`,
          );
          assert.deepStrictEqual(yield* viewOf(core), {
            state: "connected",
            slug: "tea-shop-mate",
            botLogin: "tea-shop-mate[bot]",
            owner: "acme",
            appUrl: "https://github.com/apps/tea-shop-mate",
            installUrl: "https://github.com/apps/tea-shop-mate/installations/new",
            installations: [],
          });
          const [row] = yield* rowsWhere(
            core.url,
            "SELECT pem_sealed, secret_sealed, client_secret_sealed FROM hq_github_app",
            (rows) => rows.length === 1,
          );
          const kept = Object.values(row!).map((value) =>
            Buffer.from(value as Uint8Array).toString("latin1"),
          );
          for (const secret of [
            "PRIVATE KEY",
            core.github.state.app.webhookSecret,
            core.github.state.app.clientSecret,
          ])
            assert.isFalse(kept.some((bytes) => bytes.includes(secret)));
          const read = JSON.stringify(
            (yield* core.call("GET", "/api/org/github", {
              session: core.owner,
            })).body,
          );
          assert.notInclude(read, "PRIVATE KEY");
          assert.notInclude(read, core.github.state.app.webhookSecret);
        }),
    );

    it.effect(
      "a return with a forged or spent state keeps no app and says so on a page with the way back",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const forged = yield* core.call(
            "GET",
            "/api/github/app/created?code=code-1&state=forged",
          );
          assert.strictEqual(forged.status, 400);
          assert.include(forged.headers.get("content-type"), "text/html");
          assert.include(forged.body as string, LANDING_WORDS.expired.replaceAll("'", "&#39;"));
          assert.include(
            forged.body as string,
            'href="https://mate.zerops.io/settings/automation"',
          );
          assert.strictEqual(core.github.state.app.converted, 0);
          assert.deepStrictEqual(yield* viewOf(core), { state: "none" });
          const { state } = yield* manifestFor(core);
          yield* core.call("GET", `/api/github/app/created?code=code-1&state=${state}`);
          const again = yield* core.call(
            "GET",
            `/api/github/app/created?code=code-1&state=${state}`,
          );
          assert.strictEqual(again.status, 400);
          assert.strictEqual(core.github.state.app.converted, 1);
        }),
    );

    it.effect(
      "an installation GitHub confirms is kept with the repositories it reaches, and the browser goes back to Mate",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { installed, state } = yield* connected(core);
          assert.strictEqual(installed.status, 302);
          assert.strictEqual(installed.headers.get("location"), `${RETURN}?github=connected`);
          const view = yield* viewOf(core);
          assert.deepInclude(view, { state: "connected" });
          assert.deepStrictEqual((view as { installations: unknown }).installations, [
            {
              id: 7001,
              account: "acme",
              accountType: "Organization",
              repositorySelection: "selected",
              repositories: [{ fullName: "acme/tea-shop", private: true, defaultBranch: "main" }],
              suspended: false,
              manageUrl: "https://github.com/organizations/acme/settings/installations/7001",
            },
          ]);
          // The trip is spent; GitHub's call after "Configure" carries no state, and goes home.
          const configured = yield* core.call(
            "GET",
            `/api/github/app/installed?installation_id=7001&setup_action=update&state=${state}`,
          );
          assert.strictEqual(
            configured.headers.get("location"),
            "https://mate.zerops.io/settings/automation?github=connected",
          );
          // An installation of any other app is GitHub's 404 to the app's own JWT: not kept.
          const other = yield* core.call(
            "GET",
            "/api/github/app/installed?installation_id=9999&setup_action=install",
          );
          assert.strictEqual(other.status, 502);
          assert.include(other.body as string, "GitHub didn&#39;t confirm the installation");
          assert.strictEqual(
            ((yield* viewOf(core)) as { installations: ReadonlyArray<unknown> }).installations
              .length,
            1,
          );
        }),
    );

    it.effect(
      "an installation token is minted once and used until five minutes before GitHub expires it",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          yield* connected(core);
          yield* connectedRepo(core, core.appId, "web", "acme/tea-shop");
          yield* core.sql`UPDATE hq_repo_remote SET host_repo_id = '501'`;
          const remoteApp = () =>
            core.call("PUT", `/api/apps/${core.appId}/repos/web/remote/app`, {
              session: core.owner,
              body: { repository: "acme/tea-shop" },
            });
          // Listing the installation's repositories minted the first.
          assert.strictEqual(core.github.state.minted.length, 1);
          yield* remoteApp();
          yield* remoteApp();
          assert.strictEqual(core.github.state.minted.length, 1);
          // A token GitHub gives four minutes is too short to use: each use asks again.
          core.github.state.tokenLifeMs = 4 * 60_000;
          yield* core.call("DELETE", "/api/org/github", { session: core.owner });
          core.github.state.app.converted = 0;
          yield* connected(core);
          const minted = core.github.state.minted.length;
          yield* remoteApp();
          yield* remoteApp();
          assert.strictEqual(core.github.state.minted.length, minted + 2);
        }),
    );

    it.effect("an event to an address no app holds is refused before a byte of it is read", () =>
      Effect.gen(function* () {
        const core = yield* appCore;
        const { hook } = yield* connected(core);
        // Past GitHub's 25 MiB, as a caller may claim: no app there is the answer, not the size.
        const claimed = { "content-length": String(30 * 1024 * 1024) };
        const nowhere = yield* core.call("POST", `${hook.path.replace(/[^/]+$/u, "")}nobody`, {
          body: new TextEncoder().encode("{}"),
          headers: { "content-type": "application/json", "x-github-event": "push", ...claimed },
        });
        assert.strictEqual(nowhere.status, 404);
      }),
    );

    it.effect(
      "the app's webhook takes an event only under its signature, and keeps HQ's installations as GitHub changes them",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { hook } = yield* connected(core);
          const repositories = (event: string, payload: unknown, signature?: string | null) =>
            deliver(core, hook, event, payload, signature === undefined ? {} : { signature });
          const forged = yield* repositories(
            "installation_repositories",
            {},
            `sha256=${"0".repeat(64)}`,
          );
          assert.strictEqual(forged.status, 401);
          const unsigned = yield* repositories("installation_repositories", {}, null);
          assert.strictEqual(unsigned.status, 401);
          const nowhere = yield* deliver(
            core,
            { ...hook, path: `${hook.path.replace(/[^/]+$/u, "")}nobody` },
            "installation_repositories",
            {},
          );
          assert.strictEqual(nowhere.status, 404);
          const ping = yield* repositories("ping", { zen: "Keep it logically awesome." });
          assert.strictEqual(ping.status, 200);
          // A repository added on GitHub: the installation's list follows.
          core.github.state.installations
            .get(7001)!
            .repositories.push({ id: 502, full_name: "acme/kettle" });
          const added = yield* repositories("installation_repositories", {
            action: "added",
            installation: { id: 7001 },
          });
          assert.strictEqual(added.status, 202);
          yield* rowsWhere(
            core.url,
            "SELECT repositories FROM hq_github_installation WHERE id = 7001",
            (rows) => JSON.stringify(rows[0]?.["repositories"] ?? []).includes("acme/kettle"),
          );
          // Uninstalled on GitHub: HQ keeps nothing of the installation.
          const deleted = yield* repositories("installation", {
            action: "deleted",
            installation: { id: 7001 },
          });
          assert.strictEqual(deleted.status, 202);
          yield* rowsWhere(
            core.url,
            "SELECT id FROM hq_github_installation",
            (rows) => rows.length === 0,
          );
        }),
    );

    it.effect(
      "where the app reaches the repository its webhook delivers the issues, and HQ writes on them as the app, never with the kept token",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { hook } = yield* connected(core);
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: core.owner,
            body: { value: NEBIUS_KEY },
          });
          yield* connectedRepo(core, core.appId, "web", "acme/tea-shop");
          const kept = yield* core.call("PUT", `/api/apps/${core.appId}/intake`, {
            session: core.owner,
            body: { repo: "acme/tea-shop", label: "mate" },
          });
          assert.strictEqual(kept.status, 200);
          assert.deepStrictEqual((kept.body as HqIntakeView).hook, { kind: "app" });
          assert.isFalse(core.github.state.seen.some((request) => request.path.endsWith("/hooks")));
          addProject(core.fake, "P_ROBOT");
          const robot = yield* mateLinked(core, core.owner, "P_ROBOT", { appId: core.appId });
          yield* robot.link.send(overviewAt(TASK_SOURCES_SINCE));
          yield* robot.link.send(attention(1));
          const labelled = yield* deliver(
            core,
            hook,
            "issues",
            issueEvent("labeled", { number: 1, labels: ["mate"] }, "mate"),
          );
          assert.strictEqual(labelled.status, 202);
          yield* rowsWhere(core.url, "SELECT number FROM hq_task", (rows) => rows.length === 1);
          const seen = yield* core.github.seenWhere("the issue's status said", (requests) =>
            requests.some(
              (request) =>
                request.method === "POST" &&
                request.path === "/repos/acme/tea-shop/issues/1/comments",
            ),
          );
          const onRepository = seen.filter((request) => request.path.startsWith("/repos/"));
          const tokens = new Set(
            core.github.state.minted.map((minted) => `Bearer ${minted.token}`),
          );
          // The writer's permission, the 👀 and the status comment: all the app's.
          assert.isTrue(onRepository.some((request) => request.path.endsWith("/permission")));
          assert.isTrue(onRepository.some((request) => request.path.endsWith("/reactions")));
          for (const request of onRepository)
            assert.isTrue(tokens.has(request.authorization ?? ""), request.path);
          assert.isFalse(
            seen.some((request) => request.authorization === `Bearer ${GITHUB_TOKEN}`),
          );
          yield* robot.link.close;
        }),
    );

    it.effect(
      "where the app does not reach the repository, HQ writes with the repository's kept token as before",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          yield* connected(core);
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: core.owner,
            body: { value: NEBIUS_KEY },
          });
          yield* connectedRepo(core, core.appId, "web", "acme/samovar");
          const kept = yield* core.call("PUT", `/api/apps/${core.appId}/intake`, {
            session: core.owner,
            body: { repo: "acme/samovar", label: "mate" },
          });
          assert.deepStrictEqual((kept.body as HqIntakeView).hook, { kind: "made" });
          const made = core.github.state.seen.findLast((request) =>
            request.path.endsWith("/hooks"),
          );
          assert.strictEqual(made?.authorization, `Bearer ${GITHUB_TOKEN}`);
        }),
    );

    it.effect(
      "a repository's remote through the app keeps no token, replaces a token remote of the same address, and says so on the wire",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          yield* connected(core);
          yield* connectedRepo(core, core.appId, "web", "acme/tea-shop");
          yield* core.sql`UPDATE hq_repo_remote SET host_repo_id = '501'`;
          const remoteApp = (repository: string) =>
            core.call("PUT", `/api/apps/${core.appId}/repos/web/remote/app`, {
              session: core.owner,
              body: { repository },
            });
          const elsewhere = yield* remoteApp("acme/samovar");
          assert.strictEqual(elsewhere.status, 409);
          assert.deepInclude(elsewhere.body as object, { reason: "app_not_installed" });
          const through = yield* remoteApp("acme/tea-shop");
          assert.strictEqual(through.status, 204);
          const [row] = yield* rowsWhere(
            core.url,
            "SELECT via, sealed, key_id, host_repo_id, url FROM hq_repo_remote",
            (rows) => rows.length === 1,
          );
          assert.deepStrictEqual(row, {
            via: "app",
            sealed: null,
            key_id: null,
            host_repo_id: "501",
            url: "https://github.com/acme/tea-shop.git",
          });
          const repos = yield* core.call("GET", `/api/apps/${core.appId}/repos`, {
            session: core.owner,
          });
          const listed = (
            repos.body as { repos: ReadonlyArray<{ name: string; remote: unknown }> }
          ).repos.find((repo) => repo.name === "web");
          assert.deepInclude(listed?.remote as object, {
            url: "https://github.com/acme/tea-shop.git",
            via: "app",
          });
          // A writer of nothing in the organization may not.
          const reader = yield* sessionFor(core.call, "door-reader");
          const refused = yield* core.call("PUT", `/api/apps/${core.appId}/repos/web/remote/app`, {
            session: reader,
            body: { repository: "acme/tea-shop" },
          });
          assert.strictEqual(refused.status, 403);
        }),
    );

    it.effect(
      "an installation suspended on GitHub lets HQ act on none of its repositories until it is back",
      () =>
        Effect.gen(function* () {
          const core = yield* appCore;
          const { hook } = yield* connected(core);
          yield* connectedRepo(core, core.appId, "web", "acme/tea-shop");
          yield* core.sql`UPDATE hq_repo_remote SET host_repo_id = '501'`;
          const remoteApp = () =>
            core.call("PUT", `/api/apps/${core.appId}/repos/web/remote/app`, {
              session: core.owner,
              body: { repository: "acme/tea-shop" },
            });
          const installation = core.github.state.installations.get(7001)!;
          installation.suspended = true;
          yield* deliver(core, hook, "installation", {
            action: "suspend",
            installation: { id: 7001 },
          });
          yield* rowsWhere(
            core.url,
            "SELECT suspended FROM hq_github_installation WHERE id = 7001",
            (rows) => rows[0]?.["suspended"] === true,
          );
          const refused = yield* remoteApp();
          assert.strictEqual(refused.status, 409);
          assert.deepInclude(refused.body as object, { reason: "app_unavailable" });
          installation.suspended = false;
          yield* deliver(core, hook, "installation", {
            action: "unsuspend",
            installation: { id: 7001 },
          });
          yield* rowsWhere(
            core.url,
            "SELECT suspended FROM hq_github_installation WHERE id = 7001",
            (rows) => rows[0]?.["suspended"] === false,
          );
          assert.strictEqual((yield* remoteApp()).status, 204);
        }),
    );

    it.effect("forgetting the app keeps nothing of it, its installations or its trips", () =>
      Effect.gen(function* () {
        const core = yield* appCore;
        yield* connected(core);
        const forgotten = yield* core.call("DELETE", "/api/org/github", { session: core.owner });
        assert.strictEqual(forgotten.status, 204);
        assert.deepStrictEqual(yield* viewOf(core), { state: "none" });
        const [counts] = yield* rowsWhere(
          core.url,
          `SELECT (SELECT count(*) FROM hq_github_app)::int AS apps,
            (SELECT count(*) FROM hq_github_installation)::int AS installations,
            (SELECT count(*) FROM hq_github_app_state)::int AS trips`,
          (rows) => rows.length === 1,
        );
        assert.deepStrictEqual(counts, { apps: 0, installations: 0, trips: 0 });
      }),
    );
  });
});
