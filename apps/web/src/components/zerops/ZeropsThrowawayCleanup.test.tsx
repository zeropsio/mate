import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ZeropsThrowawayCleanup } from "./ZeropsThrowawayCleanup";
import type { ThrowawaySweepView } from "../../zerops/useZeropsThrowawaySweep";

describe("ZeropsThrowawayCleanup", () => {
  it.each<ThrowawaySweepView["state"]>(["idle", "waiting", "running", "done", "failed"])(
    "shows %s with the next action",
    (state) => {
      const html = renderToStaticMarkup(
        <ZeropsThrowawayCleanup
          view={{
            state,
            failure: state === "failed" ? "Zerops did not answer." : null,
            again: () => {},
          }}
        />,
      );
      if (state === "failed") {
        expect(html).toContain("Zerops did not answer.");
        expect(html).toContain("Try again");
        expect(html).toContain('role="alert"');
      } else if (state === "running" || state === "waiting") {
        expect(html).toContain(
          state === "running" ? "Cleaning up sign-in tokens…" : "Sign-in cleanup queued.",
        );
        expect(html).toContain("disabled");
      } else {
        expect(html).toContain("Clean up sign-in tokens");
        if (state === "done") expect(html).toContain("Sign-in cleanup finished.");
      }
    },
  );
});
