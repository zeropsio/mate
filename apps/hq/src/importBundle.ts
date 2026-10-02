// @effect-diagnostics nodeBuiltinImport:off -- a bundle is files on the volume, read and hashed as they lie.
/**
 * The frozen bundle the migration from main imports (T13, `importJob.ts`): what one account's Gitea
 * and Zerops held, written by the read-only exporter (`nastroje/migrace/` in the plans), checked
 * here — the one source of its shape. Migration-only: it goes with T14.
 *
 * A bundle is a directory. `manifest.json` names every other file with its SHA-256, and the bundle's
 * digest is the manifest's own: a file changed, added or missing is another bundle, or none.
 * `mapping.json` holds the applications — their projects, Mates, environments and repositories,
 * each repository a `git bundle` with the refs it must leave; `changes.json` main's pull requests
 * by Mates, with their comments and pictures; `releases.json` main's `v*` tags with their verdicts.
 *
 * @module importBundle
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ATTACHMENT_MAX_BYTES,
  ChangeBody,
  ChangeTitle,
  CommentBody,
  RepoName,
  Sha,
} from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { ReleaseTag, parseReleaseMessage } from "@t3tools/shared/hqRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TIER_SOURCES } from "./environments.ts";
import { rewriteTier } from "./importTiers.ts";

export const BUNDLE_VERSION = 1;
export const MANIFEST = "manifest.json";
export const MAPPING = "mapping.json";
export const CHANGES = "changes.json";
export const RELEASES = "releases.json";

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u;
/** A file of the bundle, by its path inside it: no absolute path, no `..`, no hidden name. */
const FilePath = Schema.String.check(
  Schema.makeFilter((path: string) =>
    path.split("/").every((part) => SEGMENT.test(part)) ? undefined : "Expected a bundle path",
  ),
);
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const Instant = Schema.String.check(
  Schema.makeFilter((at: string) => (Number.isNaN(Date.parse(at)) ? "Expected a time" : undefined)),
);
const Name = Schema.String.check(
  Schema.makeFilter((name: string) =>
    name.length >= 1 && name.length <= 100 ? undefined : "Expected 1 to 100 characters",
  ),
);
const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u));
const RefName = Schema.String.check(Schema.isPattern(/^refs\/[A-Za-z0-9._/-]+$/u));

export const Manifest = Schema.Struct({
  version: Schema.Literal(BUNDLE_VERSION),
  /** The account (Zerops org) the bundle was read from. */
  orgId: Schema.String,
  exportedAt: Instant,
  /** The person whose sign-in read it: who the imported records say made them. */
  exportedBy: Id,
  files: Schema.Record(FilePath, Digest),
});
export type Manifest = typeof Manifest.Type;

export const BundleMate = Schema.Struct({
  name: Name,
  face: Schema.String,
  standupRequestedBy: Schema.NullOr(Id),
  closedOff: Schema.Boolean,
});

export const BundleProject = Schema.Struct({
  projectId: Id,
  kind: Schema.Literals(["mate", "stage", "production"]),
  mate: Schema.NullOr(BundleMate),
});

/** A stage's or a production's environment, in the order `environments.yaml` declared it. */
export const BundleEnvironment = Schema.Struct({
  projectId: Id,
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u)),
  sources: Schema.Array(Schema.String),
});

export const BundleRef = Schema.Struct({ ref: RefName, sha: Sha });

/** A repository: its `git bundle`, and the branches and tags it must hold once imported. */
export const BundleRepo = Schema.Struct({
  name: RepoName,
  bundle: FilePath,
  refs: Schema.Array(BundleRef),
});

/** A tier of the application's recipe as main's `group` repository holds it: `<n> — <Title>/import.yaml`. */
export const BundleTier = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^[^/]+\/import\.yaml$/u)),
  content: Schema.String,
});

