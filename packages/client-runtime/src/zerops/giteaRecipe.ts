/**
 * The account's Gitea project, as one import document.
 *
 * Four services and nothing else: Gitea, its Postgres, a volume, and the
 * broker that mirrors Zerops roles into Gitea, signs people in, hands each Mate
 * its Gitea access and holds the only deploy key. Both code services build
 * from `zeropsio/gitea-mate` and pick their half with `zeropsSetup`.
 *
 * ## What it costs an account that never adds a project
 *
 * Gitea, one Postgres and the broker. The published recipe imported
 * `postgresql:ha@18` and three runner containers for every account; neither is
 * needed. One org's Gitea runs on one node, with durability from `gitea dump`
 * and the platform's own database backups, and the runners are **not here at
 * all** — the broker imports one per group when that group's first workflow
 * appears, and removes it with the group.
 *
 * ## What the app fills in, and what it must not
 *
 * Six placeholders, all of them things only the browser session knows:
 *
 * - `__REGION__` — the project's real region. The published recipe hardcoded
 *   `app-prg1.zerops.app`, a host that does not resolve; Gitea derives
 *   `ROOT_URL` and `SSH_DOMAIN` from it, so left alone every clone URL and web
 *   link it emits points nowhere (measured 2026-09-05).
 * - `__CORS__` — every origin the Mate app runs from, comma-separated and
 *   spelled exactly. Gitea's `ALLOW_DOMAIN` matches the origin string
 *   literally: `localhost` does not cover `127.0.0.1`, and a port is part of
 *   the string (measured 2026-09-16). Without it the app's own PKCE exchange
 *   against Gitea fails with `Failed to fetch` before a request is made.
 * - `__ZEROPS_TOKEN__` — the broker's Zerops token, minted moments earlier.
 * - `__ZEROPS_CLIENT_ID__`, `__ZEROPS_PROJECT_ID__` — the org, and the project
 *   the registry lives on.
 * - `__MATE_APP_URL__` — where the Gitea sign-in consent page lives.
 *
 * Everything else the broker needs is generated **by the platform's import
 * preprocessor**, inside the import: its webhook secret, Gitea's OIDC client
 * secret and the seed its signing key is derived from. None of them passes
 * through the browser, so none of them can be logged, stored or replayed by
 * anything the app touches.
 *
 * The broker's token is the one secret the app does hold, for the seconds
 * between minting it and posting this document. It is never stored, and the
 * only reason it can be handed over at all is that the platform will not mint
 * a token and tell you its value twice.
 *
 * @module giteaRecipe
 */

/** Replaced with the project's region before import. */
const REGION_PLACEHOLDER = "__REGION__";
/** Replaced with the app's origins, comma-separated. */
const CORS_PLACEHOLDER = "__CORS__";
/** Replaced with the broker's Zerops token. Never stored anywhere else. */
const BROKER_TOKEN_PLACEHOLDER = "__ZEROPS_TOKEN__";
const CLIENT_ID_PLACEHOLDER = "__ZEROPS_CLIENT_ID__";
const PROJECT_ID_PLACEHOLDER = "__ZEROPS_PROJECT_ID__";
const APP_URL_PLACEHOLDER = "__MATE_APP_URL__";

/** Every placeholder the document carries, so a test can prove none is left. */
export const GITEA_IMPORT_PLACEHOLDERS: ReadonlyArray<string> = [
  REGION_PLACEHOLDER,
  CORS_PLACEHOLDER,
  BROKER_TOKEN_PLACEHOLDER,
  CLIENT_ID_PLACEHOLDER,
  PROJECT_ID_PLACEHOLDER,
  APP_URL_PLACEHOLDER,
];

/** Where both services build from, and what `zeropsSetup` picks out of it. */
export const GITEA_MATE_REPOSITORY = "https://github.com/zeropsio/gitea-mate";

