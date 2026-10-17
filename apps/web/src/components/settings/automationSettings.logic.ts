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
  "Mate acts on GitHub as your organization's own app: comments, branches and pull requests appear as its bot, never as a person.";
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
      readonly slug: string;
      readonly appUrl: string;
      readonly installUrl: string;
      readonly installations: ReadonlyArray<{
        readonly id: number;
        readonly line: string;
        readonly manageUrl: string;
      }>;
      /** `manage`: this person may install it further or disconnect it. */
      readonly manage: boolean;
    };

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
        slug: view.slug,
        appUrl: view.appUrl,
        installUrl: view.installUrl,
        installations: view.installations.map((installation) => ({
          id: installation.id,
          line: installation.suspended
            ? `${installation.account} · suspended`
            : installationLine(installation),
          manageUrl: installation.manageUrl,
        })),
        manage: admin,
      };
    }
  }
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

/** The repositories the app reaches, by `owner/name`, as the mirror dialog offers them. */
export function appRepositories(view: HqGithubView | null): ReadonlyArray<string> {
  if (view === null || view.state !== "connected") return [];
  const names = new Set<string>();
  for (const installation of view.installations)
    if (!installation.suspended)
      for (const repository of installation.repositories) names.add(repository.fullName);
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

/** The app's name as the mirror dialog says it: GitHub's, else its slug. */
export function appName(view: Extract<HqGithubView, { readonly state: "connected" }>): string {
  return view.name ?? view.slug;
}
