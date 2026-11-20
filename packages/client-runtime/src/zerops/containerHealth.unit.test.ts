import { expect, it } from "vite-plus/test";

import {
  type DescriptorRead,
  type FetchLike,
  readMatePath,
  readZeropsContainer,
} from "../data/adapters/containerHealth.ts";

const ORIGIN = "https://zcp-26a7-8080.prg1.zerops.app";
const DESCRIPTOR = `${ORIGIN}/mate/.well-known/t3/environment`;
const HEALTHZ = `${ORIGIN}/mate/healthz`;
const SENT_AT = { wall: 0, mono: 0 };

const json = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } });

/** What a browser hands back for the cookie gate's redirect it was told not to follow. */
const cookieGate = (): Response =>
  ({ type: "opaqueredirect", status: 0, ok: false, headers: new Headers() }) as unknown as Response;

/** The container's two paths as a browser reads them, the descriptor through the same reads. */
async function read(routes: Record<string, () => Response>) {
  const fetch: FetchLike = async (url) => {
    const route = routes[url];
    if (route === undefined) throw new TypeError("Failed to fetch");
    return route();
  };
  const descriptor: DescriptorRead = async (url, { signal }) => ({
    reading: await readMatePath(`${url}/.well-known/t3/environment`, fetch, signal),
    sentAt: SENT_AT,
  });
  const answer = await readZeropsContainer(
    ORIGIN,
    { descriptor, fetch },
    new AbortController().signal,
    { fresh: true, initAt: true },
  );
  return answer.reading;
}

// witness: packages/client-runtime/src/data/adapters/matePath.ts | if (response.type === "opaqueredirect") return { kind: "redirect" }; → if (response.type === "error") return { kind: "redirect" };
it("ZV+3: A cookie-gate redirect means a container that predates Mate, never a server error; a 200 whose body does not parse is not trusted; a wrong base path is refused", async () => {
  expect(await read({ [DESCRIPTOR]: cookieGate, [HEALTHZ]: cookieGate })).toEqual({
    kind: "predates-mate",
  });
  expect(
    await read({
      [DESCRIPTOR]: () => json("<!doctype html><title>mate</title>"),
      [HEALTHZ]: () => json("<!doctype html><title>mate</title>"),
    }),
  ).toEqual({ kind: "predates-mate" });
  expect(
    await read({
      [DESCRIPTOR]: () =>
        json(JSON.stringify({ environmentId: "env-1", serverVersion: "0.16.0", basePath: "/" })),
      [HEALTHZ]: () =>
        json(JSON.stringify({ initComplete: false, initAt: "2026-08-28T15:21:25Z" })),
    }),
  ).toEqual({ kind: "initializing", initAt: "2026-08-28T15:21:25Z" });
});
