import type { TokenWriteHold } from "./groupReach.ts";
import { describe, expect, it, vi } from "@effect/vitest";

import { DEFAULT_ZEROPS_API_BASE, ZeropsApiClient } from "./api.ts";
import {
  buildCreateProjectBody,
  buildDevelopmentContainerImportBody,
  buildZcpServiceImportYaml,
  encodeSetupRuntimes,
  generateVscodePassword,
  nextZcpServiceName,
} from "./newProject.ts";

/** The test's own decoder: base64 back to the UTF-8 document. */
function decodeSetupRuntimes(encoded: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
}

/**
 * Traced from the platform GUI's own `ZeropsYamlBuilder` on 2026-08-28 for the
 * config the pool claim uses: one zcp, VS Code on, public access on, no agents,
 * no sshfs hostnames. Byte-for-byte, including the absent trailing newline —
 * plus `ZCP_MATE_ENABLED`, the one key this client adds to that document so the
 * container it creates comes up serving Zerops Mate.
 */
const GOLDEN = `services:
  - hostname: zcp
    type: zcp@1
    maxContainers: 1
    enableSubdomainAccess: true
    verticalAutoscaling:
      minRam: 2
    envSecrets:
      VSCODE_PASSWORD: "PASSWORD0PASSWORD"
      ZCP_VSCODE_AUTH_ENABLED: "true"
      ZCP_VSCODE: "true"
      ZCP_MATE_ENABLED: "1"
    zeropsYaml:
      zerops:
        - setup: zcp
          run:
            base: zcp@1
            initCommands:
              - curl -sSfL https://zerops.io/zcp/install.sh | sudo sh
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

/**
 * Traced the same way as GOLDEN, for two agents (`codex`, `claude-code`)
 * selected out of canonical order — the emitted keys must still land in
 * canonical order: `ZCP_AGENTS` right after `ZCP_VSCODE` (it is the key the
 * container reads, so it leads), then the GUI-parity `ZCP_AGENT_AUTH_TYPE_*`
 * lines, then `ZCP_MATE_ENABLED` last.
 */
const GOLDEN_TWO_AGENTS = `services:
  - hostname: zcp
    type: zcp@1
    maxContainers: 1
    enableSubdomainAccess: true
    verticalAutoscaling:
      minRam: 2
    envSecrets:
      VSCODE_PASSWORD: "PASSWORD0PASSWORD"
      ZCP_VSCODE_AUTH_ENABLED: "true"
      ZCP_VSCODE: "true"
      ZCP_AGENTS: "claude-code,codex"
      ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE: "oauth"
      ZCP_AGENT_AUTH_TYPE_CODEX: "oauth"
      ZCP_MATE_ENABLED: "1"
    zeropsYaml:
      zerops:
        - setup: zcp
          run:
            base: zcp@1
            initCommands:
              - curl -sSfL https://zerops.io/zcp/install.sh | sudo sh
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