export const BundleApp = Schema.Struct({
  /** The group's id on main: what the bundle's other files name the application by. */
  key: Id,
  name: Name,
  /** Where main's tiers name the application's repositories: Gitea's host and the group's org. */
  gitea: Schema.Struct({ host: Schema.String, owner: Id }),
  projects: Schema.Array(BundleProject),
  environments: Schema.Array(BundleEnvironment),
  repos: Schema.Array(BundleRepo),
  /** Its `group` repository's tiers at the bundle's `main`, which the import makes build from HQ. */
  tiers: Schema.Array(BundleTier),
});
export type BundleApp = typeof BundleApp.Type;

export const Mapping = Schema.Struct({ apps: Schema.Array(BundleApp) });
export type Mapping = typeof Mapping.Type;

export const BundleAuthor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), userId: Id }),
  Schema.Struct({ kind: Schema.Literal("mate"), projectId: Id }),
]);

export const BundleComment = Schema.Struct({
  author: BundleAuthor,
  body: CommentBody,
  at: Instant,
});

/** A picture a change's description links to: its file, and each address the description spells. */
export const BundleAttachment = Schema.Struct({
  key: Id,
  file: FilePath,
  urls: Schema.Array(Schema.String),
});

/** A pull request a Mate opened on main: its change, under the same number. */
export const BundleChange = Schema.Struct({
  app: Id,
  repo: RepoName,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  mateProjectId: Id,
  title: ChangeTitle,
  body: ChangeBody,
  state: Schema.Literals(["open", "merged", "closed"]),
  head: Sha,
  /** Where the repository's `git bundle` holds the head: it becomes the change's branch. */
  headRef: RefName,
  mergedSha: Schema.NullOr(Sha),
  openedAt: Instant,
  mergedAt: Schema.NullOr(Instant),
  closedAt: Schema.NullOr(Instant),
  comments: Schema.Array(BundleComment),
  attachments: Schema.Array(BundleAttachment),
});
export type BundleChange = typeof BundleChange.Type;

export const Changes = Schema.Struct({ changes: Schema.Array(BundleChange) });

/** A `v*` tag of an application's recipe repository, with main's broker's verdict on it. */
export const BundleRelease = Schema.Struct({
  app: Id,
  tag: ReleaseTag,
  /** The commit the tag peels to. */
  sha: Sha,
  state: Schema.Literals(["approved", "refused"]),
  reason: Schema.NullOr(Schema.String),
  message: Schema.String,
  /** Who tagged it on main, and the person that is, where it is one. */
  tagger: Schema.Struct({ login: Schema.String, userId: Schema.NullOr(Id) }),
  at: Instant,
});
export type BundleRelease = typeof BundleRelease.Type;

export const Releases = Schema.Struct({ releases: Schema.Array(BundleRelease) });

export interface Bundle {
  readonly dir: string;
  readonly digest: string;
  readonly manifest: Manifest;
  readonly mapping: Mapping;
  readonly changes: ReadonlyArray<BundleChange>;
  readonly releases: ReadonlyArray<BundleRelease>;
}

/** What is wrong with a bundle, every finding named: nothing of it is imported. */
export class BundleRefused extends Schema.TaggedError<BundleRefused>()("BundleRefused", {
  problems: Schema.Array(Schema.String),
}) {}

const refused = (...problems: ReadonlyArray<string>) => new BundleRefused({ problems });

const sha256 = (path: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const hash = NodeCrypto.createHash("sha256");
        NodeFS.createReadStream(path)
          .on("error", reject)
          .on("data", (chunk) => hash.update(chunk))
          .on("end", () => resolve(hash.digest("hex")));
      }),
    catch: () => refused(`${NodePath.basename(path)} cannot be read`),
  });

