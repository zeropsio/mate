import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "../../zerops/api.ts";
import { makeVaultReveal } from "./vaultReveal.ts";

describe("makeVaultReveal", () => {
  const client = (fail?: ZeropsApiError) => {
    const asked: Array<string> = [];
    return {
      asked,
      client: {
        revealProjectVariable: async (id: string) => {
          asked.push(`project ${id}`);
          if (fail) throw fail;
          return "shared-value";
        },
        revealServiceVariable: async (id: string) => {
          asked.push(`service ${id}`);
          if (fail) throw fail;
          return "service-value";
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