describe("buildZcpServiceImportYaml", () => {
  it("emits the platform's own import document, byte for byte, plus the mate flag", () => {
    expect(
      buildZcpServiceImportYaml({ serviceName: "zcp", vscodePassword: "PASSWORD0PASSWORD" }),
    ).toBe(GOLDEN);
  });

  it("emits an empty agent list as exactly the no-agent document", () => {
    expect(
      buildZcpServiceImportYaml({
        serviceName: "zcp",
        vscodePassword: "PASSWORD0PASSWORD",
        agents: [],
      }),
    ).toBe(GOLDEN);
  });

  it('never emits ZCP_AGENTS at all when the list is absent or empty, because an emitted empty string would fail the container closed to zero agents instead of the intended "offer all five"', () => {
    const withoutAgentsField = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "PASSWORD0PASSWORD",
    });
    const withEmptyAgentsList = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "PASSWORD0PASSWORD",
      agents: [],
    });

    expect(withoutAgentsField).not.toContain("ZCP_AGENTS");
    expect(withEmptyAgentsList).not.toContain("ZCP_AGENTS");
  });

  it("emits ZCP_AGENTS as a comma-separated list in canonical order, the presentation order the container preserves", () => {
    const yaml = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "PASSWORD0PASSWORD",
      // Passed out of canonical order.
      agents: ["cursor", "claude-code"],
    });

    expect(yaml).toContain('ZCP_AGENTS: "claude-code,cursor"');
  });

  it("emits one ZCP_AGENT_AUTH_TYPE_<SUFFIX> oauth secret per selected agent, in canonical order", () => {
    expect(
      buildZcpServiceImportYaml({
        serviceName: "zcp",
        vscodePassword: "PASSWORD0PASSWORD",
        // Passed out of canonical order — the output must not follow it.
        agents: ["codex", "claude-code"],
      }),
    ).toBe(GOLDEN_TWO_AGENTS);
  });

  it("uppercases a hyphenated agent type and replaces hyphens with underscores for the suffix", () => {
    const yaml = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "PASSWORD0PASSWORD",
      agents: ["claude-code"],
    });

    expect(yaml).toContain('ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE: "oauth"');
  });

  it("never emits a container with a public subdomain and no password", () => {
    const yaml = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "s3cret0s3cret0s3",
    });

    expect(yaml).toContain("enableSubdomainAccess: true");
    expect(yaml).toMatch(/VSCODE_PASSWORD: "[^"]+"/);
    expect(yaml).toContain('ZCP_VSCODE_AUTH_ENABLED: "true"');
    // Without this the container installs no mate at all, so a "New project"
    // would hand the user a container that cannot serve Zerops Mate.
    expect(yaml).toContain('ZCP_MATE_ENABLED: "1"');
    expect(() =>
      buildZcpServiceImportYaml({ serviceName: "zcp", vscodePassword: "" }),
    ).toThrowError(/password/i);
  });

  it("pins the zcp version only when one is given", () => {
    expect(
      buildZcpServiceImportYaml({
        serviceName: "zcp",
        vscodePassword: "s3cret0s3cret0s3",
        zcpVersion: "v1.2.3",
      }),
    ).toContain("curl -sSfL https://zerops.io/zcp/install.sh | sudo sh -s v1.2.3");
  });

  it("carries the chosen hostname into both the service and its setup", () => {
    const yaml = buildZcpServiceImportYaml({
      serviceName: "zcp1",
      vscodePassword: "s3cret0s3cret0s3",
    });

    expect(yaml).toContain("- hostname: zcp1");
    expect(yaml).toContain("- setup: zcp1");
  });
});

describe("nextZcpServiceName", () => {
  it("matches the platform's own numbering", () => {
    expect(nextZcpServiceName([])).toBe("zcp");
    expect(nextZcpServiceName(["api", "db"])).toBe("zcp");
    expect(nextZcpServiceName(["zcp"])).toBe("zcp1");
    expect(nextZcpServiceName(["zcp", "zcp1"])).toBe("zcp2");
    expect(nextZcpServiceName(["zcp3"])).toBe("zcp4");
  });
});

describe("generateVscodePassword", () => {
  it("is sixteen alphanumeric characters", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(generateVscodePassword()).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });

  it("draws from the injected randomness without modulo bias", () => {
    // 248 and 249 both map to index 0 under a naive `% 62`; the rejection
    // sampler must skip 248..255 instead of favouring the first characters.
    const bytes = [248, 249, 250, 251, 252, 253, 254, 255, ...Array.from({ length: 16 }, () => 61)];
    let cursor = 0;
    const password = generateVscodePassword((array) => {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = bytes[cursor] ?? 61;
        cursor += 1;
      }
      return array;
    });

    expect(password).toBe("9".repeat(16));
  });
});

describe("buildCreateProjectBody", () => {
  it("creates a LIGHT project and lets the platform pick the location", () => {
    expect(buildCreateProjectBody({ clientId: "org-1", name: " my project " })).toEqual({
      name: "my project",
      description: "",
      tagList: [],
      location: null,
      clientId: "org-1",
      mode: "LIGHT",
      maxCreditLimit: null,
      userRoles: [],
    });
  });

  it("passes a location through when the caller has one", () => {
    expect(
      buildCreateProjectBody({ clientId: "org-1", name: "p", location: "prg1" }).location,
    ).toBe("prg1");
  });
});

