// @effect-diagnostics nodeBuiltinImport:off -- GitHub signs its webhooks with HMAC-SHA256.
/**
 * Automated Mates in the running Core (`runningCore.ts`), as their tests set them up: a Mate's record
 * made automated, in an application or in none, enrolled, with its link open.
 *
 * @module test/harness/automated
 */
import * as NodeCrypto from "node:crypto";

import { assert } from "@effect/vitest";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { sealRemoteToken } from "../../src/deployKeys.ts";
import type { MateTasksOptions } from "../../src/mateTasks.ts";
import { testKey } from "./deployKeys.ts";
import { githubFake } from "./githubFake.ts";
import { addProject, rowsWhere } from "./mates.ts";
import { enrollMate, sessionFor, startCore, untilHealth } from "./runningCore.ts";

type Core = Effect.Success<ReturnType<typeof startCore>>;

/** A Mate's link from its credential, its first state read. */
export const linkOf = (core: Core, credential: string) =>
  Effect.gen(function* () {
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { readonly ticket: string };
    const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    // Its first state, leaving whatever else came first where it is.
    const state = yield* link.take("state");
    return { link, state };
  });

/**
 * The Mate of `projectId`, made by `owner` — automated unless said otherwise — in the application
 * `appId` or in none, enrolled, its link open.
 */
export const mateLinked = (
  core: Core,
  owner: string,
  projectId: string,
  options: { readonly appId?: string; readonly automated?: boolean } = {},
) =>
  Effect.gen(function* () {
    const automated = options.automated ?? true;
    const made =
      options.appId === undefined
        ? yield* core.call("POST", "/api/mates", {
            session: owner,
            body: { projectId, face: "face-1", automated },
          })
        : yield* core.call("POST", `/api/apps/${options.appId}/projects`, {
            session: owner,
            body: { projectId, kind: "mate", mate: { face: "face-1", automated } },
          });
    assert.strictEqual(made.status, 201);
    const credential = yield* enrollMate(core.call, core.fake, projectId);
    const { link, state } = yield* linkOf(core, credential);
    return { credential, auth: { authorization: `Mate ${credential}` }, link, state };
  });

/** A fake GitHub token, built from parts so no scanner takes it for one. */
export const GITHUB_TOKEN = ["github", "pat", "fake", "0123456789"].join("_");

/**
 * The application's repository `repo` connected to the GitHub repository `path` (`owner/name`),
 * its token kept by `keptBy`, as Connect Git leaves it.
 */
export const connectedRepo = (
  core: Core,
  appId: string,
  repo: string,
  path: string,
  keptBy = "owner",
) =>
  Effect.gen(function* () {
    const sealed = sealRemoteToken(testKey(), appId, repo, Redacted.make(GITHUB_TOKEN));
    yield* core.sql`
      INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, ${repo}, ${keptBy})
      ON CONFLICT DO NOTHING`;
    yield* core.sql`
      INSERT INTO hq_repo_remote (app_id, repo, url, url_key, host, host_repo_id, sealed, key_id, kept_by, kept_at)
      VALUES (${appId}::uuid, ${repo}, ${`https://github.com/${path}.git`}, ${`github.com/${path}`},
        'github.com', ${path}, ${sealed.sealed}, ${sealed.keyId}, ${keptBy}, clock_timestamp())`;
  }).pipe(Effect.orDie);

type Github = Effect.Success<typeof githubFake>;

/**
 * The application's intake on `acme/tea-shop` labelled `label`, its webhook made on the fake GitHub:
 * where GitHub delivers, and the secret it signs with.
 */
export const intakeOn = (
  core: Core,
  github: Github,
  owner: string,
  appId: string,
  label = "mate",
) =>
  Effect.gen(function* () {
    const kept = yield* core.call("PUT", `/api/apps/${appId}/intake`, {
      session: owner,
      body: { repo: "acme/tea-shop", label },
    });
    assert.strictEqual(kept.status, 200);
    const view = kept.body as HqIntakeView;
    const made = github.state.seen.findLast((request) => request.path.endsWith("/hooks"));
    assert.isDefined(made, "the webhook HQ made");
    const secret = (made!.body as { config: { secret: string } }).config.secret;
    return { path: new URL(view.webhookUrl).pathname, secret };
  });

let deliveries = 0;

/**
 * GitHub's delivery of `event`, signed with `secret` unless a signature is given: JSON, or
 * form-encoded (`payload=`) as a webhook pasted with GitHub's defaults sends it.
 */
export const deliver = (
  core: Core,
  hook: { readonly path: string; readonly secret: string },
  event: string,
  payload: unknown,
  options: {
    readonly delivery?: string;
    readonly signature?: string | null;
    readonly form?: boolean;
  } = {},
) => {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(
    options.form === true ? new URLSearchParams({ payload: json }).toString() : json,
  );
  const signature =
    options.signature === undefined
      ? `sha256=${NodeCrypto.createHmac("sha256", hook.secret).update(bytes).digest("hex")}`
      : options.signature;
  return core.call("POST", hook.path, {
    body: bytes,
    headers: {
      "content-type":
        options.form === true ? "application/x-www-form-urlencoded" : "application/json",
      "x-github-event": event,
      "x-github-delivery": options.delivery ?? `delivery-${String((deliveries += 1))}`,
      ...(signature === null ? {} : { "x-hub-signature-256": signature }),
    },
  });
};

/** Who acts on GitHub in an event: `nova`, a person, unless the test says otherwise. */
export interface Acting {
  readonly sender?: string;
  readonly bot?: boolean;
  /** The repository is public. */
  readonly public?: boolean;
}

const issueOf = (
  action: string,
  issue: {
    readonly number: number;
    readonly title?: string;
    readonly body?: string | null;
    readonly labels?: ReadonlyArray<string>;
    readonly state?: "open" | "closed";
  },
) => ({
  number: issue.number,
  title: issue.title ?? `Issue ${String(issue.number)}`,
  body: issue.body === undefined ? "Make the tea hotter." : issue.body,
  html_url: `https://github.com/acme/tea-shop/issues/${String(issue.number)}`,
  state: issue.state ?? (action === "closed" ? "closed" : "open"),
  user: { login: "nova", type: "User" },
  labels: (issue.labels ?? []).map((name) => ({ name })),
});

