import {
  type HqRepoGovernance,
  type HqTokenCiAccess,
  tokenExpiryLabel,
} from "@t3tools/shared/hqChanges";
import { HqGitProbeRefusalReason } from "@t3tools/shared/hqGitTargets";
/** Read-only capability evidence. User role fields are never token permission proof. */
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { MATE_GATE, writesGate } from "./githubAuth.ts";
import {
  GitTransport,
  type HostUnreachable,
  type HostReply,
  type RemoteIdentity,
  remoteIdentity,
} from "./gitTransport.ts";

export class ProbeRefused extends Schema.TaggedError<ProbeRefused>()("ProbeRefused", {
  reason: HqGitProbeRefusalReason,
  hostKind: Schema.Literals(["github", "gitlab", "unknown"]),
  remote: Schema.String,
  branch: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  tokenState: Schema.Literals(["unknown", "valid", "invalid"]),
  retryAfterMs: Schema.optionalKey(Schema.Number),
  resetAt: Schema.optionalKey(Schema.String),
  ssoUrl: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
}) {
  override get message() {
    const tokenSettings =
      this.hostKind === "github" ? "GitHub token settings" : "the repository host’s token settings";
    const words: Record<HqGitProbeRefusalReason, () => string> = {
      token_invalid: () => {
        return `${this.hostKind === "github" ? "GitHub" : "The repository host"} rejected this token (expired, revoked or mistyped). Create a replacement in ${tokenSettings}.`;
      },
      rate_limited: () => {
        return this.resetAt
          ? `The repository host asked Mate to wait until ${this.resetAt}.`
          : "The repository host asked Mate to wait.";
      },
      sso: () => {
        return "This token needs the organization's SSO authorization. Authorize it in the organization's GitHub SSO settings.";
      },
      archived: () => {
        return `${this.remote} is archived, so nothing can be pushed to it. Unarchive it in repository settings before testing again.`;
      },
      push_not_granted: () => {
        if (this.hostKind !== "github")
          return `This token can't push to ${this.remote}: the host did not grant write access.${this.hostKind === "gitlab" ? " GitLab's push scope is write_repository." : ""} Check repository write access in ${tokenSettings}.`;
        return `This token can't push to ${this.remote}: under Repository access choose Only select repositories → ${this.remote} with Contents: Read and write (and Issues and Webhooks: Read and write for automated Mates to take its issues). If ${this.remote.split("/")[0]} approves tokens, it may still be pending.`;
      },
      not_visible: () => {
        return `${this.remote} doesn't exist, or your account can't see it. Check the repository address and this token's repository access in ${tokenSettings}.`;
      },
      classic_scope: () => {
        return `This is a classic token without ${this.scope}. Create a fine-grained token with the link above, or add ${this.scope} in ${tokenSettings}.`;
      },
      pull_requests_only: () => {
        return `${this.branch} takes changes only through pull requests. Choose Open a pull request.`;
      },
      unreachable: () => {
        return "The repository host could not be reached in time. Check the connection, then test this token again.";
      },
      could_not_verify: () => {
        return `Mate couldn't verify access to ${this.remote}. Check the repository address and this token's repository access in ${tokenSettings}, then test again.`;
      },
    };
    return words[this.reason]();
  }
}
export interface VerifiedRemote {
  readonly remote: RemoteIdentity;
  readonly hostRepoId: string | null;
  readonly expiresAt: string | null;
  readonly expiryLabel: string;
  readonly mergeSettings: boolean;
  readonly branchRules?: "none_on_plan";
}
export class GithubProbes extends Context.Service<
  GithubProbes,
  {
    readonly verify: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      branch?: string,
    ) => Effect.Effect<VerifiedRemote, ProbeRefused>;
    /** What the token may read of the branch's CI on GitHub; never a refusal of the token. */
    readonly ciAccess: (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      branch: string,
    ) => Effect.Effect<HqTokenCiAccess>;
  }
>()("@t3tools/hq/githubProbes") {}