/** A listed file's bytes, once they are what the manifest says. */
export const listedFile = (bundle: Pick<Bundle, "dir" | "manifest">, path: string) =>
  Effect.gen(function* () {
    const digest = bundle.manifest.files[path];
    if (digest === undefined) return yield* refused(`${path} is not in the manifest`);
    const full = NodePath.join(bundle.dir, path);
    if ((yield* sha256(full)) !== digest) return yield* refused(`${path} is not what was frozen`);
    return full;
  });

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));
const decodeMapping = Schema.decodeEffect(Schema.fromJsonString(Mapping));
const decodeChanges = Schema.decodeEffect(Schema.fromJsonString(Changes));
const decodeReleases = Schema.decodeEffect(Schema.fromJsonString(Releases));

const decoded = <A>(
  bundle: Pick<Bundle, "dir" | "manifest">,
  path: string,
  decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
) =>
  Effect.gen(function* () {
    const full = yield* listedFile(bundle, path);
    const text = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(full, "utf8"),
      catch: () => refused(`${path} cannot be read`),
    });
    return yield* decode(text).pipe(
      Effect.mapError((error) => refused(`${path}: ${error.message}`)),
    );
  });

/** The bundle in `dir`: its manifest, and the three files it is read by, each as frozen. */
export const readBundle = (dir: string) =>
  Effect.gen(function* () {
    const full = NodePath.resolve(dir);
    const manifestPath = NodePath.join(full, MANIFEST);
    const text = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(manifestPath, "utf8"),
      catch: () => refused(`${MANIFEST} cannot be read`),
    });
    const digest = yield* sha256(manifestPath);
    const manifest = yield* decodeManifest(text).pipe(
      Effect.mapError((error) => refused(`${MANIFEST}: ${error.message}`)),
    );
    const at = { dir: full, manifest };
    const mapping = yield* decoded(at, MAPPING, decodeMapping);
    const changes = yield* decoded(at, CHANGES, decodeChanges);
    const releases = yield* decoded(at, RELEASES, decodeReleases);
    return {
      dir: full,
      digest,
      manifest,
      mapping,
      changes: changes.changes,
      releases: releases.releases,
    } satisfies Bundle;
  });

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A picture HQ keeps as a Mate would send it: a PNG of at most {@link ATTACHMENT_MAX_BYTES}. */
export const pictureProblem = (bytes: Uint8Array): string | undefined =>
  bytes.byteLength > ATTACHMENT_MAX_BYTES
    ? "is larger than a picture HQ keeps"
    : PNG.every((byte, i) => bytes[i] === byte)
      ? undefined
      : "is no PNG";

const walk = async (dir: string, prefix = ""): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = [];
  for (const entry of await NodeFSP.readdir(dir, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(NodePath.join(dir, entry.name), path)));
    else found.push(path);
  }
  return found;
};

/** Every file as frozen and nothing beside them; every picture one HQ keeps. */
export const fileProblems = (bundle: Bundle) =>
  Effect.gen(function* () {
    const problems: Array<string> = [];
    const present = yield* Effect.tryPromise({
      try: () => walk(bundle.dir),
      catch: () => refused("the bundle's directory cannot be read"),
    });
    for (const path of present) {
      if (path !== MANIFEST && bundle.manifest.files[path] === undefined)
        problems.push(`${path} is not in the manifest`);
    }
    for (const path of Object.keys(bundle.manifest.files)) {
      const listed = yield* Effect.result(listedFile(bundle, path));
      if (listed._tag === "Failure") problems.push(...listed.failure.problems);
    }
    for (const change of bundle.changes) {
      for (const attachment of change.attachments) {
        const bytes = yield* Effect.tryPromise({
          try: () => NodeFSP.readFile(NodePath.join(bundle.dir, attachment.file)),
          catch: () => refused(`${attachment.file} cannot be read`),
        }).pipe(Effect.orElseSucceed(() => undefined));
        const problem = bytes === undefined ? undefined : pictureProblem(bytes);
        if (problem !== undefined) problems.push(`${attachment.file} ${problem}`);
      }
    }
    return problems;
  });

