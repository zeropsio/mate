import { expect, it } from "vite-plus/test";

import { ZeropsApiClient } from "./api.ts";
import { buildZcpServiceImportYaml } from "./newProject.ts";

// witness: packages/client-runtime/src/zerops/newProject.ts | if (!input.vscodePassword) { → if (input.vscodePassword === undefined) {
it("ZV123: A container is never imported with a public subdomain and no password", () => {
  const yaml = buildZcpServiceImportYaml({
    serviceName: "zcp",
    vscodePassword: "s3cret0s3cret0s3",
  });
  expect(yaml).toContain("enableSubdomainAccess: true");
  expect(yaml).toContain('VSCODE_PASSWORD: "s3cret0s3cret0s3"');
  expect(() => buildZcpServiceImportYaml({ serviceName: "zcp", vscodePassword: "" })).toThrow();
});

const zcp = (id: string, name: string) => ({
  id,
  name,
  status: "ACTIVE",
  base: "zcp@1",
});

/** The platform as the press meets it: these services listed, every other read answered empty. */
function platform(services: ReadonlyArray<ReturnType<typeof zcp>>) {
  const writes: Array<string> = [];
  const client = new ZeropsApiClient({
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET" && !url.endsWith("/search")) writes.push(`${method} ${url}`);
      const body = url.includes("/service-stack?") ? { list: services } : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  client.restoreSession({ accessToken: "access-1", expiresAt: "2099-01-01T00:00:00.000Z" });
  return { client, writes };
}

const press = { clientId: "org-1", projectId: "project-9", projectName: "Acme" };

// witness: packages/client-runtime/src/zerops/api.ts | const container = mateContainerOf(services); → const container = mateContainerOf(services.slice(0, 1));
it("ZV124: A retried press on a project that holds its container writes nothing, and a project with several zcp services is refused", async () => {
  const held = platform([zcp("svc-1", "zcp")]);
  expect(await held.client.importDevelopmentContainer(press)).toEqual({
    serviceName: "zcp",
    imported: false,
  });
  expect(held.writes).toEqual([]);

  const several = platform([zcp("svc-1", "zcp"), zcp("svc-2", "zcp1")]);
  const refused = await several.client
    .importDevelopmentContainer(press)
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(Error);
  expect(several.writes).toEqual([]);
});
