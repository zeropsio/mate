/** Static setup document reader; its protocol decoder remains shared. */
import { browserTransportFetch } from "./mateTransport.ts";
import { zeropsMateBaseUrl } from "../../zerops/candidates.ts";
import type { FetchLike } from "./containerHealth.ts";
import { parseMateSetup, type MateSetupReading } from "../../zerops/mateSetup.ts";

export async function readMateSetup(
  origin: string,
  fetchImpl: FetchLike = browserTransportFetch,
  signal?: AbortSignal,
): Promise<MateSetupReading> {
  const url = `${zeropsMateBaseUrl(origin.replace(/\/+$/, ""))}/setup.json`;
  let response: Response;
  try {
    response = await fetchImpl(
      url,
      signal === undefined ? { redirect: "manual" } : { redirect: "manual", signal },
    );
  } catch {
    return { kind: "unreachable" };
  }
  if (response.status === 404) return { kind: "absent" };
  if (response.type === "opaqueredirect") return { kind: "refused" };
  if (response.status >= 500) return { kind: "unreachable" };
  if (!response.ok) return { kind: "refused" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "invalid" };
  }
  const setup = parseMateSetup(body);
  return setup === undefined ? { kind: "invalid" } : { kind: "setup", setup };
}