const Metadata = Schema.Struct({
  id: Schema.Number,
  full_name: Schema.String,
  archived: Schema.Boolean,
  private: Schema.Boolean,
  allow_merge_commit: Schema.optionalKey(Schema.Boolean),
  allow_squash_merge: Schema.optionalKey(Schema.Boolean),
  allow_rebase_merge: Schema.optionalKey(Schema.Boolean),
  allow_auto_merge: Schema.optionalKey(Schema.Boolean),
});
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata));
/** The active rules GitHub applies to a branch, from every ruleset (`GET …/rules/branches/<b>`). */
const decodeRules = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        parameters: Schema.optionalKey(
          Schema.Struct({
            required_status_checks: Schema.optionalKey(
              Schema.Array(
                Schema.Struct({
                  context: Schema.String,
                  integration_id: Schema.optionalKey(Schema.NullOr(Schema.Number)),
                }),
              ),
            ),
          }),
        ),
      }),
    ),
  ),
);
/** GitHub's answer for a branch's rules on a plan that has none. */
const PLAN_WITHOUT_RULES =
  "Upgrade to GitHub Pro or make this repository public to enable this feature.";
const decodeMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ message: Schema.String })),
);
const date = (value: string | number | undefined) =>
  value === undefined
    ? undefined
    : Option.getOrUndefined(
        Option.map(
          DateTime.make(
            typeof value === "string"
              ? value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/u, "$1T$2Z")
              : value,
          ),
          DateTime.formatIso,
        ),
      );
/**
 * Whether GitHub's rules let changes reach a branch only by a pull request (`GET …/rules/branches/
 * <b>`, readable with the metadata every installation holds): `false` where no such rule applies or
 * the plan has no rules, `undefined` where GitHub's answer says nothing.
 */
export const pullRequestsOnly = (rules: HostReply): boolean | undefined => {
  if (
    rules.status === 403 &&
    Option.getOrUndefined(decodeMessage(rules.body))?.message === PLAN_WITHOUT_RULES
  )
    return false;
  const read = rules.status === 200 ? Option.getOrUndefined(decodeRules(rules.body)) : undefined;
  return read?.some((rule) => rule.type === "pull_request");
};
/** 403 is a host wait only with rate evidence. Requirements headers are not the token's grants. */
export const rateEvidence = (reply: HostReply, now: number) => {
  const message = Option.getOrUndefined(decodeMessage(reply.body))?.message ?? "";
  if (
    reply.status !== 429 &&
    !(
      reply.status === 403 &&
      (reply.headers["x-ratelimit-remaining"] === "0" ||
        /(?:api|secondary) rate limit|abuse detection/iu.test(message))
    )
  )
    return undefined;
  const reset = reply.headers["x-ratelimit-reset"];
  const resetMs = reset && /^\d+$/u.test(reset) ? Number(reset) * 1000 : NaN;
  const resetAt = Number.isFinite(resetMs) && resetMs <= 8.64e15 ? date(resetMs) : undefined;
  const retry = reply.headers["retry-after"];
  const retryMs =
    retry && /^\d+(?:\.\d+)?$/u.test(retry)
      ? Number(retry) * 1000
      : retry
        ? (Option.getOrUndefined(Option.map(DateTime.make(retry), DateTime.toEpochMillis)) ?? NaN) -
          now
        : NaN;
  const untilMs = resetAt === undefined ? 0 : Math.max(0, resetMs - now);
  return {
    ...(resetAt === undefined ? {} : { resetAt }),
    retryAfterMs: Math.max(untilMs, Number.isFinite(retryMs) ? Math.max(0, retryMs) : 0),
  };
};
const ssoUrl = (header: string | undefined) => {
  const raw = header?.match(/(?:^|;)\s*url=([^\s;]+)/u)?.[1];
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/orgs\/[\w.-]+\/sso$/u.test(url.pathname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const advertisementValid = (body: string) => {
  if (!body.startsWith("001f# service=git-receive-pack\n0000")) return false;
  const bytes = new TextEncoder().encode(body);
  const decoder = new TextDecoder();
  let offset = 35;
  while (offset + 4 <= bytes.length) {
    const header = decoder.decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-f]{4}$/iu.test(header)) return false;
    const length = Number.parseInt(header, 16);
    if (length === 0) return offset + 4 === bytes.length;
    if (length < 5 || offset + length > bytes.length) return false;
    offset += length;
  }
  return false;
};

