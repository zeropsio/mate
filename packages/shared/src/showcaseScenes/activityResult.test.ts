import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ZeropsActivityResult } from "./activityResult.ts";

const decodeActivityResult = Schema.decodeUnknownSync(ZeropsActivityResult);
const encodeActivityResult = Schema.encodeSync(ZeropsActivityResult);

describe("ZeropsActivityResult", () => {
  it.each([
    { toolName: "zerops_import" },
    { toolName: "zerops_verify", resultText: "" },
    { toolName: "zerops_deploy", resultText: '{"status":"DEPLOYED"}' },
    { toolName: "zerops_mount", truncated: true as const },
  ])("round-trips $toolName through the shared schema", (value) => {
    const encoded = encodeActivityResult(value);

    expect(decodeActivityResult(encoded)).toEqual(value);
  });

  it.each([
    {},
    { toolName: "" },
    { toolName: 42 },
    { toolName: "zerops_verify", resultText: 42 },
    { toolName: "zerops_deploy", truncated: false },
  ])("rejects a value outside the projected result shape", (value) => {
    expect(() => decodeActivityResult(value)).toThrow();
  });
});