describe("buildDevelopmentContainerImportBody", () => {
  it("names the recipe source and asks the platform for no token: the Mate's key comes with it", () => {
    expect(buildDevelopmentContainerImportBody({ serviceImportYaml: "services: []" })).toEqual({
      serviceImportYaml: "services: []",
      recipeSource: "zeropsio/zcp",
      createIntegrationToken: false,
    });
  });
});

describe("the Mate's key and its runtimes in the container's document", () => {
  const KEY = ["key", "for", "test"].join("-");
  const RUNTIMES = "services:\n  - hostname: appdev\n    type: nodejs@22\n";

  it.each([
    { case: "neither", input: {}, key: undefined, runtimes: undefined },
    // The marker the Mate server starts its own stand-up on: a press always sets it, to nothing
    // to import where the tier has no runtimes.
    { case: "the key alone", input: { apiKey: KEY }, key: KEY, runtimes: "services: []" },
    {
      case: "the key and the runtimes",
      input: { apiKey: KEY, setupRuntimesYaml: RUNTIMES },
      key: KEY,
      runtimes: RUNTIMES,
    },
    {
      case: "an empty runtimes plan, which is nothing to import",
      input: { apiKey: KEY, setupRuntimesYaml: "" },
      key: KEY,
      runtimes: "services: []",
    },
  ])("carries $case", ({ input, key, runtimes }) => {
    const yaml = buildZcpServiceImportYaml({
      serviceName: "zcp",
      vscodePassword: "PASSWORD0PASSWORD",
      ...input,
    });
    const keyLine = /^ {6}ZCP_API_KEY: "([^"]*)"$/m.exec(yaml)?.[1];
    const runtimesLine = /^ {6}MATE_SETUP_RUNTIMES: "([^"]*)"$/m.exec(yaml)?.[1];
    expect(keyLine).toBe(key);
    expect(runtimesLine === undefined ? undefined : decodeSetupRuntimes(runtimesLine)).toBe(
      runtimes,
    );
    // Secrets, both: never a plain variable another service could be handed.
    const secrets = yaml.slice(yaml.indexOf("envSecrets:"), yaml.indexOf("zeropsYaml:"));
    if (key !== undefined) expect(secrets).toContain("ZCP_API_KEY");
    if (runtimes !== undefined) expect(secrets).toContain("MATE_SETUP_RUNTIMES");
  });

  it("encodes the runtimes as base64 of their UTF-8 bytes, so any document survives the quotes", () => {
    const document = 'services:\n  - hostname: "café"\n';
    const encoded = encodeSetupRuntimes(document);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodeSetupRuntimes(encoded)).toBe(document);
  });
});

/** The Mate's key as the platform hands it back, built from parts so no scanner takes it for one. */
const MINTED_KEY = ["minted", "key", "value"].join("_");
const REGENERATED_KEY = ["regenerated", "key", "value"].join("_");

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

/**
 * A platform that answers each route as a fresh account would: a new project with no services
 * and no tokens, unless the case says otherwise.
 */