/**
 * Whether the default branch's rules (`rules`, GitHub's answer for it) let only what Mate approved
 * reach it (`HqRepoGovernance`): governed where the installation (`granted`) may write statuses and
 * an active ruleset requires a pull request and `mate/gate` from the app `appId`; else the first
 * missing step. Bypass actors are not readable without administration, so they are never read.
 * `undefined` where GitHub's answer says nothing.
 */
export const governanceOf = (
  rules: HostReply,
  appId: number,
  granted: Readonly<Record<string, string>>,
): HqRepoGovernance | undefined => {
  if (!writesGate(granted)) return "permission_not_approved";
  if (
    rules.status === 403 &&
    Option.getOrUndefined(decodeMessage(rules.body))?.message === PLAN_WITHOUT_RULES
  )
    return "no_ruleset";
  const read = rules.status === 200 ? Option.getOrUndefined(decodeRules(rules.body)) : undefined;
  if (read === undefined) return undefined;
  if (!read.some((rule) => rule.type === "pull_request")) return "no_ruleset";
  const gates = read
    .flatMap((rule) =>
      rule.type === "required_status_checks" ? (rule.parameters?.required_status_checks ?? []) : [],
    )
    .filter((check) => check.context === MATE_GATE);
  if (gates.length === 0) return "gate_not_required";
  return gates.some((check) => check.integration_id === appId) ? "governed" : "gate_not_pinned";
};

