import type { TestHqRequest, TestHqResponse } from "@zerops/session/testing/test-hq";
import type { WireRequest, WireResponse } from "./http.ts";

/** A request the harness's server took, in the shape `@zerops/session`'s test HQ reads. */
export function toTestHq(request: WireRequest): TestHqRequest {
  return {
    method: request.method,
    url: `${request.url.pathname}${request.url.search}`,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(", ") : value,
      ]),
    ),
    ...(request.rawBody === undefined ? {} : { body: request.rawBody.toString() }),
  };
}

export function fromTestHq(response: TestHqResponse | null): WireResponse | undefined {
  if (response === null) return undefined;
  // `serve` sends lower-cased CORS headers of its own, which these replace rather than repeat.
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { status: response.status, headers, bytes: Buffer.from(response.body) };
}
