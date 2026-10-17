// @effect-diagnostics nodeBuiltinImport:off -- the app signs its JWT (RS256) and GitHub signs its webhook (HMAC-SHA256); a state and an address are the system's randomness.
/**
 * The organization's own GitHub app (`@t3tools/shared/hqGithub`), made by HQ through GitHub's
 * manifest flow, so everything HQ writes on a repository it is installed on is the app's
 * (`<slug>[bot]`), never a person's.
 *
 * - The manifest, by an owner or admin of the organization (`keep_ai_key`): the app's name, its
 *   permissions and events, and HQ's addresses — its webhook at
 *   `https://<HQ's own domain>/api/github/app/webhook/<public id>` (made at the first manifest and
 *   kept), where GitHub sends the browser once the app is made (`/api/github/app/created`) and once
 *   it is installed (`/api/github/app/installed`). One state binds the trip: who started it, the
 *   Mate page it goes back to (a Mate's own origin, else Mate's hosted one), good for an hour.
 * - Made: GitHub's code turned into the app (`POST /app-manifests/<code>/conversions`), its private
 *   key, webhook secret and client secret sealed (`deployKeys.ts`), never answered back; the
 *   browser goes on to install it. Installed: the installation, checked with the app's own JWT, and
 *   the repositories it reaches kept; the browser goes back to Mate. Anything wrong on that trip is
 *   a plain page saying what happened, with the way back.
 * - Its webhook: taken only once `X-Hub-Signature-256` holds under the app's webhook secret, before
 *   a byte is parsed; answered at once and worked after. Installations and their repositories
 *   keep HQ's rows; every event goes on to whoever listens for it (`GithubEvents`).
 * - Acting as it (`GithubAuth`): an installation token for a repository the app reaches, minted with
 *   the app's JWT and kept until five minutes before GitHub expires it; a repository HQ does not
 *   know the app reaches is looked for again at most once a minute per account.
 *
 * Forgotten, HQ keeps nothing of the app; deleting it on GitHub is the person's.
 *
 * @module githubApp
 */
import * as NodeCrypto from "node:crypto";

import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import type {
  HqGithubInstallation,
  HqGithubManifestRequest,
  HqGithubManifestView,
  HqGithubRepository,
  HqGithubView,
} from "@t3tools/shared/hqGithub";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { DeployKeys } from "./deployKeys.ts";
import { GithubAuth, GithubAuthUnavailable, type GithubBot } from "./githubAuth.ts";
import { GithubEvents } from "./githubEvents.ts";
import { signatureHolds } from "./intake.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Where GitHub sends the browser and the app's events, below HQ's own address. */
export const GITHUB_APP_PATH = "/api/github/app";
export const GITHUB_APP_WEBHOOK_PATH = `${GITHUB_APP_PATH}/webhook`;

/**
 * What the app may do on a repository it is installed on: push branches, open and merge pull
 * requests, comment, react and label on issues, read checks, statuses and workflow runs. Nothing of
 * the organization and no administration, so a repository's admin may install it too.
 */
export const GITHUB_APP_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  issues: "write",
  metadata: "read",
  checks: "read",
  statuses: "read",
  actions: "read",
} as const;

/**
 * What GitHub tells the app of. `installation` and `installation_repositories` come to every app
 * unasked, and GitHub takes no subscription to them.
 */
export const GITHUB_APP_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "check_suite",
  "check_run",
  "push",
] as const;

/** How long a trip through GitHub's pages may take: GitHub's own limit for a manifest's code. */
const STATE_FOR = Duration.hours(1);
/** An installation token is used until this long before GitHub expires it. */
const TOKEN_MARGIN = Duration.minutes(5);
/** How often HQ asks GitHub again which repositories an account's installation reaches. */
const RELIST_EVERY = Duration.minutes(1);
/** The pages of an installation's repositories HQ reads: 100 each. */
const REPOSITORY_PAGES = 10;
/** GitHub's own cap on a webhook's payload. */
export const GITHUB_APP_EVENT_LIMIT = 25 * 1024 * 1024;

const randomId = (bytes: number) => NodeCrypto.randomBytes(bytes).toString("base64url");

