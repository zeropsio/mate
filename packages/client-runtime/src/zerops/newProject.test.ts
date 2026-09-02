import { describe, expect, it, vi } from "@effect/vitest";

import { DEFAULT_ZEROPS_API_BASE, ZeropsApiClient } from "./api.ts";
import {
  buildCreateProjectBody,
  buildDevelopmentContainerImportBody,
  buildZcpServiceImportYaml,
  generateVscodePassword,
  nextZcpServiceName,
} from "./newProject.ts";

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

describe("buildZcpServiceImportYaml", () => {
  it("emits the platform's own import document, byte for byte, plus the mate flag", () => {
    expect(
      buildZcpServiceImportYaml({ serviceName: "zcp", vscodePassword: "PASSWORD0PASSWORD" }),
    ).toBe(GOLDEN);
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
  it("names the recipe source and asks for the integration token", () => {
    expect(buildDevelopmentContainerImportBody({ serviceImportYaml: "services: []" })).toEqual({
      serviceImportYaml: "services: []",
      recipeSource: "zeropsio/zcp",
      createIntegrationToken: true,
    });
  });
});

describe("ZeropsApiClient.createProjectWithZeropsMate", () => {
  function recordingClient() {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    const client = new ZeropsApiClient({
      fetch: (input, init) => {
        requests.push({
          url: input,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        const payload = input.includes("/first-class-recipe/")
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

  it("creates the project, then imports the container recipe into it", async () => {
    const { client, requests } = recordingClient();

    const result = await client.createProjectWithZeropsMate({ clientId: "org-1", name: "new" });

    expect(result.project.id).toBe("project-9");
    expect(result.serviceName).toBe("zcp");

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/client/org-1/project`,
    );
    expect(requests[1]?.method).toBe("PUT");
    expect(requests[1]?.url).toBe(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/project/project-9/first-class-recipe/development-container`,
    );

    const importBody = JSON.parse(requests[1]?.body ?? "{}");
    expect(importBody.recipeSource).toBe("zeropsio/zcp");
    expect(importBody.createIntegrationToken).toBe(true);
    expect(importBody.serviceImportYaml).toMatch(/VSCODE_PASSWORD: "[A-Za-z0-9]{16}"/);
  });

  it("generates the container password, sends it, and forgets it", async () => {
    const { client, requests } = recordingClient();
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    try {
      const result = await client.createProjectWithZeropsMate({ clientId: "org-1", name: "new" });

      const password = /VSCODE_PASSWORD: "([A-Za-z0-9]{16})"/.exec(
        JSON.parse(requests[1]?.body ?? "{}").serviceImportYaml as string,
      )?.[1];
      expect(password).toBeTruthy();

      // It exists only inside the one request that carries it.
      expect(JSON.stringify(result)).not.toContain(password);
      expect(logged.join("\n")).not.toContain(password);
      expect(requests[0]?.body ?? "").not.toContain(password);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("names the container around the ones a project already has", async () => {
    const { client, requests } = recordingClient();

    await client.createProjectWithZeropsMate({
      clientId: "org-1",
      name: "new",
      existingServiceNames: ["zcp", "zcp1"],
    });

    expect(JSON.parse(requests[1]?.body ?? "{}").serviceImportYaml).toContain("- hostname: zcp2");
  });
});
