import { describe, expect, it } from "@effect/vitest";
import { sessionDatabase } from "./database.ts";

describe("A: disposable session database fault driver", () => {
  it("rejects nonlocal databases before running a command", () => {
    expect(() => sessionDatabase("postgres://postgres@example.test/live", "fixture")).toThrow(
      "localhost",
    );
    expect(() => sessionDatabase("https://127.0.0.1/live", "fixture")).toThrow("localhost");
  });
});