/** The app's definition, as GitHub reads it from the manifest form, its addresses on `hqOrigin`. */
export const githubAppManifest = (input: {
  readonly name: string;
  readonly hqOrigin: string;
  readonly publicId: string;
}) => ({
  name: input.name,
  url: DEFAULT_HOSTED_APP_URL,
  description: "Zerops Mate: opens pull requests and answers on issues for your automated Mates.",
  hook_attributes: {
    url: `${input.hqOrigin}${GITHUB_APP_WEBHOOK_PATH}/${input.publicId}`,
    active: true,
  },
  redirect_url: `${input.hqOrigin}${GITHUB_APP_PATH}/created`,
  setup_url: `${input.hqOrigin}${GITHUB_APP_PATH}/installed`,
  setup_on_update: true,
  public: false,
  default_permissions: GITHUB_APP_PERMISSIONS,
  default_events: [...GITHUB_APP_EVENTS],
});

/** GitHub's "new app" page of `owner` (an organization), or of the person's own account. */
export const githubAppPostUrl = (owner: string | null, state: string) =>
  `${
    owner === null
      ? "https://github.com/settings/apps/new"
      : `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
  }?state=${encodeURIComponent(state)}`;

/**
 * The app's JWT (RS256 under its private key): issued a minute back against clock drift, good for
 * nine minutes, below GitHub's ten.
 */
export const appJwt = (githubId: number, pem: Redacted.Redacted, nowMs: number) => {
  const now = Math.floor(nowMs / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: githubId,
  })}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(input), Redacted.value(pem));
  return `${input}.${signature.toString("base64url")}`;
};

/**
 * Where the browser goes back to: a Mate page on Mate's hosted origin, a Mate's own (`*.zerops.app`)
 * or one served locally; anything else goes to the same page on Mate's hosted origin.
 */
export const trustedReturn = (raw: string) => {
  const fallback = `${DEFAULT_HOSTED_APP_URL}/settings/automation`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  url.hash = "";
  const hosted = new URL(DEFAULT_HOSTED_APP_URL);
  const local =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mates = url.protocol === "https:" && url.hostname.endsWith(".zerops.app");
  if (url.origin === hosted.origin || local || mates) return url.toString();
  return new URL(`${url.pathname}${url.search}`, hosted).toString();
};

/** `url` with `name=value` among its query. */
const withParam = (url: string, name: string, value: string) => {
  const next = new URL(url);
  next.searchParams.set(name, value);
  return next.toString();
};

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

/** The plain page a trip through GitHub ends on when something went wrong: what, and the way back. */
export const githubAppPage = (words: string, back: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mate and GitHub</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px"><p>${escapeHtml(words)}</p><p><a href="${escapeHtml(back)}">Back to Mate</a></p></body></html>`;

/** Where a trip through GitHub's pages lands the browser. */
export type GithubAppLanding =
  | { readonly kind: "redirect"; readonly url: string }
  | {
      readonly kind: "page";
      readonly status: number;
      readonly words: string;
      readonly back: string;
    };

/** Why a trip ended on a page, in the person's words. */
export const LANDING_WORDS = {
  expired:
    "This link to connect GitHub has expired or was already used. Start again from Settings in Mate.",
  conversion:
    "GitHub made the app, but Mate couldn't finish setting it up. Start again from Settings in Mate; you can delete the half-made app in GitHub's developer settings.",
  noKey: "Mate's HQ can't keep the app's keys yet: its encryption key isn't set up.",
  noApp: "Mate has no GitHub app to install. Start again from Settings in Mate.",
  installation:
    "GitHub didn't confirm the installation. Try again from Settings in Mate, or check the app's installations on GitHub.",
} as const;

/** An event as GitHub posts it to the app's webhook: the headers HQ reads, its bytes as they came. */
export interface GithubAppDelivery {
  readonly event: string | undefined;
  readonly id: string | undefined;
  readonly signature: string | undefined;
  readonly body: Uint8Array;
}

/** What became of a delivery: no app at that address, refused, unreadable, a ping, or taken. */
export type GithubAppReceived = {
  readonly kind: "unknown" | "refused" | "invalid" | "ping" | "taken";
};

/** A repository the app reaches, as HQ last heard it. */
export interface ReachedRepository extends HqGithubRepository {
  /** Its id on GitHub. */
  readonly id: number;
  readonly installationId: number;
}

