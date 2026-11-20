import { expect, it } from "vite-plus/test";

import { ZeropsApiError } from "../../zerops/errors.ts";
import { makeVaultReveal } from "./vaultReveal.ts";

/** A Zerops door holding one sensitive value per reveal path; a refused path throws its error. */
const door =
  (values: Readonly<Record<string, string>>, refused: Readonly<Record<string, ZeropsApiError>>) =>
  async <T>(path: string): Promise<T> => {
    const refusal = refused[path];
    if (refusal !== undefined) throw refusal;
    const content = values[path];
    if (content === undefined) throw new ZeropsApiError("Not found", "not-found", 404, null);
    return { content } as T;
  };

// witness: packages/client-runtime/src/data/adapters/vaultReveal.ts | scope.kind === "shared" → scope.kind !== "shared"
it("AD+7: Revealing a Shared secret asks through the project's values and a service's through its own, and a refusal keeps the platform's code, never a value", async () => {
  const reveal = makeVaultReveal({
    door: door(
      { "/project-env/v1/reveal": "v2", "/user-data/v1/reveal": "v3" },
      {
        "/project-env/v4/reveal": new ZeropsApiError("Forbidden", "forbidden", 403, "v5"),
      },
    ),
  });

  expect(await reveal.reveal({ kind: "shared" }, "v1")).toEqual({ ok: true, value: "v2" });
  expect(await reveal.reveal({ kind: "service", serviceId: "v6" }, "v1")).toEqual({
    ok: true,
    value: "v3",
  });
  expect(await reveal.reveal({ kind: "shared" }, "v4")).toEqual({ ok: false, code: "v5" });
});