const duplicates = (values: ReadonlyArray<string>) => [
  ...new Set(values.filter((value, i) => values.indexOf(value) !== i)),
];

/**
 * What the bundle's files say that HQ cannot hold, or that contradicts the rest of the bundle; none
 * for a bundle the job can import whole. Each finding names its application, change or tag.
 */
export const bundleProblems = (bundle: Omit<Bundle, "dir" | "digest">): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const { apps } = bundle.mapping;
  for (const key of duplicates(apps.map((app) => app.key))) problems.push(`app ${key} twice`);
  for (const name of duplicates(apps.map((app) => app.name)))
    problems.push(`app name ${name} twice`);
  const projects = apps.flatMap((app) => app.projects.map((project) => ({ app, project })));
  for (const id of duplicates(projects.map(({ project }) => project.projectId)))
    problems.push(`project ${id} twice`);
  const appOf = new Map(apps.map((app) => [app.key, app]));
  const mateIn = (key: string, projectId: string) =>
    appOf
      .get(key)
      ?.projects.some((project) => project.projectId === projectId && project.kind === "mate") ??
    false;

  for (const app of apps) {
    const at = `app ${app.key}`;
    for (const project of app.projects) {
      if ((project.kind === "mate") !== (project.mate !== null))
        problems.push(`${at}: project ${project.projectId} has a Mate record only if it is a Mate`);
    }
    if (app.projects.filter((project) => project.kind === "production").length > 1)
      problems.push(`${at}: more than one production`);
    for (const name of duplicates(app.environments.map((env) => env.name)))
      problems.push(`${at}: environment ${name} twice`);
    for (const id of duplicates(app.environments.map((env) => env.projectId)))
      problems.push(`${at}: project ${id} has two environments`);
    for (const env of app.environments) {
      const project = app.projects.find((candidate) => candidate.projectId === env.projectId);
      if (project === undefined || project.kind === "mate") {
        problems.push(`${at}: environment ${env.name} is on no stage or production of its own`);
        continue;
      }
      if (env.sources.join(",") !== TIER_SOURCES[project.kind].join(","))
        problems.push(`${at}: environment ${env.name} follows what HQ does not deploy`);
    }
    for (const name of duplicates(app.repos.map((repo) => repo.name)))
      problems.push(`${at}: repository ${name} twice`);
    for (const path of duplicates(app.tiers.map((tier) => tier.path)))
      problems.push(`${at}: tier ${path} twice`);
    if (app.tiers.length > 0 && !app.repos.some((repo) => repo.name === RECIPE_REPO))
      problems.push(`${at}: tiers with no ${RECIPE_REPO} repository`);
    for (const repo of app.repos) {
      const where = `${at}/${repo.name}`;
      if (bundle.manifest.files[repo.bundle] === undefined)
        problems.push(`${where}: ${repo.bundle} is not in the manifest`);
      if (!repo.refs.some((ref) => ref.ref === "refs/heads/main"))
        problems.push(`${where}: no main`);
      for (const ref of duplicates(repo.refs.map((entry) => entry.ref)))
        problems.push(`${where}: ${ref} twice`);
      for (const ref of repo.refs) {
        if (!/^refs\/(?:heads|tags)\//u.test(ref.ref) || ref.ref.startsWith("refs/heads/mate/"))
          problems.push(`${where}: ${ref.ref} is no branch or tag an import keeps`);
      }
    }
  }

  const changeKey = (change: BundleChange) =>
    `${change.app}/${change.repo}#${String(change.number)}`;
  for (const key of duplicates(bundle.changes.map(changeKey))) problems.push(`change ${key} twice`);
  const open = bundle.changes
    .filter((change) => change.state === "open")
    .map((change) => `${change.app}/${change.repo} ${change.mateProjectId}`);
  for (const pair of duplicates(open)) problems.push(`${pair} has two open changes`);
  for (const ref of duplicates(
    bundle.changes.map((change) => `${change.app}/${change.repo} ${change.headRef}`),
  ))
    problems.push(`${ref} heads two changes`);
  const attachments = bundle.changes.flatMap((change) => change.attachments);
  for (const key of duplicates(attachments.map((attachment) => attachment.key)))
    problems.push(`attachment ${key} twice`);
  for (const change of bundle.changes) {
    const at = `change ${changeKey(change)}`;
    const app = appOf.get(change.app);
    if (app === undefined) {
      problems.push(`${at}: no app ${change.app}`);
      continue;
    }
    if (!app.repos.some((repo) => repo.name === change.repo))
      problems.push(`${at}: no repository ${change.repo}`);
    if (!mateIn(change.app, change.mateProjectId))
      problems.push(`${at}: ${change.mateProjectId} is no Mate of its app`);
    const times =
      change.state === "merged"
        ? change.mergedSha !== null && change.mergedAt !== null
        : change.state === "closed"
          ? change.mergedSha === null && change.closedAt !== null
          : change.mergedSha === null && change.mergedAt === null && change.closedAt === null;
    if (!times) problems.push(`${at}: its state and its times disagree`);
    for (const comment of change.comments) {
      if (comment.author.kind === "mate" && !mateIn(change.app, comment.author.projectId))
        problems.push(`${at}: a comment's Mate ${comment.author.projectId} is no Mate of its app`);
    }
    for (const attachment of change.attachments) {
      if (bundle.manifest.files[attachment.file] === undefined)
        problems.push(`${at}: ${attachment.file} is not in the manifest`);
      if (attachment.urls.length === 0 || attachment.urls.some((url) => !change.body.includes(url)))
        problems.push(`${at}: attachment ${attachment.key} is not linked as named`);
    }
  }

  for (const key of duplicates(bundle.releases.map((release) => `${release.app} ${release.tag}`)))
    problems.push(`release ${key} twice`);
  for (const release of bundle.releases) {
    const at = `release ${release.app} ${release.tag}`;
    const app = appOf.get(release.app);
    const recipe = app?.repos.find((repo) => repo.name === RECIPE_REPO);
    if (recipe === undefined) problems.push(`${at}: its app has no ${RECIPE_REPO} repository`);
    else if (!recipe.refs.some((ref) => ref.ref === `refs/tags/${release.tag}`))
      problems.push(`${at}: the tag is not in ${RECIPE_REPO}`);
    if ((release.state === "refused") !== (release.reason !== null))
      problems.push(`${at}: a reason goes with a refusal, and only with one`);
    if (release.tagger.userId === null)
      problems.push(`${at}: tagged by ${release.tagger.login}, who is no person`);
    if (release.state === "approved" && "refused" in parseReleaseMessage(release.message))
      problems.push(`${at}: its message lists no release`);
  }
  return problems;
};

/**
 * What a tier names of Gitea that the import leaves as it is (`importTiers.ts`): another org's
 * repository, one the bundle lacks, another host, Gitea named outside a build. Notes, not
 * findings: the import brings the bundle whole and says them again.
 */
export const bundleNotes = (bundle: Omit<Bundle, "dir" | "digest">): ReadonlyArray<string> =>
  bundle.mapping.apps.flatMap((app) =>
    app.tiers.flatMap((tier) =>
      rewriteTier(tier.content, {
        host: app.gitea.host,
        owner: app.gitea.owner,
        repos: app.repos.map((repo) => repo.name),
        to: (repo) => `hq/${repo}`,
      }).notes.map((note) => `app ${app.key} ${tier.path}: ${note}`),
    ),
  );

/** The bundle in `dir` checked whole — files, shape, sense — or every finding against it. */
export const checkBundle = (dir: string) =>
  Effect.gen(function* () {
    const bundle = yield* readBundle(dir);
    const problems = [...(yield* fileProblems(bundle)), ...bundleProblems(bundle)];
    if (problems.length > 0) return yield* refused(...problems);
    return bundle;
  });