type GithubAppError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class GithubApp extends Context.Service<
  GithubApp,
  {
    /** Whether the organization has its app, as whom it writes, and where it is installed. */
    readonly view: Effect.Effect<HqGithubView, SqlError>;
    readonly manifest: (
      userId: string,
      request: HqGithubManifestRequest,
    ) => Effect.Effect<HqGithubManifestView, GithubAppError>;
    readonly forget: (userId: string) => Effect.Effect<void, GithubAppError>;
    /** GitHub's return once it made the app: on to install it. */
    readonly created: (
      code: string | undefined,
      state: string | undefined,
    ) => Effect.Effect<GithubAppLanding, SqlError | NotLeader>;
    /** GitHub's return once the app is installed (or its installation changed): back to Mate. */
    readonly installed: (query: {
      readonly installationId: string | undefined;
      readonly setupAction: string | undefined;
      readonly state: string | undefined;
    }) => Effect.Effect<GithubAppLanding, SqlError | NotLeader>;
    /** GitHub's event to the app's webhook at `publicId`: answered at once, worked after. */
    readonly receive: (
      publicId: string,
      delivery: GithubAppDelivery,
    ) => Effect.Effect<GithubAppReceived, SqlError>;
    /** The repository `owner/name` the app reaches, if it does. */
    readonly reach: (
      repository: string,
    ) => Effect.Effect<ReachedRepository | undefined, GithubAuthUnavailable>;
    /** Once every delivery taken so far is worked. */
    readonly drained: Effect.Effect<void>;
  }
>()("@t3tools/hq/githubApp") {}

interface AppRow {
  readonly public_id: string;
  readonly github_id: string | null;
  readonly slug: string | null;
  readonly owner: string | null;
  readonly html_url: string | null;
  readonly pem_sealed: Uint8Array | null;
  readonly secret_sealed: Uint8Array | null;
  readonly key_id: string | null;
}

/** The app, its secrets opened. */
interface MadeApp {
  readonly publicId: string;
  readonly githubId: number;
  readonly slug: string;
  readonly owner: string;
  readonly htmlUrl: string;
  readonly pem: Redacted.Redacted;
  readonly secret: Redacted.Redacted;
}

interface InstallationRow {
  readonly id: string;
  readonly account: string;
  readonly account_type: "Organization" | "User";
  readonly repository_selection: "all" | "selected";
  readonly suspended: boolean;
  readonly repositories: ReadonlyArray<{
    readonly id: number;
    readonly fullName: string;
    readonly private: boolean;
    readonly defaultBranch: string;
  }>;
}

const Conversion = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String,
  html_url: Schema.String,
  owner: Schema.Struct({ login: Schema.String }),
  client_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  client_secret: Schema.optionalKey(Schema.NullOr(Schema.String)),
  webhook_secret: Schema.String,
  pem: Schema.String,
});
const decodeConversion = Schema.decodeUnknownOption(Schema.fromJsonString(Conversion));

const Installation = Schema.Struct({
  id: Schema.Number,
  account: Schema.Struct({ login: Schema.String, type: Schema.optionalKey(Schema.String) }),
  repository_selection: Schema.Literals(["all", "selected"]),
  suspended_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeInstallation = Schema.decodeUnknownOption(Schema.fromJsonString(Installation));

const AccessToken = Schema.Struct({ token: Schema.String, expires_at: Schema.String });
const decodeAccessToken = Schema.decodeUnknownOption(Schema.fromJsonString(AccessToken));

const Repositories = Schema.Struct({
  total_count: Schema.Number,
  repositories: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      full_name: Schema.String,
      private: Schema.Boolean,
      default_branch: Schema.optionalKey(Schema.String),
    }),
  ),
});
const decodeRepositories = Schema.decodeUnknownOption(Schema.fromJsonString(Repositories));

const BotUser = Schema.Struct({ login: Schema.String, id: Schema.Number });
const decodeBotUser = Schema.decodeUnknownOption(Schema.fromJsonString(BotUser));

/** What HQ reads of an event about an installation, beside its repository. */
const InstallationEvent = Schema.Struct({
  action: Schema.optionalKey(Schema.String),
  installation: Schema.optionalKey(Schema.Struct({ id: Schema.Number })),
  repository: Schema.optionalKey(Schema.Struct({ full_name: Schema.String })),
});
const decodeInstallationEvent = Schema.decodeUnknownOption(InstallationEvent);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The secrets of the app's row (`sealSecret`), bound to which it is and to its webhook's address. */
const APP_TABLE = "hq_github_app";

