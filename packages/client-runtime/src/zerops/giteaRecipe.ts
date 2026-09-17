/**
 * The account's Gitea project, as one import document.
 *
 * Four services and nothing else: Gitea, its Postgres, a volume, and the
 * broker that mirrors Zerops roles into Gitea, signs people in, hands each Mate
 * its Gitea access and holds the only deploy key. Both code services build
 * from `zeropsio/gitea-mate` and pick their half with `zeropsSetup`.
 *
 * ## Where the document comes from
 *
 * It is not written here. `zeropsio/gitea-mate` owns it, at
 * `import/gitea-project.yaml`, next to the services it stands up; this package
 * carries a byte-identical copy in `giteaProjectImport.yaml` and reads it
 * through `giteaProjectImport.gen.ts`. A copy that drifts is a sign-up that
 * fails at the import, so `giteaRecipe.test.ts` asserts both that the copy
 * equals `../gitea-mate/import/gitea-project.yaml` — when that checkout is
 * beside this one — and that the generated module still carries the copy.
 *
 * Refreshing it is two commands from the repository root:
 *
 * ```sh
 * cp ../gitea-mate/import/gitea-project.yaml packages/client-runtime/src/zerops/giteaProjectImport.yaml
 * node -e 'const f=require("node:fs"),b="packages/client-runtime/src/zerops/giteaProjectImport";f.writeFileSync(b+".gen.ts","// Generated from giteaProjectImport.yaml. Do not edit; see giteaRecipe.ts.\nexport const GITEA_PROJECT_IMPORT_YAML = "+JSON.stringify(f.readFileSync(b+".yaml","utf8"))+";\n")' \
 *   && vp fmt packages/client-runtime/src/zerops/giteaProjectImport.gen.ts
 * ```
 *
 * The generated module exists because nothing else imports a raw text asset in
 * every shell this package runs in: `?raw` is Vite's, and Metro — which bundles
 * this module for the phone — resolves no query string at all.
 *
 * ## What the app fills in, and what it must not
 *
 * Whatever `__PLACEHOLDER__` the document declares, and nothing else:
 * `GITEA_IMPORT_PLACEHOLDERS` is read out of the document rather than listed
 * here, so a placeholder added upstream cannot be filled with silence.
 *
 * - `__REGION__` — the project's real region. The published recipe hardcoded
 *   `app-prg1.zerops.app`, a host that does not resolve; Gitea derives
 *   `ROOT_URL` and `SSH_DOMAIN` from it, so left alone every clone URL and web
 *   link it emits points nowhere (measured 2026-09-05).
 * - `__ZEROPS_TOKEN__` — the broker's Zerops token, minted moments earlier.
 * - `__ZEROPS_CLIENT_ID__`, `__ZEROPS_PROJECT_ID__` — the org, and the project
 *   the registry lives on.
 * - `__MATE_APP_URL__` — where the consent page of Gitea's own sign-in lives:
 *   the origin this shell is served from. A redirect target, not an allowlist.
 *
 * There is no origin list. Gitea's `[cors]` and the broker's
 * `POST /person/token` answer every origin (D22): each browser call carries
 * the person's token in a header and no cookie, so the origin proves nothing,
 * and a Gitea made from mate.zerops.io is driven from a developer's localhost
 * and back.
 *
 * The placeholders name Zerops; the variables they land in do not. A custom
 * variable whose name begins with `ZEROPS_` is refused by the import itself
 * (`400 userDataZeropsPrefixForbidden`, case-insensitive; measured
 * 2026-09-16), so the broker reads `MATE_ZEROPS_*`.
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

import { GITEA_PROJECT_IMPORT_YAML } from "./giteaProjectImport.gen.ts";

/** Replaced with the project's region before import. */
const REGION_PLACEHOLDER = "__REGION__";
/** Replaced with the broker's Zerops token. Never stored anywhere else. */
const BROKER_TOKEN_PLACEHOLDER = "__ZEROPS_TOKEN__";
const CLIENT_ID_PLACEHOLDER = "__ZEROPS_CLIENT_ID__";
const PROJECT_ID_PLACEHOLDER = "__ZEROPS_PROJECT_ID__";
const APP_URL_PLACEHOLDER = "__MATE_APP_URL__";

/**
 * Every placeholder the document carries, read out of the document — so a
 * placeholder the upstream file adds shows up here, and a test can prove both
 * that each one is filled and that none is left.
 */
export const GITEA_IMPORT_PLACEHOLDERS: ReadonlyArray<string> = [
  ...new Set(GITEA_PROJECT_IMPORT_YAML.match(/__[A-Z_]+__/gu) ?? []),
].sort();

/** Where both services build from, and what `zeropsSetup` picks out of it. */
export const GITEA_MATE_REPOSITORY = "https://github.com/zeropsio/gitea-mate";

export interface GiteaImportInput {
  /** `zeropsRegionFromPublicZone` off the freshly created project. */
  readonly region: string;
  /**
   * Where the consent page of Gitea's own sign-in lives: the origin this
   * shell is served from.
   */
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
  const values = new Map<string, string>([
    [REGION_PLACEHOLDER, input.region],
    [BROKER_TOKEN_PLACEHOLDER, input.brokerToken],
    [CLIENT_ID_PLACEHOLDER, input.clientId],
    [PROJECT_ID_PLACEHOLDER, input.projectId],
    [APP_URL_PLACEHOLDER, input.appUrl.replace(/\/+$/u, "")],
  ]);
  let document = GITEA_PROJECT_IMPORT_YAML;
  for (const placeholder of GITEA_IMPORT_PLACEHOLDERS) {
    const value = values.get(placeholder);
    if (value === undefined) {
      // The copied document grew a blank this build knows nothing about.
      // Sending it as-is would import the literal `__…__` as a value.
      throw new Error(`The Gitea import declares ${placeholder}, which nothing here fills.`);
    }
    document = document.split(placeholder).join(value);
  }
  return document;
}
