import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "../../zerops/errors.ts";
import { makeVaultReveal } from "./vaultReveal.ts";

describe("makeVaultReveal", () => {
  const client = (fail?: ZeropsApiError) => {
    const asked: Array<string> = [];
    return {
      asked,
      client: {
        door: async <T>(path: string) => {
          const [, resource, id, action] = path.split("/");
          if (action !== "reveal" || (resource !== "project-env" && resource !== "user-data"))
            throw new Error("Unexpected vault request");
          const shared = resource === "project-env";
          asked.push(`${shared ? "project" : "service"} ${id}`);
          if (fail) throw fail;
          return { content: shared ? "shared-value" : "service-value" } as T;
        },
      },
    };
  };

  it("asks Zerops for a Shared secret through the project's values, and a service's through its own", async () => {
    const { asked, client: source } = client();
    const reveal = makeVaultReveal(source);
    await expect(reveal.reveal({ kind: "shared" }, "e1")).resolves.toEqual({
      ok: true,
      value: "shared-value",
    });
    await expect(reveal.reveal({ kind: "service", serviceId: "s1" }, "u1")).resolves.toEqual({
      ok: true,
      value: "service-value",
    });
    expect(asked).toEqual(["project e1", "service u1"]);
  });

  it("answers the platform's code when Zerops will not show it", async () => {
    const refusal = new ZeropsApiError("Forbidden", "forbidden", 403, "notInSudoMode");
    const reveal = makeVaultReveal(client(refusal).client);
    await expect(reveal.reveal({ kind: "shared" }, "e1")).resolves.toEqual({
      ok: false,
      code: "notInSudoMode",
    });
  });
});