/** GitHub's page to change which repositories an installation reaches. */
const manageUrlOf = (row: InstallationRow) =>
  row.account_type === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(row.account)}/settings/installations/${row.id}`
    : `https://github.com/settings/installations/${row.id}`;

/**
 * The app and HQ's tokens as it (`GithubApp`, `GithubAuth`), over HTTP; `api` replaces GitHub's
 * REST API (the tests' fake), else `https://api.github.com`.
 */
export const githubAppLayer = (options: { readonly hqProjectId: string; readonly api?: string }) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const keys = yield* DeployKeys;
      const events = yield* GithubEvents;
      const client = yield* HttpClient.HttpClient;
      const work = yield* FiberSet.make();
      const api = options.api ?? "https://api.github.com";
      const tokens = new Map<
        number,
        { readonly token: Redacted.Redacted; readonly until: number }
      >();
      const listed = new Map<string, number>();
      const bots = new Map<string, GithubBot>();
      const minting = yield* Semaphore.make(1);

      const refuse = (code: AutomationRefused["code"], reason: string) =>
        Effect.fail(new AutomationRefused({ code, reason }));

      /** One call on GitHub's API: its status and body; at most 10 s and 1 MiB. */
      const send = (
        method: "GET" | "POST",
        path: string,
        auth: { readonly jwt: string } | { readonly token: Redacted.Redacted } | null,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            let request = HttpClientRequest.make(method)(`${api}${path}`).pipe(
              HttpClientRequest.setHeader("user-agent", "Zerops-Mate"),
              HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
              HttpClientRequest.setHeader("x-github-api-version", "2022-11-28"),
            );
            if (auth !== null)
              request = HttpClientRequest.bearerToken(
                request,
                "jwt" in auth ? auth.jwt : Redacted.value(auth.token),
              );
            const response = yield* client.execute(request);
            return { status: response.status, body: yield* response.text };
          }).pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
            Effect.timeout(Duration.seconds(10)),
            Effect.mapError(() => new GithubAuthUnavailable({ reason: "unreachable" })),
          ),
        );

      const appRow = Effect.map(
        sql<AppRow>`
          SELECT public_id, github_id::text AS github_id, slug, owner, html_url, pem_sealed,
            secret_sealed, key_id
          FROM hq_github_app`,
        (rows) => rows[0],
      );

      const opened = (row: AppRow | undefined): MadeApp | undefined => {
        if (
          row === undefined ||
          row.github_id === null ||
          row.slug === null ||
          row.owner === null ||
          row.html_url === null ||
          row.pem_sealed === null ||
          row.secret_sealed === null ||
          row.key_id === null
        )
          return undefined;
        const parts = (what: string) => [what, row.public_id];
        const pem = keys.openSecret(APP_TABLE, parts("pem"), {
          sealed: row.pem_sealed,
          keyId: row.key_id,
        });
        const secret = keys.openSecret(APP_TABLE, parts("webhook_secret"), {
          sealed: row.secret_sealed,
          keyId: row.key_id,
        });
        if (pem === undefined || secret === undefined) return undefined;
        return {
          publicId: row.public_id,
          githubId: Number(row.github_id),
          slug: row.slug,
          owner: row.owner,
          htmlUrl: row.html_url,
          pem,
          secret,
        };
      };
      const made = Effect.map(appRow, opened);
      const madeOrUnavailable = made.pipe(
        Effect.mapError(() => new GithubAuthUnavailable({ reason: "unreachable" })),
      );

      const jwtOf = (app: MadeApp) =>
        Effect.map(Clock.currentTimeMillis, (now) => appJwt(app.githubId, app.pem, now));

      /** A token of the installation `id`, kept until shortly before it expires. */
      const installationToken = (app: MadeApp, id: number) =>
        minting.withPermits(1)(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const held = tokens.get(id);
            if (held !== undefined && now < held.until) return held.token;
            const reply = yield* send("POST", `/app/installations/${String(id)}/access_tokens`, {
              jwt: yield* jwtOf(app),
            });
            if (reply.status === 403)
              return yield* new GithubAuthUnavailable({
                reason: /suspend/iu.test(reply.body) ? "suspended" : "refused",
              });
            if (reply.status === 404)
              return yield* new GithubAuthUnavailable({ reason: "not_installed" });
            if (reply.status === 401)
              return yield* new GithubAuthUnavailable({ reason: "refused" });
            const read = reply.status === 201 ? decodeAccessToken(reply.body) : Option.none();
            if (Option.isNone(read))
              return yield* new GithubAuthUnavailable({ reason: "unreachable" });
            const token = Redacted.make(read.value.token);
            const expires = Date.parse(read.value.expires_at);
            tokens.set(id, {
              token,
              until:
                (Number.isNaN(expires) ? now + 55 * 60_000 : expires) -
                Duration.toMillis(TOKEN_MARGIN),
            });
            return token;
          }),
        );

      const installations = sql<InstallationRow>`
        SELECT id::text AS id, account, account_type, repository_selection, suspended, repositories
        FROM hq_github_installation ORDER BY account, id`;

      /**
       * The installation `id` as GitHub tells it now, and the repositories it reaches, kept; one
       * GitHub no longer knows of this app, gone.
       */
      const refreshInstallation = (app: MadeApp, id: number) =>
        Effect.gen(function* () {
          const reply = yield* send("GET", `/app/installations/${String(id)}`, {
            jwt: yield* jwtOf(app),
          });
          if (reply.status === 404) {
            tokens.delete(id);
            yield* leader.write(sql`DELETE FROM hq_github_installation WHERE id = ${id}`);
            return;
          }
          const read = reply.status === 200 ? decodeInstallation(reply.body) : Option.none();
          if (Option.isNone(read))
            return yield* new GithubAuthUnavailable({
              reason: reply.status === 401 || reply.status === 403 ? "refused" : "unreachable",
            });
          const installation = read.value;
          const suspended = installation.suspended_at != null;
          const repositories: Array<InstallationRow["repositories"][number]> = [];
          if (!suspended) {
            const token = yield* installationToken(app, id);
            for (let page = 1; page <= REPOSITORY_PAGES; page++) {
              const listing = yield* send(
                "GET",
                `/installation/repositories?per_page=100&page=${String(page)}`,
                { token },
              );
              const repos =
                listing.status === 200 ? decodeRepositories(listing.body) : Option.none();
              if (Option.isNone(repos))
                return yield* new GithubAuthUnavailable({ reason: "unreachable" });
              for (const repo of repos.value.repositories)
                repositories.push({
                  id: repo.id,
                  fullName: repo.full_name,
                  private: repo.private,
                  defaultBranch: repo.default_branch ?? "main",
                });
              if (
                repos.value.repositories.length < 100 ||
                repositories.length >= repos.value.total_count
              )
                break;
            }
          }
          const accountType = installation.account.type === "User" ? "User" : "Organization";
          yield* leader.write(sql`
            INSERT INTO hq_github_installation (id, account, account_type, repository_selection,
              suspended, repositories, repositories_at, updated_at)
            VALUES (${id}, ${installation.account.login}, ${accountType},
              ${installation.repository_selection}, ${suspended},
              ${encodeJson(repositories)}::jsonb, ${suspended ? null : sql`now()`}, now())
            ON CONFLICT (id) DO UPDATE SET account = EXCLUDED.account,
              account_type = EXCLUDED.account_type,
              repository_selection = EXCLUDED.repository_selection,
              suspended = EXCLUDED.suspended,
              repositories = CASE WHEN EXCLUDED.suspended THEN hq_github_installation.repositories
                ELSE EXCLUDED.repositories END,
              repositories_at = COALESCE(EXCLUDED.repositories_at, hq_github_installation.repositories_at),
              updated_at = now()`);
        }).pipe(
          Effect.catchTags({
            SqlError: () => Effect.fail(new GithubAuthUnavailable({ reason: "unreachable" })),
            NotLeader: () => Effect.fail(new GithubAuthUnavailable({ reason: "unreachable" })),
          }),
        );

      /** The installation and repository the app reaches `repository` by, as HQ knows it now. */
      const known = (repository: string) =>
        Effect.map(installations, (rows) => {
          const wanted = repository.toLowerCase();
          const owner = wanted.split("/")[0] ?? "";
          const ofOwner = rows.filter((row) => row.account.toLowerCase() === owner);
          for (const row of ofOwner) {
            const repo = row.repositories.find(
              (candidate) => candidate.fullName.toLowerCase() === wanted,
            );
            if (repo !== undefined) return { owner: ofOwner, row, repo } as const;
          }
          return { owner: ofOwner, row: undefined, repo: undefined } as const;
        }).pipe(Effect.mapError(() => new GithubAuthUnavailable({ reason: "unreachable" })));

      /**
       * The repository the app reaches `repository` by: as HQ knows it, else — the app installed on
       * its account — after asking GitHub again, at most once a minute per account.
       */
      const reach = (repository: string) =>
        Effect.gen(function* () {
          const app = yield* madeOrUnavailable;
          if (app === undefined) return undefined;
          const first = yield* known(repository);
          const found = first.row === undefined ? undefined : { row: first.row, repo: first.repo };
          if (found !== undefined) return { app, ...found };
          if (first.owner.length === 0) return undefined;
          const account = first.owner[0]!.account.toLowerCase();
          const now = yield* Clock.currentTimeMillis;
          const last = listed.get(account);
          if (last !== undefined && now - last < Duration.toMillis(RELIST_EVERY)) return undefined;
          listed.set(account, now);
          for (const row of first.owner)
            if (!row.suspended) yield* refreshInstallation(app, Number(row.id));
          const again = yield* known(repository);
          return again.row === undefined ? undefined : { app, row: again.row, repo: again.repo };
        });

      const auth = GithubAuth.of({
        tokenFor: (repository) =>
          Effect.gen(function* () {
            const reached = yield* reach(repository);
            if (reached === undefined) return undefined;
            if (reached.row.suspended)
              return yield* new GithubAuthUnavailable({ reason: "suspended" });
            return yield* installationToken(reached.app, Number(reached.row.id));
          }),
        bot: Effect.gen(function* () {
          const app = yield* madeOrUnavailable;
          if (app === undefined) return undefined;
          const held = bots.get(app.slug);
          if (held !== undefined) return held;
          const login = `${app.slug}[bot]`;
          const reply = yield* send("GET", `/users/${encodeURIComponent(login)}`, null);
          const read = reply.status === 200 ? decodeBotUser(reply.body) : Option.none();
          if (Option.isNone(read))
            return yield* new GithubAuthUnavailable({
              reason: reply.status === 404 ? "not_installed" : "unreachable",
            });
          const bot = { login: read.value.login, userId: read.value.id };
          bots.set(app.slug, bot);
          return bot;
        }),
      });

      /** HQ's own origin, as GitHub reaches it. */
      const hqOrigin = Effect.gen(function* () {
        const zone = (yield* roles.view).projects.find(
          (project) => project.id === options.hqProjectId,
        )?.publicZone;
        if (!zone) return yield* refuse("conflict", "hq_address_unknown");
        return `https://${zone}`;
      });

      /** A write of the organization's app: by its owner or an admin. */
      const mayKeep = (userId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_ai_key",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
        });

      /** The app's row, made at the first manifest: its webhook's address stays from then on. */
      const ensured = Effect.gen(function* () {
        const found = yield* appRow;
        if (found !== undefined) return found;
        yield* leader.write(sql`
          INSERT INTO hq_github_app (public_id) VALUES (${randomId(24)}) ON CONFLICT (one) DO NOTHING`);
        const madeRow = yield* appRow;
        if (madeRow === undefined) return yield* refuse("conflict", "github_unavailable");
        return madeRow;
      });

      /** A trip's state while it lives: who started it and where it goes back to. */
      const stateOf = (state: string | undefined) =>
        state === undefined || state === "" || state.length > 200
          ? Effect.succeed(undefined)
          : Effect.map(
              sql<{
                readonly user_id: string;
                readonly return_to: string;
                readonly made_at: string | null;
              }>`
                SELECT user_id, return_to, made_at::text AS made_at FROM hq_github_app_state
                WHERE state = ${state} AND expires_at > now()`,
              (rows) => rows[0],
            );

      const page = (status: number, words: string, back: string): GithubAppLanding => ({
        kind: "page",
        status,
        words,
        back,
      });
      const home = `${DEFAULT_HOSTED_APP_URL}/settings/automation`;

      const view = Effect.gen(function* () {
        const app = opened(yield* appRow);
        if (app === undefined) return { state: "none" } as const;
        const rows = yield* installations;
        return {
          state: "connected",
          slug: app.slug,
          botLogin: `${app.slug}[bot]`,
          owner: app.owner,
          appUrl: app.htmlUrl,
          installUrl: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`,
          installations: rows.map((row): HqGithubInstallation => ({
            id: Number(row.id),
            account: row.account,
            accountType: row.account_type,
            repositorySelection: row.repository_selection,
            repositories: row.repositories.map((repo) => ({
              fullName: repo.fullName,
              private: repo.private,
              defaultBranch: repo.defaultBranch,
            })),
            suspended: row.suspended,
            manageUrl: manageUrlOf(row),
          })),
        } satisfies HqGithubView;
      });

      /** What the app's webhook told of an installation, kept; then handed to every listener. */
      const worked = (app: MadeApp, name: string, deliveryId: string, payload: unknown) =>
        Effect.gen(function* () {
          const read = Option.getOrUndefined(decodeInstallationEvent(payload));
          const installation = read?.installation?.id;
          if (installation !== undefined) {
            if (name === "installation" && read?.action === "deleted") {
              tokens.delete(installation);
              yield* leader.write(
                sql`DELETE FROM hq_github_installation WHERE id = ${installation}`,
              );
            } else if (name === "installation" || name === "installation_repositories")
              yield* refreshInstallation(app, installation);
          }
          yield* events.dispatch({
            name,
            deliveryId,
            repository: read?.repository?.full_name,
            payload,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a GitHub app event not worked", { event: name, deliveryId, cause }),
          ),
        );

      const githubApp = GithubApp.of({
        view,
        reach: (repository) =>
          Effect.map(reach(repository), (reached) =>
            reached === undefined || reached.repo === undefined
              ? undefined
              : { ...reached.repo, installationId: Number(reached.row.id) },
          ),
        drained: FiberSet.awaitEmpty(work),
        manifest: (userId, request) =>
          Effect.gen(function* () {
            yield* mayKeep(userId);
            const row = yield* ensured;
            const origin = yield* hqOrigin;
            const state = randomId(24);
            const returnTo = trustedReturn(request.returnTo);
            yield* leader.write(sql`
              WITH gone AS (DELETE FROM hq_github_app_state WHERE expires_at <= now())
              INSERT INTO hq_github_app_state (state, user_id, owner, return_to, expires_at)
              VALUES (${state}, ${userId}, ${request.owner}, ${returnTo},
                now() + ${`${String(Duration.toSeconds(STATE_FOR))} seconds`}::interval)`);
            return {
              postUrl: githubAppPostUrl(request.owner, state),
              manifest: encodeJson(
                githubAppManifest({
                  name: request.name,
                  hqOrigin: origin,
                  publicId: row.public_id,
                }),
              ),
              state,
            } satisfies HqGithubManifestView;
          }),
        forget: (userId) =>
          Effect.gen(function* () {
            yield* mayKeep(userId);
            yield* leader.write(
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM hq_github_installation`;
                  yield* sql`DELETE FROM hq_github_app_state`;
                  yield* sql`DELETE FROM hq_github_app`;
                }),
              ),
            );
            tokens.clear();
            listed.clear();
            bots.clear();
          }),
        created: (code, state) =>
          Effect.gen(function* () {
            const trip = yield* stateOf(state);
            if (trip === undefined || state === undefined || trip.made_at !== null)
              return page(400, LANDING_WORDS.expired, home);
            if (code === undefined || !/^[\w-]{1,200}$/u.test(code))
              return page(400, LANDING_WORDS.expired, trip.return_to);
            const reply = yield* send(
              "POST",
              `/app-manifests/${encodeURIComponent(code)}/conversions`,
              null,
            ).pipe(Effect.option);
            const converted =
              Option.isSome(reply) && reply.value.status === 201
                ? decodeConversion(reply.value.body)
                : Option.none();
            if (Option.isNone(converted)) {
              yield* Effect.logWarning("a GitHub app not converted", {
                status: Option.isSome(reply) ? reply.value.status : "unreachable",
              });
              return page(502, LANDING_WORDS.conversion, trip.return_to);
            }
            const app = converted.value;
            const row = yield* ensured.pipe(Effect.orElseSucceed(() => undefined));
            if (row === undefined) return page(503, LANDING_WORDS.conversion, trip.return_to);
            const parts = (what: string) => [what, row.public_id];
            const pem = keys.sealSecret(APP_TABLE, parts("pem"), Redacted.make(app.pem));
            const secret = keys.sealSecret(
              APP_TABLE,
              parts("webhook_secret"),
              Redacted.make(app.webhook_secret),
            );
            const clientSecret =
              app.client_secret == null
                ? undefined
                : keys.sealSecret(
                    APP_TABLE,
                    parts("client_secret"),
                    Redacted.make(app.client_secret),
                  );
            if (pem === undefined || secret === undefined)
              return page(503, LANDING_WORDS.noKey, trip.return_to);
            // A new app replaces the one before: its installations are another app's.
            yield* leader.write(
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM hq_github_installation`;
                  yield* sql`
                    UPDATE hq_github_app SET github_id = ${app.id}, slug = ${app.slug},
                      owner = ${app.owner.login}, html_url = ${app.html_url},
                      client_id = ${app.client_id ?? null}, pem_sealed = ${pem.sealed},
                      secret_sealed = ${secret.sealed},
                      client_secret_sealed = ${clientSecret?.sealed ?? null},
                      key_id = ${pem.keyId}, made_by = ${trip.user_id}, made_at = now()
                    WHERE public_id = ${row.public_id}`;
                  yield* sql`UPDATE hq_github_app_state SET made_at = now() WHERE state = ${state}`;
                }),
              ),
            );
            tokens.clear();
            listed.clear();
            bots.clear();
            return {
              kind: "redirect",
              url: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}`,
            } as const;
          }),
        installed: ({ installationId, setupAction, state }) =>
          Effect.gen(function* () {
            const trip = yield* stateOf(state);
            const back = trip?.return_to ?? home;
            const done = (outcome: "connected" | "requested") =>
              Effect.gen(function* () {
                if (state !== undefined && trip !== undefined)
                  yield* leader.write(sql`DELETE FROM hq_github_app_state WHERE state = ${state}`);
                return { kind: "redirect", url: withParam(back, "github", outcome) } as const;
              });
            // A member asked an owner to install it: GitHub says so, and nothing is installed yet.
            if (setupAction === "request" && installationId === undefined)
              return yield* done("requested");
            const app = opened(yield* appRow);
            if (app === undefined) return page(409, LANDING_WORDS.noApp, back);
            const id = Number(installationId);
            if (!Number.isSafeInteger(id) || id <= 0)
              return page(400, LANDING_WORDS.installation, back);
            // The app's own JWT asks: an installation of any other app is not found.
            const refreshed = yield* Effect.exit(refreshInstallation(app, id));
            const kept =
              refreshed._tag === "Success"
                ? yield* sql`SELECT 1 FROM hq_github_installation WHERE id = ${id}`
                : [];
            if (kept.length === 0) return page(502, LANDING_WORDS.installation, back);
            return yield* done("connected");
          }),
        receive: (publicId, delivery) =>
          Effect.gen(function* () {
            const row = yield* appRow;
            if (row === undefined || row.public_id !== publicId)
              return { kind: "unknown" } as const;
            const app = opened(row);
            if (app === undefined) return { kind: "unknown" } as const;
            if (!signatureHolds(app.secret, delivery.body, delivery.signature))
              return { kind: "refused" } as const;
            if (delivery.event === "ping") return { kind: "ping" } as const;
            if (
              delivery.event === undefined ||
              delivery.event === "" ||
              delivery.id === undefined ||
              delivery.id === ""
            )
              return { kind: "invalid" } as const;
            const payload = decodeJson(new TextDecoder().decode(delivery.body));
            if (Option.isNone(payload)) return { kind: "invalid" } as const;
            yield* FiberSet.run(work, worked(app, delivery.event, delivery.id, payload.value));
            return { kind: "taken" } as const;
          }),
      });

      return Context.make(GithubApp, githubApp).pipe(Context.add(GithubAuth, auth));
    }),
  );
