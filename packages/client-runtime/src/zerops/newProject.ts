/**
 * "New project" — and the same path the pool-exhausted case takes: create a
 * Zerops project, then import the platform's own development-container recipe
 * into it.
 *
 * The import document is emitted verbatim rather than through a YAML library:
 * it must match what the platform GUI produces for the same configuration,
 * traced from its `ZeropsYamlBuilder` on 2026-08-28, and a serializer's
 * quoting choices would drift from that — plus `ZCP_MATE_ENABLED`, the one key
 * this client adds to the GUI's document. zcp keys every mate-shaped effect off
 * that flag: without it `zcp init` installs no bundle, registers no unit and
 * publishes no `/mate/` location, so a container created here would come up
 * unable to serve the very product that created it. The GUI has no reason to
 * set it and the platform recipe does not carry it yet, which leaves this the
 * only place on the "New project" path that can.
 *
 * `VSCODE_PASSWORD` is mandatory here. A `zcp@1` with a public subdomain and no
 * password answers code-server to anyone who finds the URL. The password is
 * generated, sent once inside the import, and forgotten — nothing in this
 * module hands it back, and a user who wants it reads it in the Zerops GUI.
 */

const ZCP_SERVICE_NAME_PREFIX = "zcp";

export const VSCODE_PASSWORD_LENGTH = 16;

const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Largest multiple of the alphabet size that fits in a byte; above it, resample. */
const PASSWORD_REJECTION_LIMIT =
  Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;

export type RandomBytes = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

// Bound to `crypto` for the same reason `fetch` is bound to `globalThis`: the
// browser brand-checks the receiver and an unbound reference throws.
const defaultRandomBytes: RandomBytes = (array) => globalThis.crypto.getRandomValues(array);

/**
 * Sixteen alphanumeric characters from the platform's own alphabet, drawn
 * without modulo bias (the GUI's version takes `byte % 62` and skews toward the
 * first four characters).
 */
export function generateVscodePassword(randomBytes: RandomBytes = defaultRandomBytes): string {
  let password = "";
  while (password.length < VSCODE_PASSWORD_LENGTH) {
    const draw = randomBytes(new Uint8Array(VSCODE_PASSWORD_LENGTH));
    for (const byte of draw) {
      if (password.length === VSCODE_PASSWORD_LENGTH) break;
      if (byte >= PASSWORD_REJECTION_LIMIT) continue;
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return password;
}

/**
 * The platform's numbering: the bare name first, then `zcp1`, `zcp2`, … one
 * past the highest that already exists.
 */
export function nextZcpServiceName(existingNames: ReadonlyArray<string>): string {
  const pattern = new RegExp(`^${ZCP_SERVICE_NAME_PREFIX}(\\d+)?$`);
  const taken = existingNames
    .map((name) => {
      const match = pattern.exec(name);
      if (!match) return -1;
      return match[1] ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((index) => index >= 0);

  if (taken.length === 0) return ZCP_SERVICE_NAME_PREFIX;
  return `${ZCP_SERVICE_NAME_PREFIX}${Math.max(...taken) + 1}`;
}

export function buildZcpServiceImportYaml(input: {
  readonly serviceName: string;
  readonly vscodePassword: string;
  /** Pins `install.sh` to one release; unset installs the latest, as the pool does. */
  readonly zcpVersion?: string;
}): string {
  if (!input.vscodePassword) {
    throw new Error("A zcp container with a public subdomain needs a VSCODE_PASSWORD.");
  }
  const versionArg = input.zcpVersion ? ` -s ${input.zcpVersion}` : "";
  return `services:
  - hostname: ${input.serviceName}
    type: zcp@1
    maxContainers: 1
    enableSubdomainAccess: true
    verticalAutoscaling:
      minRam: 2
    envSecrets:
      VSCODE_PASSWORD: "${input.vscodePassword}"
      ZCP_VSCODE_AUTH_ENABLED: "true"
      ZCP_VSCODE: "true"
      ZCP_MATE_ENABLED: "1"
    zeropsYaml:
      zerops:
        - setup: ${input.serviceName}
          run:
            base: zcp@1
            initCommands:
              - curl -sSfL https://zerops.io/zcp/install.sh | sudo sh${versionArg}
              - zcp init
              - sudo -E zcp init nginx
            ports:
              - port: 8080
                httpSupport: true
            startCommands:
              - command: zcp service start nginx
                name: nginx
              - command: zcp service start vscode
                name: vscode`;
}

export interface CreateProjectBody {
  readonly name: string;
  readonly description: string;
  readonly tagList: ReadonlyArray<string>;
  /** Null lets the platform pick; the client has no way to measure the fastest region. */
  readonly location: string | null;
  readonly clientId: string;
  readonly mode: "LIGHT" | "SERIOUS";
  readonly maxCreditLimit: number | null;
  readonly userRoles: ReadonlyArray<unknown>;
}

export function buildCreateProjectBody(input: {
  readonly clientId: string;
  readonly name: string;
  readonly location?: string;
  readonly mode?: "LIGHT" | "SERIOUS";
}): CreateProjectBody {
  return {
    name: input.name.trim(),
    description: "",
    tagList: [],
    location: input.location ?? null,
    clientId: input.clientId,
    mode: input.mode ?? "LIGHT",
    maxCreditLimit: null,
    userRoles: [],
  };
}

export interface DevelopmentContainerImportBody {
  readonly serviceImportYaml: string;
  readonly recipeSource: string;
  readonly createIntegrationToken: boolean;
}

export function buildDevelopmentContainerImportBody(input: {
  readonly serviceImportYaml: string;
}): DevelopmentContainerImportBody {
  return {
    serviceImportYaml: input.serviceImportYaml,
    recipeSource: "zeropsio/zcp",
    // The project needs its own token so the container can operate itself.
    createIntegrationToken: true,
  };
}