const GITEA_IMPORT_TEMPLATE = `#zeropsPreprocessor=on
services:
  - hostname: db
    type: postgresql@18
    mode: NON_HA
    priority: 10

  - hostname: volume
    type: local-storage@1
    priority: 10

  - hostname: web
    type: ubuntu@26.04
    priority: 5
    vault:
      DB_PASSWORD:
        value: <@generateRandomString(<32>)>
        sensitive: true
      GITEA_DOMAIN: web-\${zeropsSubdomainHost}-3000.__REGION__.zerops.app
      GITEA_CORS_ALLOW_DOMAIN: __CORS__
      BROKER_PUBLIC_URL: https://broker-\${zeropsSubdomainHost}-8080.__REGION__.zerops.app
      OIDC_CLIENT_SECRET: \${broker_OIDC_CLIENT_SECRET}
    maxContainers: 1
    verticalAutoscaling:
      minRam: 0.25
    buildFromGit: ${GITEA_MATE_REPOSITORY}
    zeropsSetup: gitea
    enableSubdomainAccess: true

  - hostname: broker
    type: ubuntu@26.04
    vault:
      ZEROPS_TOKEN:
        value: __ZEROPS_TOKEN__
        sensitive: true
      ZEROPS_API_URL: https://api.app-__REGION__.zerops.io
      ZEROPS_CLIENT_ID: __ZEROPS_CLIENT_ID__
      ZEROPS_PROJECT_ID: __ZEROPS_PROJECT_ID__
      GITEA_URL: http://web:3000
      GITEA_PUBLIC_URL: https://web-\${zeropsSubdomainHost}-3000.__REGION__.zerops.app
      GITEA_ADMIN_TOKEN: \${web_GITEA_ADMIN_TOKEN}
      GITEA_WEBHOOK_SECRET:
        value: <@generateRandomString(<32>)>
        sensitive: true
      OIDC_CLIENT_SECRET:
        value: <@generateRandomString(<32>)>
        sensitive: true
      OIDC_SEED:
        value: <@generateRandomString(<64>)>
        sensitive: true
      BROKER_PUBLIC_URL: https://broker-\${zeropsSubdomainHost}-8080.__REGION__.zerops.app
      MATE_APP_URL: __MATE_APP_URL__
      LISTEN_ADDR: ":8080"
    maxContainers: 1
    verticalAutoscaling:
      minRam: 0.25
    buildFromGit: ${GITEA_MATE_REPOSITORY}
    zeropsSetup: broker
    enableSubdomainAccess: true
`;

export interface GiteaImportInput {
  /** `zeropsRegionFromPublicZone` off the freshly created project. */
  readonly region: string;
  /**
   * Every origin the Mate app is served from — the current one at least.
   * Listed literally, port included; Gitea matches the string.
   */
  readonly appOrigins: ReadonlyArray<string>;
  /** Where the Gitea sign-in consent page lives. */
  readonly appUrl: string;
  /** The org that owns the project. */
  readonly clientId: string;
  /** The project this document is imported into — where the registry lives. */
  readonly projectId: string;
  /**
   * The broker's Zerops token, minted for this import. The value exists in
   * this string and nowhere else: not in storage, not in a log, not in a
   * fixture.
   */
  readonly brokerToken: string;
}

/** The import body for the account's Gitea project, with every blank filled. */
export function buildGiteaImportYaml(input: GiteaImportInput): string {
  const origins = [...new Set(input.appOrigins.map((origin) => origin.trim().replace(/\/+$/u, "")))]
    .filter((origin) => origin.length > 0)
    .join(",");
  if (origins.length === 0) {
    // A Gitea that answers no browser origin cannot be driven from the app at
    // all (P11), and the failure is a `Failed to fetch` with no request made —
    // exactly the kind of thing worth refusing to build.
    throw new Error("The Gitea import needs at least the app's own origin for CORS.");
  }
  return GITEA_IMPORT_TEMPLATE.split(REGION_PLACEHOLDER)
    .join(input.region)
    .split(CORS_PLACEHOLDER)
    .join(origins)
    .split(CLIENT_ID_PLACEHOLDER)
    .join(input.clientId)
    .split(PROJECT_ID_PLACEHOLDER)
    .join(input.projectId)
    .split(APP_URL_PLACEHOLDER)
    .join(input.appUrl.replace(/\/+$/u, ""))
    .split(BROKER_TOKEN_PLACEHOLDER)
    .join(input.brokerToken);
}