const actingOf = (acting: Acting) => ({
  repository: { full_name: "acme/tea-shop", private: acting.public !== true },
  sender: { login: acting.sender ?? "nova", type: acting.bot === true ? "Bot" : "User" },
});

/** An `issues` event's payload as GitHub sends it, of `acme/tea-shop`. */
export const issueEvent = (
  action: string,
  issue: {
    readonly number: number;
    readonly title?: string;
    readonly body?: string | null;
    readonly labels?: ReadonlyArray<string>;
    /** Open, unless the event closes it. */
    readonly state?: "open" | "closed";
  },
  label?: string,
  acting: Acting = {},
) => ({
  action,
  issue: issueOf(action, issue),
  ...(label === undefined ? {} : { label: { name: label } }),
  ...actingOf(acting),
});

let comments = 0;

/** An `issue_comment` event's payload: `body` said on the open issue `number`. */
export const commentEvent = (
  number: number,
  body: string,
  acting: Acting & { readonly app?: boolean } = {},
) => ({
  action: "created",
  issue: issueOf("created", { number, labels: ["mate"] }),
  comment: {
    id: (comments += 1),
    body,
    user: { login: acting.sender ?? "nova", type: acting.bot === true ? "Bot" : "User" },
    performed_via_github_app: acting.app === true ? { id: 1 } : null,
  },
  ...actingOf(acting),
});

let revisions = 0;

/** The Mate's attention as its link brings it: `working` of its chats the agent is on. */
export const attention = (working: number) => ({
  type: "attention",
  attention: {
    source: { environmentId: "env-1", epoch: 1, incarnation: "run-1", revision: (revisions += 1) },
    mainThreadId: null,
    lastThreadId: null,
    working,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
  },
});

/** A fake Nebius key, built from parts so no scanner takes it for one. */
const NEBIUS_KEY = ["v1", "fake", "nebius", "key", "0123456789"].join(".");

/**
 * A Core whose application `Tea Shop` takes `acme/tea-shop`'s issues labelled `mate`, with its
 * automated Mate `P_ROBOT` linked and resting.
 */
export const automatedPool = (
  given: {
    readonly taskAcceptWithin?: Duration.Duration;
    readonly taskGoneAfter?: Duration.Duration;
    /** HQ's other task times (`MateTasksOptions`): any given, HQ looks at its tasks every 50 ms. */
    readonly tasks?: MateTasksOptions;
    readonly busy?: boolean;
    /** The organization keeps no key for its automated Mates' provider. */
    readonly keyless?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const github = yield* githubFake;
    const times: MateTasksOptions = {
      ...given.tasks,
      ...(given.taskAcceptWithin === undefined ? {} : { acceptWithin: given.taskAcceptWithin }),
      ...(given.taskGoneAfter === undefined ? {} : { goneAfter: given.taskGoneAfter }),
    };
    const core = yield* startCore(true, {
      githubApi: github.url,
      ...(Object.keys(times).length === 0
        ? {}
        : { tasks: { sweepEvery: Duration.millis(50), ...times } }),
    });
    yield* untilHealth(core.call, "active");
    const owner = yield* sessionFor(core.call, "door-owner");
    const app = yield* core.call("POST", "/api/apps", {
      session: owner,
      body: { name: "Tea Shop" },
    });
    const appId = (app.body as { readonly id: string }).id;
    const keyKept = () =>
      core.call("PUT", "/api/org/ai-keys/nebius", { session: owner, body: { value: NEBIUS_KEY } });
    if (given.keyless !== true) yield* keyKept();
    yield* connectedRepo(core, appId, "web", "acme/tea-shop");
    const hook = yield* intakeOn(core, github, owner, appId);
    addProject(core.fake, "P_ROBOT");
    const robot = yield* mateLinked(core, owner, "P_ROBOT", { appId });
    yield* robot.link.send(attention(given.busy === true ? 1 : 0));
    const issue = (number: number) =>
      deliver(core, hook, "issues", issueEvent("opened", { number, labels: ["mate"] }));
    const tasks = (matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean) =>
      rowsWhere(
        core.url,
        "SELECT id::text AS id, number, state, mate_project_id, attempts, detail, conversation_id FROM hq_task ORDER BY seq",
        matches,
      );
    return { ...core, github, owner, appId, hook, robot, issue, tasks, keyKept };
  });
