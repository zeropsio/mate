import { assert, describe, it } from "@effect/vitest";

import { parseEnvFile } from "./envFile.ts";

describe("parseEnvFile", () => {
  it('reads the platform\'s KEY="…" lines, unescaping \\\\, \\" and \\$', () => {
    // `GET /project/{id}/env-file` as a Read only token read it on mate-rig-hq, 2026-10-02.
    const envFile =
      'HQ_CONTRACT_PLAIN="contract \\"plain\\" \\\\ value"\nHQ_CONTRACT_SECRET="REDACTED"\n' +
      'envIsolation="service"\nzeropsSubdomainString="https://\\${hostname}-30db-\\${port}.prg1.zerops.app"';
    assert.deepStrictEqual(
      [...parseEnvFile(envFile)],
      [
        ["HQ_CONTRACT_PLAIN", 'contract "plain" \\ value'],
        ["HQ_CONTRACT_SECRET", "REDACTED"],
        ["envIsolation", "service"],
        ["zeropsSubdomainString", "https://${hostname}-30db-${port}.prg1.zerops.app"],
      ],
    );
  });

  it("reads an empty file as no variables", () => {
    assert.strictEqual(parseEnvFile("").size, 0);
  });
});