function platformClient(state: {
  readonly services?: ReadonlyArray<Record<string, unknown>>;
  readonly tokens?: ReadonlyArray<Record<string, unknown>>;
  readonly processes?: ReadonlyArray<Record<string, unknown>>;
  readonly holdToken?: TokenWriteHold;
}) {
  const requests: Array<Recorded> = [];
  const client = new ZeropsApiClient({
    ...(state.holdToken === undefined ? {} : { holdToken: state.holdToken }),
    fetch: (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({
        url: input.replace(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public`, ""),
        method,
        body: typeof init?.body === "string" ? init.body : null,
      });
      const payload = input.includes("/first-class-recipe/")
        ? {}
        : input.endsWith("/process/search")
          ? { items: state.processes ?? [] }
          : input.includes("/service-stack")
            ? { list: state.services ?? [] }
            : input.includes("/integration-token/list")
              ? { list: state.tokens ?? [] }
              : input.endsWith("/regenerate")
                ? { token: REGENERATED_KEY }
                : input.endsWith("/integration-token") && method === "POST"
                  ? { id: "token-new", token: MINTED_KEY }
                  : input.includes("/integration-token/")
                    ? {}
                    : { id: "project-9", name: "new", status: "CREATING", clientId: "org-1" };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  client.restoreSession({ accessToken: "access-1" });
  return { client, requests };
}

const importOf = (requests: ReadonlyArray<Recorded>) => {
  const sent = requests.find((request) => request.url.includes("/first-class-recipe/"));
  return sent === undefined ? undefined : JSON.parse(sent.body ?? "{}");
};
const writesOf = (requests: ReadonlyArray<Recorded>) =>
  requests
    .filter((request) => request.method !== "GET" && !request.url.endsWith("/search"))
    .map((request) => `${request.method} ${request.url}`);

describe("ZeropsApiClient.importDevelopmentContainer: the Mate's key comes with its container", () => {
  const INPUT = {
    clientId: "org-1",
    projectId: "project-9",
    projectName: "Acme Docs - Ada",
    setupRuntimesYaml: "services:\n  - hostname: appdev\n",
  };

  // ADR 0003: a Mate's key holds its own project; it reads nothing of its application's others.
  it("mints the key with its own project and nothing more, then imports the container holding it", async () => {
    const { client, requests } = platformClient({});

    const result = await client.importDevelopmentContainer(INPUT);

    expect(result).toEqual({ serviceName: "zcp", imported: true });
    expect(writesOf(requests)).toEqual([
      "POST /client/org-1/integration-token",
      "PUT /project/project-9/first-class-recipe/development-container",
    ]);
    const mint = JSON.parse(requests.find((request) => request.method === "POST")?.body ?? "{}");
    expect(mint).toEqual({
      name: "zcp-Acme Docs - Ada",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId: "project-9", roleCode: "BASIC_USER" }],
    });
    const body = importOf(requests);
    expect(body.createIntegrationToken).toBe(false);
    expect(body.serviceImportYaml).toContain(`ZCP_API_KEY: "${MINTED_KEY}"`);
    expect(body.serviceImportYaml).toContain("MATE_SETUP_RUNTIMES: ");
  });

  it("hands the key to nobody but the container", async () => {
    const { client, requests } = platformClient({});
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );
    try {
      const result = await client.importDevelopmentContainer(INPUT);
      expect(JSON.stringify(result)).not.toContain(MINTED_KEY);
      expect(logged.join("\n")).not.toContain(MINTED_KEY);
      const carrying = requests.filter((request) => request.body?.includes(MINTED_KEY));
      expect(carrying.map((request) => request.url)).toEqual([
        "/project/project-9/first-class-recipe/development-container",
      ]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("writes nothing for a project that already has its container: a press tried again is safe", async () => {
    const { client, requests } = platformClient({
      services: [
        {
          id: "svc-1",
          name: "zcp",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
        },
      ],
    });

    expect(await client.importDevelopmentContainer(INPUT)).toEqual({
      serviceName: "zcp",
      imported: false,
    });
    expect(writesOf(requests)).toEqual([]);
  });

  // One Mate per project (audit D2): a project holding several zcp services is no one Mate's, and
  // none of them is picked as its container.
  it("refuses a project holding several zcp services, naming them, and writes nothing", async () => {
    const zcp = (id: string, name: string) => ({
      id,
      name,
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    });
    const { client, requests } = platformClient({
      services: [zcp("svc-1", "zcp"), zcp("svc-2", "zcp1")],
    });

    await expect(client.importDevelopmentContainer(INPUT)).rejects.toThrow(
      "This project has more than one Zerops Control Plane (zcp, zcp1). A project holds one Mate: delete the others in Zerops, then try again.",
    );
    expect(writesOf(requests)).toEqual([]);
  });

  it("reuses a key a stopped press minted: its value replaced, never a second key", async () => {
    const { client, requests } = platformClient({
      tokens: [
        {
          id: "token-old",
          name: "zcp-Acme Docs - Ada",
          roleCode: "NO_ACCESS",
          projects: [{ projectId: "project-9", roleCode: "BASIC_USER" }],
        },
      ],
    });

    await client.importDevelopmentContainer(INPUT);

    // Its own grant is already the Mate's: nothing is written to it but its new value.
    expect(writesOf(requests)).toEqual([
      "PUT /client/org-1/integration-token/token-old/regenerate",
      "PUT /project/project-9/first-class-recipe/development-container",
    ]);
    expect(importOf(requests).serviceImportYaml).toContain(`ZCP_API_KEY: "${REGENERATED_KEY}"`);
  });

  // ADR 0003: a key the press reuses reaches its own project alone after the write.
  it("lowers a reused key still ADMIN on its project, taking off the siblings it reads", async () => {
    const { client, requests } = platformClient({
      tokens: [
        {
          id: "token-old",
          name: "zcp-Acme Docs - Ada",
          roleCode: "NO_ACCESS",
          projects: [
            { projectId: "project-9", roleCode: "ADMIN" },
            { projectId: "project-stage", roleCode: "READ_ONLY" },
          ],
        },
      ],
    });

    await client.importDevelopmentContainer(INPUT);

    const write = requests.find(
      (request) =>
        request.method === "PUT" && request.url === "/client/org-1/integration-token/token-old",
    );
    expect(JSON.parse(write?.body ?? "{}").projects).toEqual([
      { projectId: "project-9", roleCode: "BASIC_USER" },
    ]);
  });

  // A zcp the platform is still creating holds the key already: regenerating it would cut the
  // container off (pass 28 review).
  it("regenerates no key while a container is being created", async () => {
    const { client, requests } = platformClient({
      tokens: [
        {
          id: "token-old",
          name: "zcp-Acme Docs - Ada",
          roleCode: "NO_ACCESS",
          projects: [{ projectId: "project-9", roleCode: "BASIC_USER" }],
        },
      ],
      processes: [
        {
          id: "pr-1",
          actionName: "stack.create",
          status: "RUNNING",
          serviceStacks: [{ name: "zcp" }],
        },
      ],
    });

    await expect(client.importDevelopmentContainer(INPUT)).rejects.toThrow(/being created/u);
    expect(writesOf(requests)).toEqual([]);
  });

  // The write replaces the key's whole project list: it is planned from a read under the key's
  // lock, every token writer's (pass 28 review).
  it("sets a reused key's own grant from a read under its lock", async () => {
    const held: Array<string> = [];
    const { client, requests } = platformClient({
      tokens: [
        {
          id: "token-old",
          name: "zcp-Acme Docs - Ada",
          roleCode: "NO_ACCESS",
          projects: [{ projectId: "project-9", roleCode: "ADMIN" }],
        },
      ],
      holdToken: async (tokenId, run) => {
        held.push(`hold ${tokenId} after ${requests.length}`);
        try {
          return await run();
        } finally {
          held.push(`let go ${tokenId} after ${requests.length}`);
        }
      },
    });

    await client.importDevelopmentContainer(INPUT);

    const write = requests.findIndex(
      (request) =>
        request.method === "PUT" && request.url === "/client/org-1/integration-token/token-old",
    );
    const holdAt = Number(held[0]?.split(" after ")[1]);
    const goneAt = Number(held[1]?.split(" after ")[1]);
    expect(held[0]).toMatch(/^hold token-old/u);
    // A read of the token list inside the hold, then the write, before it is let go.
    expect(
      requests
        .slice(holdAt, write)
        .some((request) => request.url.includes("/integration-token/list")),
    ).toBe(true);
    expect(write).toBeGreaterThanOrEqual(holdAt);
    expect(write).toBeLessThan(goneAt);
  });

  it("reuses the newest of two keys a stopped press left, never an older one", async () => {
    const key = (id: string, created: string) => ({
      id,
      name: "zcp-Acme Docs - Ada",
      roleCode: "NO_ACCESS",
      created,
      projects: [{ projectId: "project-9", roleCode: "BASIC_USER" }],
    });
    const { client, requests } = platformClient({
      tokens: [key("token-old", "2026-10-01T09:00:00Z"), key("token-new", "2026-10-01T10:00:00Z")],
    });

    await client.importDevelopmentContainer(INPUT);

    expect(writesOf(requests)).toContain(
      "PUT /client/org-1/integration-token/token-new/regenerate",
    );
  });

  it("numbers the container around the services the project already has", async () => {
    const { client, requests } = platformClient({
      services: [
        {
          id: "svc-1",
          name: "zcpx",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "nodejs@22" },
        },
      ],
    });
    await client.importDevelopmentContainer(INPUT);
    expect(importOf(requests).serviceImportYaml).toContain("- hostname: zcp\n");
  });
});