export const githubProbesLayer = Layer.effect(
  GithubProbes,
  Effect.gen(function* () {
    const transport = yield* GitTransport;
    const verify = Effect.fn("GithubProbes.verify")(function* (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      branch?: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      let tokenState: "unknown" | "valid" | "invalid" = "unknown";
      const refused = (
        reason: ProbeRefused["reason"],
        extra: Partial<
          Pick<ProbeRefused, "status" | "retryAfterMs" | "resetAt" | "ssoUrl" | "scope">
        > = {},
      ) =>
        new ProbeRefused({
          reason,
          hostKind: remote.kind,
          remote: remote.path,
          branch: branch ?? "",
          tokenState,
          ...extra,
        });
      const read = (effect: Effect.Effect<HostReply, HostUnreachable>) =>
        effect.pipe(Effect.mapError(() => refused("unreachable")));
      const common = (reply: HostReply) => {
        const rate = rateEvidence(reply, now);
        if (rate) return refused("rate_limited", { status: reply.status, ...rate });
        if (reply.status === 401) {
          tokenState = "invalid";
          return refused("token_invalid", { status: 401 });
        }
        if (reply.status === 403 && reply.headers["x-github-sso"]) {
          const observed = ssoUrl(reply.headers["x-github-sso"]);
          const url = observed?.includes(Redacted.value(token)) ? undefined : observed;
          return refused("sso", { status: 403, ...(url ? { ssoUrl: url } : {}) });
        }
        return undefined;
      };
      let verified = remote;
      let hostRepoId: string | null = null;
      let expiresAt: string | null = null;
      let mergeSettings = false;
      if (remote.kind === "github") {
        const reply = yield* read(transport.metadata(remote, token));
        const failure = common(reply);
        if (failure) return yield* failure;
        if (reply.status === 200) {
          const metadata = Option.getOrUndefined(decodeMetadata(reply.body));
          if (!metadata || !Number.isSafeInteger(metadata.id) || metadata.id <= 0)
            return yield* refused("could_not_verify", { status: reply.status });
          const canonical = remoteIdentity(`https://${remote.host}/${metadata.full_name}`);
          if (!canonical || canonical.url.includes(Redacted.value(token)))
            return yield* refused("could_not_verify", { status: reply.status });
          tokenState = "valid";
          verified = canonical;
          hostRepoId = String(metadata.id);
          expiresAt = date(reply.headers["github-authentication-token-expiration"]) ?? null;
          mergeSettings = [
            metadata.allow_merge_commit,
            metadata.allow_auto_merge,
            metadata.allow_squash_merge,
            metadata.allow_rebase_merge,
          ].some((field) => field !== undefined);
          if (metadata.archived) return yield* refused("archived", { status: 200 });
          const classic = reply.headers["x-oauth-scopes"];
          if (classic !== undefined) {
            const scopes = new Set(classic.split(",").map((scope) => scope.trim()));
            if (!scopes.has("repo") && (metadata.private || !scopes.has("public_repo")))
              return yield* refused("classic_scope", {
                status: 200,
                scope: metadata.private ? "repo" : "public_repo",
              });
          }
        } else if (reply.status !== 404)
          return yield* refused("could_not_verify", { status: reply.status });
      }
      // This read is the Git receive-pack discovery, never dry-run, ls-remote, or a Git update.
      const push = yield* read(transport.receivePack(verified, token));
      const failure = common(push);
      if (failure) return yield* failure;
      if (push.status === 403) return yield* refused("push_not_granted", { status: 403 });
      if (push.status === 404) return yield* refused("not_visible", { status: 404 });
      if (
        push.status !== 200 ||
        push.headers["content-type"]?.split(";")[0]?.trim() !==
          "application/x-git-receive-pack-advertisement" ||
        !advertisementValid(push.body) ||
        (remote.kind === "github" && hostRepoId === null)
      )
        return yield* refused("could_not_verify", { status: push.status });
      tokenState = "valid";
      expiresAt ??= date(push.headers["github-authentication-token-expiration"]) ?? null;
      let branchRules: "none_on_plan" | undefined;
      if (verified.kind === "github" && branch) {
        const rules = yield* read(transport.rules(verified, branch, token));
        const failure = common(rules);
        if (failure) return yield* failure;
        // GitHub explicitly disables rules on this plan; permission failures remain unknown.
        if (
          rules.status === 403 &&
          Option.getOrUndefined(decodeMessage(rules.body))?.message === PLAN_WITHOUT_RULES
        ) {
          branchRules = "none_on_plan";
        } else {
          const decoded =
            rules.status === 200 ? Option.getOrUndefined(decodeRules(rules.body)) : undefined;
          if (!decoded) return yield* refused("could_not_verify", { status: rules.status });
          if (decoded.some((rule) => rule.type === "pull_request"))
            return yield* refused("pull_requests_only", { status: 200 });
        }
      }
      return {
        remote: verified,
        hostRepoId,
        expiresAt,
        expiryLabel: tokenExpiryLabel(expiresAt),
        mergeSettings,
        ...(branchRules ? { branchRules } : {}),
      };
    });
    const ciAccess = Effect.fn("GithubProbes.ciAccess")(function* (
      remote: RemoteIdentity,
      token: Redacted.Redacted,
      branch: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const ref = encodeURIComponent(branch);
      // A fine-grained token without the permission gets 403 and a public repository answers
      // anyway. A branch not pushed yet is GitHub's 422 or "Ref not found", after the permission.
      const access = (path: string, absent: (reply: HostReply) => boolean) =>
        transport.read(remote, path, token).pipe(
          Effect.map((reply) =>
            reply.status === 200 || absent(reply)
              ? ("granted" as const)
              : reply.status === 403 &&
                  rateEvidence(reply, now) === undefined &&
                  reply.headers["x-github-sso"] === undefined
                ? ("missing" as const)
                : ("unknown" as const),
          ),
          Effect.orElseSucceed(() => "unknown" as const),
        );
      const [checks, statuses, actions] = yield* Effect.all(
        [
          access(`/commits/${ref}/check-runs?per_page=1`, (reply) => reply.status === 422),
          access(
            `/commits/${ref}/status?per_page=1`,
            (reply) =>
              reply.status === 404 &&
              Option.getOrUndefined(decodeMessage(reply.body))?.message === "Ref not found",
          ),
          access(`/actions/runs?per_page=1&branch=${ref}`, () => false),
        ],
        { concurrency: "unbounded" },
      );
      return { checks, statuses, actions };
    });
    return GithubProbes.of({ verify, ciAccess });
  }),
);
