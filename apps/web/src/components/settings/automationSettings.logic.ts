/**
 * What Settings › Automation's GitHub section says, from what HQ answered of the organization's
 * GitHub app: connected or not, where it is installed, an HQ older than the app, or a person who
 * may not see it — and how a press of *Create GitHub app* hands GitHub HQ's manifest.
 */
import type { SettingValue } from "@t3tools/client-runtime/data";
import type {
  HqGithubInstallation,
  HqGithubManifestView,
  HqGithubView,
} from "@t3tools/shared/hqGithub";

/** GitHub's cap on an app's name. */
export const APP_NAME_MAX = 34;

export const GITHUB_ONE_LINE =
  "Everything Mate writes on GitHub appears as your organization's bot, never a person.";
export const GITHUB_OLDER_HQ = "Update HQ to connect GitHub";
const WITHHELD = "Only the organization's Owner and Admins see this.";

export type GithubSection =
  | { readonly kind: "reading" }
  | { readonly kind: "older" }
  | { readonly kind: "withheld" }
  | { readonly kind: "failed"; readonly words: string }
  /** `connect`: this person may make the app. */
  | { readonly kind: "none"; readonly connect: boolean }
  | {
      readonly kind: "connected";
      readonly botLogin: string;
      /** The account that owns the app. */
      readonly owner: string;
      readonly installUrl: string;
      /** Where it is installed and Mate acts, or GitHub suspended it. */
      readonly installations: ReadonlyArray<{
        readonly id: number;
        readonly line: string;
        readonly manageUrl: string;
        readonly suspended: boolean;
      }>;
      /**
       * Installed where nobody here started it: Mate acts on none of it until an OK. Its page on
       * GitHub is its account's, which the organization's admins cannot open.
       */
      readonly waiting: ReadonlyArray<{
        readonly id: number;
        readonly account: string;
        /** Its repositories, by `owner/name`. */
        readonly repositories: ReadonlyArray<string>;
      }>;
      /**
       * A private app: installable on its owner alone. `settings`: `url` is the GitHub page that
       * makes it public; otherwise the app's own page, its owner's kind unknown.
       */
      readonly privateTo: {
        readonly owner: string;
        readonly url: string;
        readonly settings: boolean;
      } | null;
      /**
       * HQ hands install trips, accepts, suspends and resumes: one that predates the guard (its view
       * says nothing of `public`) has GitHub's own install page only.
       */
      readonly installTrip: boolean;
      /** `manage`: this person may install it further, judge what waits, or disconnect it. */
      readonly manage: boolean;
    };

/**
 * Where an installation stands: what HQ says, or for an HQ that predates the guard, accepted
 * unless GitHub suspended it — that HQ acts on every installation it lists.
 */
export function installationStanding(
  installation: Pick<HqGithubInstallation, "suspended" | "state">,
): "accepted" | "waiting" | "suspended" {
  if (installation.suspended) return "suspended";
  return installation.state ?? "accepted";
}

/**
 * Where a private app is made public: its owner's settings page (an organization's or a person's,
 * as HQ says), or the app's own page where HQ does not say which.
 */
function makePublicAt(view: Extract<HqGithubView, { readonly state: "connected" }>) {
  const slug = encodeURIComponent(view.slug);
  if (view.ownerType === "Organization")
    return {
      url: `https://github.com/organizations/${encodeURIComponent(view.owner)}/settings/apps/${slug}/advanced`,
      settings: true,
    };
  if (view.ownerType === "User")
    return { url: `https://github.com/settings/apps/${slug}/advanced`, settings: true };
  return { url: `https://github.com/apps/${slug}`, settings: false };
}

/** Where the app is installed, in a line: "acme · 3 repositories". */
export function installationLine(
  installation: Pick<HqGithubInstallation, "account" | "repositorySelection" | "repositories">,
): string {
  const reach =
    installation.repositorySelection === "all"
      ? "all repositories"
      : installation.repositories.length === 1
        ? "1 repository"
        : `${installation.repositories.length} repositories`;
  return `${installation.account} · ${reach}`;
}

