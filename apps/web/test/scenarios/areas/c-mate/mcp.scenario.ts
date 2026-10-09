import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { McpServerName, ProviderDriverKind, type McpServerAgent } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const driver = ProviderDriverKind.make("codex");
const reports: ReadonlyArray<McpServerAgent> = [
  {
    driver,
    state: "connected",
    tools: [{ name: "zerops_discover", description: "Inspect the project" }],
  },
  { driver, state: "failed", error: "zcp exited with code 1" },
  { driver, state: "configured" },
];

describe("C: the built-in MCP server", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each(reports)("the MCP panel renders the Mate's $state report", (report) =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        chat.fixture().history("The existing conversation is still here");
        chat.fixture().mcp = {
          agents: [driver],
          servers: [
            {
              name: McpServerName.make("zerops"),
              managed: true,
              transport: { type: "stdio", command: "zcp", args: ["serve"] },
              agents: [report],
            },
          ],
        };
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.type("/mcp");
        yield* chat.when.key("Enter");
        yield* chat.then.text("MCP servers");
        yield* chat.when.click("zerops");
        yield* chat.then.text("zcp serve");
        if (report.state === "connected") {
          yield* chat.then.text("zerops_discover");
          yield* chat.then.text("Inspect the project");
        } else {
          yield* chat.then.text("No tools reported yet.");
          if (report.error !== undefined) yield* chat.then.text(report.error);
        }
        if (report.state === "configured") yield* chat.then.noButton("Reconnect");
        else yield* chat.then.control("Reconnect");
        expect(
          yield* Effect.promise(() =>
            s.page.$eval('[data-mcp-server="zerops"]', (row) => row.getAttribute("data-mcp-state")),
          ),
        ).toBe(report.state);
      }),
    );
  });
});
