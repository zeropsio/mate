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
 * A selected coding agent gets a `ZCP_AGENT_AUTH_TYPE_<SUFFIX>: "oauth"`
 * secret, mirroring the GUI's `#buildEnvSecrets` (only the oauth half — a
 * token is a user secret, out of scope here). Those keys are GUI parity —
 * the GUI writes them too, so a container this client creates carries the
 * same metadata one created by the GUI would. They cost nothing to keep but
 * the container's bootstrap does not read them.
 *
 * `ZCP_AGENTS` is the key the container actually reads (the bootstrap
 * extension's `resolveAvailableAgentIds`, `internal/content/templates/
 * vscode-bootstrap-extension.js` in zcp): a comma-separated list that decides
 * which agents it offers. Like `ZCP_MATE_ENABLED`, the GUI never writes it —
 * this client adds it because without it the container does not behave the
 * way the product needs. Its absence means "offer all five", so an empty
 * selection must omit the key entirely rather than emit `ZCP_AGENTS: ""`,
 * which the reader fails closed to zero agents.
 *
 * Both are emitted in `ZEROPS_AGENT_TYPE_CANONICAL_ORDER`, not the caller's
 * order — for `ZCP_AGENT_AUTH_TYPE_*` so the document is stable across
 * renders regardless of how the picker collected the selection (the GUI
 * itself emits those in selection order; ours deliberately does not), and
 * for `ZCP_AGENTS` because the reader treats it as presentation order, so
 * the order emitted here is the order the container's UI offers agents in.
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

/**
 * The coding agents the platform's zcp recipe knows how to configure —
 * `SUPPORTED_AGENT_TYPES` from the GUI's `zerops-services.model.ts`, the
 * narrower of its two agent-type lists (it excludes `opencode-ai`, which the
 * GUI's own picker does not surface either).
 */
export type ZeropsAgentType = "claude-code" | "codex" | "antigravity" | "grok" | "cursor";

/**
 * Fixed render order for `ZCP_AGENTS` and `ZCP_AGENT_AUTH_TYPE_*`, independent
 * of caller order — the GUI emits its own agent keys in selection order, but
 * ours deliberately doesn't: a stable document, and for `ZCP_AGENTS` the
 * order the container's bootstrap presents agents in.
 */
export const ZEROPS_AGENT_TYPE_CANONICAL_ORDER: ReadonlyArray<ZeropsAgentType> = [
  "claude-code",
  "codex",
  "antigravity",
  "grok",
  "cursor",
];

/** Mirrors the GUI's `agentTypeToEnvSuffix`: uppercase, hyphens to underscores. */
export function agentTypeToEnvSuffix(agentType: ZeropsAgentType): string {
  return agentType.toUpperCase().replace(/-/g, "_");
}

/**
 * The tier's runtimes as `MATE_SETUP_RUNTIMES` carries them: base64 of the import document's
 * UTF-8 bytes, so no quote, colon or newline in it can break the line it rides on. zcp imports
 * what it lists on its first boot, with its own key, once the project is closed off.
 */
/** What `MATE_SETUP_RUNTIMES` carries for a tier with no runtimes: nothing to import. */
export const NO_SETUP_RUNTIMES = "services: []";

export function encodeSetupRuntimes(yaml: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(yaml)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildZcpServiceImportYaml(input: {
  readonly serviceName: string;
  readonly vscodePassword: string;
  /** Pins `install.sh` to one release; unset installs the latest, as the pool does. */
  readonly zcpVersion?: string;
  /** Coding agents to pre-configure for oauth sign-in. Order does not matter. */
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
  /**
   * The Mate's own key (`ZCP_API_KEY`), minted by the person for this container: a secret of
   * the container's, never a project variable another service could be handed.
   */
  readonly apiKey?: string;
  /**
   * The tier's runtimes for zcp to import on boot. Set whenever the key is: the Mate server starts
   * its own stand-up only on a container that carries it, so a tier with none sends
   * `services: []`, and a container made before the press — which carries neither — never does.
   */
  readonly setupRuntimesYaml?: string;
}): string {
  if (!input.vscodePassword) {
    throw new Error("A zcp container with a public subdomain needs a VSCODE_PASSWORD.");
  }
  const versionArg = input.zcpVersion ? ` -s ${input.zcpVersion}` : "";
  const selected = new Set(input.agents ?? []);
  const orderedAgents = ZEROPS_AGENT_TYPE_CANONICAL_ORDER.filter((agentType) =>
    selected.has(agentType),
  );
  // Absent when the selection is empty: an emitted `ZCP_AGENTS: ""` would
  // fail the container closed to zero agents instead of the intended
  // "offer all five".
  const agentsLine =
    orderedAgents.length > 0 ? `      ZCP_AGENTS: "${orderedAgents.join(",")}"\n` : "";
  const agentAuthSecrets = orderedAgents
    .map((agentType) => `      ZCP_AGENT_AUTH_TYPE_${agentTypeToEnvSuffix(agentType)}: "oauth"\n`)
    .join("");
  const keyLine = input.apiKey ? `      ZCP_API_KEY: "${input.apiKey}"\n` : "";
  const runtimesLine = input.apiKey
    ? `      MATE_SETUP_RUNTIMES: "${encodeSetupRuntimes(input.setupRuntimesYaml || NO_SETUP_RUNTIMES)}"\n`
    : "";
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
${agentsLine}${agentAuthSecrets}      ZCP_MATE_ENABLED: "1"
${keyLine}${runtimesLine}    zeropsYaml:
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
  /** Tags the project is born with — group membership and role (`groups.ts`). */
  readonly tagList?: ReadonlyArray<string>;
}): CreateProjectBody {
  return {
    name: input.name.trim(),
    description: "",
    tagList: input.tagList ?? [],
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
    // The container's key comes inside the document (`ZCP_API_KEY`), minted by the person with
    // exactly the Mate's reach. The platform's own would be `ADMIN` on the project, a project
    // variable every service can read, and a one-time delegation: three things to take back
    // afterwards, from a browser that may have gone by then.
    createIntegrationToken: false,
  };
}