/** The section's state, from HQ's answer and whether the person is the organization's Owner or an Admin. */
export function githubSection(setting: SettingValue<HqGithubView>, admin: boolean): GithubSection {
  switch (setting.state) {
    case "unsupported":
      return { kind: "older" };
    case "withheld":
      return { kind: "withheld" };
    case "failed":
      return { kind: "failed", words: setting.words };
    case "unread":
    case "reading":
      return { kind: "reading" };
    case "known": {
      const view = setting.held;
      if (view.state === "none") return { kind: "none", connect: admin };
      return {
        kind: "connected",
        botLogin: view.botLogin,
        owner: view.owner,
        installUrl: view.installUrl,
        installations: view.installations
          .filter((installation) => installationStanding(installation) !== "waiting")
          .map((installation) => ({
            id: installation.id,
            line:
              installationStanding(installation) === "suspended"
                ? `${installation.account} · suspended`
                : installationLine(installation),
            manageUrl: installation.manageUrl,
            suspended: installationStanding(installation) === "suspended",
          })),
        waiting: view.installations
          .filter((installation) => installationStanding(installation) === "waiting")
          .map((installation) => ({
            id: installation.id,
            account: installation.account,
            repositories: installation.repositories.map((repository) => repository.fullName),
          })),
        privateTo: view.public === false ? { owner: view.owner, ...makePublicAt(view) } : null,
        installTrip: view.public !== undefined,
        manage: admin,
      };
    }
  }
}

/**
 * How GitHub brought the person back here: the app made or installed, an owner's approval asked
 * for, or installed where nobody here started it.
 */
export type GithubReturn = "connected" | "requested" | "waiting" | null;

/** The one line said on the return from GitHub; `null` where there is nothing true to say. */
export function githubReturnLine(returned: GithubReturn, section: GithubSection): string | null {
  if (returned === "requested")
    return `GitHub asked an owner of ${section.kind === "connected" ? section.owner : "the organization"} to approve the app; it's installed once they do.`;
  // Said only while an installation waits here: not for another organization, nor after its OK.
  if (returned === "waiting")
    return section.kind === "connected" && section.waiting.length > 0
      ? "GitHub installed the app. It waits for an Owner's or Admin's OK before Mate uses it."
      : null;
  if (returned === "connected" && section.kind === "connected")
    return `GitHub is connected. Mate acts there as ${section.botLogin} from now on.`;
  return null;
}

/** The section's state line. */
export function githubStatus(section: GithubSection): string {
  switch (section.kind) {
    case "reading":
      return "Reading…";
    case "older":
      return GITHUB_OLDER_HQ;
    case "withheld":
      return WITHHELD;
    case "failed":
      return section.words;
    case "none":
      return section.connect
        ? "Not connected"
        : "Not connected · The organization's Owner and Admins connect it.";
    case "connected":
      return `Connected as ${section.botLogin}`;
  }
}

/** The app's name as first offered: the organization's, within GitHub's cap. */
export function defaultAppName(organization: string | null | undefined): string {
  const name = `${(organization ?? "").trim() || "Zerops"} Mate`;
  return name.length <= APP_NAME_MAX ? name : `${name.slice(0, APP_NAME_MAX - 5).trimEnd()} Mate`;
}

/** What is wrong with a typed app name, said before anything is sent; `null` when it can go. */
export function appNameProblem(name: string): string | null {
  const typed = name.trim();
  if (typed.length === 0) return "Name the app.";
  if (typed.length > APP_NAME_MAX) return `GitHub takes at most ${APP_NAME_MAX} characters.`;
  return null;
}

/** The GitHub organization typed to own the app: `null` for the person's own account. */
export function appOwner(typed: string): string | null {
  const owner = typed
    .trim()
    .replace(/^https?:\/\/github\.com\//iu, "")
    .replace(/^@/u, "")
    .replace(/\/+$/u, "");
  return owner.length === 0 ? null : owner;
}

/** Where GitHub sends the person back once the app is made and installed: this page. */
export function githubReturnTo(origin: string, basePath: string): string {
  return `${origin}${basePath}/settings/automation?github=connected`;
}

/**
 * Hands GitHub HQ's manifest the way its "new app" page reads it: a form posted in this tab, its
 * `manifest` field the app's definition. GitHub's page takes over from here.
 */
export function postManifest(
  doc: Document,
  view: Pick<HqGithubManifestView, "postUrl" | "manifest">,
) {
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = view.postUrl;
  form.hidden = true;
  const field = doc.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = view.manifest;
  form.append(field);
  doc.body.append(form);
  form.submit();
}

/**
 * The repositories the app reaches, by `owner/name`, as every picker offers them (the mirror dialog,
 * the origin sheet).
 */
export function appRepositories(view: HqGithubView | null): ReadonlyArray<string> {
  if (view === null || view.state !== "connected") return [];
  const names = new Set<string>();
  // Only where Mate acts: never a suspended installation's, nor one still waiting for an OK.
  for (const installation of view.installations)
    if (installationStanding(installation) === "accepted")
      for (const repository of installation.repositories) names.add(repository.fullName);
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

/** The app's name as the mirror dialog says it: GitHub's, else its slug. */
export function appName(view: Extract<HqGithubView, { readonly state: "connected" }>): string {
  return view.name ?? view.slug;
}
