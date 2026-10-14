import { describe, expect, it } from "@effect/vitest";
import { ZeropsApiClient } from "./api.ts";

const stored =
  "build:\n  base: ubuntu@22.04\n  deployFiles: ./\nrun:\n  base: zcp@1\n  initCommands:\n    - install-pinned-zcp\n  ports:\n    - port: 8080\n      httpSupport: true\n  startCommands:\n    - command: zcp service start nginx\n      name: nginx\n";
const expected =
  "zerops:\n  - setup: zcp\n    run:\n      base: zcp@1\n      initCommands:\n        - install-pinned-zcp\n      ports:\n        - port: 8080\n          httpSupport: true\n      startCommands:\n        - command: zcp service start nginx\n          name: nginx";

function rig(
  options: {
    active?: boolean;
    status?: string;
    saved?: string | null;
    process?: boolean;
    unknownDeployment?: boolean;
    oldMate?: boolean;
  } = {},
) {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const client = new ZeropsApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      requests.push({
        path,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      const value = path.endsWith("/env")
        ? {
            items: [
              { key: "ZEROPS_YAML", content: options.saved === undefined ? stored : options.saved },
              { key: "VSCODE_PASSWORD", content: "existing-password" },
              ...(options.oldMate
                ? []
                : [
                    { key: "ZCP_API_KEY", content: "existing-key" },
                    { key: "ZCP_MATE_ENABLED", content: "1" },
                  ]),
            ],
          }
        : path.endsWith("/trigger-pipeline")
          ? options.process === false
            ? {}
            : { process: { id: "deployment" } }
          : {
              id: "s1",
              name: "zcp",
              serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
              status: options.status ?? "READY_TO_DEPLOY",
              activeAppVersion: options.unknownDeployment
                ? undefined
                : options.active
                  ? { id: "already-deployed" }
                  : null,
            };
      return new Response(JSON.stringify(value), { status: 200 });
    },
  });
  return { client, requests };
}

describe("deploying a Mate with no deployment", () => {
  it("deploys its saved run configuration through the platform pipeline without restarting", async () => {
    const { client, requests } = rig();
    expect(await client.deployMate("s1")).toEqual({ processId: "deployment" });
    expect(requests.filter((request) => request.method === "PUT")).toEqual([
      {
        path: "/api/rest/public/service-stack/s1/trigger-pipeline",
        method: "PUT",
        body: { zeropsYaml: expected, enableSubdomainAccess: true },
      },
    ]);
  });
  it.each([
    { active: true },
    { unknownDeployment: true },
    { status: "ACTIVE" },
    { saved: null },
    { saved: "build:\n  base: ubuntu@22.04" },
  ])("never replaces a deployment or invents missing deployment settings: %j", async (options) => {
    const { client, requests } = rig(options);
    await expect(client.deployMate("s1")).rejects.toThrow();
    expect(requests.filter((request) => request.method === "PUT")).toEqual([]);
  });
  it("retains an older Mate's existing secrets without requiring a new integration key", async () => {
    const { client } = rig({ oldMate: true });
    expect(await client.deployMate("s1")).toEqual({ processId: "deployment" });
  });
  it("rechecks write access after reading the saved configuration", async () => {
    const { client, requests } = rig();
    await expect(
      client.deployMate("s1", undefined, async () => {
        throw new Error("Access ended");
      }),
    ).rejects.toThrow("Access ended");
    expect(requests.filter((request) => request.method === "PUT")).toEqual([]);
  });
  it("keeps a missing deployment receipt uncertain rather than claiming success", async () => {
    const { client } = rig({ process: false });
    await expect(client.deployMate("s1")).rejects.toMatchObject({ kind: "uncertain" });
  });
});
