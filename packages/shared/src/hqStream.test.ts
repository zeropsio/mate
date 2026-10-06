import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  hqStreamCloseFailure,
  HqZeropsRefusedResponse,
  HQ_ZEROPS_REFUSED,
  HqStreamRequest,
  HqNavigationStatus,
} from "./hqStream.ts";

it.each([
  { close: 4403, failure: { code: "zerops_refused", disposition: "refused" } },
  { close: 1011, failure: { code: "socket_1011", disposition: "transient" } },
  { close: 4410, failure: { code: "socket_4410", disposition: "transient" } },
  { close: 4401, failure: { code: "session_ended", disposition: "session-ended" } },
])("the client classifies HQ close $close", ({ close, failure }) => {
  expect(hqStreamCloseFailure(close)).toEqual(failure);
});

const read = Schema.decodeUnknownSync(HqZeropsRefusedResponse);
const readRequest = Schema.decodeUnknownSync(HqStreamRequest);
const readStatus = Schema.decodeUnknownSync(HqNavigationStatus);

it.each([{ type: "retry" }, { type: "retry", scopes: [{ kind: "navigation" }] }])(
  "decodes a person's explicit retry: %j",
  (request) => {
    expect(readRequest(request)).toEqual(request);
  },
);

it("status is a separate small navigation fact", () => {
  expect(readStatus({ official: null, parts: { db: "up" } })).toEqual({
    official: null,
    parts: { db: "up" },
  });
});

it("defines the definitive HTTP refusal separately from an unavailable response", () => {
  expect(HQ_ZEROPS_REFUSED.status).toBe(403);
  expect(read({ code: HQ_ZEROPS_REFUSED.code, reason: "forbidden" })).toEqual({
    code: "zerops_refused",
    reason: "forbidden",
  });
  expect(read({ code: "zerops_refused" })).toEqual({ code: "zerops_refused" });
  expect(() => read({ code: "zerops_unavailable" })).toThrow();
});
