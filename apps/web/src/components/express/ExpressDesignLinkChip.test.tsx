import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/assets/MateImages", () => ({
  useMateImage: () => ({ read: { kind: "idle" }, url: undefined }),
}));

import { AppLinkContext } from "../ServiceBrowserLink";
import { ExpressDesignLinkChip } from "./ExpressDesignLinkChip";
import { useOpenExpressDesign } from "./useOpenExpressDesign";

const THREAD = scopeThreadRef(EnvironmentId.make("mate"), ThreadId.make("thread"));
const DESIGN =
  // A design id built from parts: never one from a real Adobe account.
  `https://new.express.adobe.com/id/${["urn", "aaid", "sc", "XX1", "00000000-0000-4000-8000-000000000001"].join(":")}`;

function Answer({ enabled }: { readonly enabled: boolean }) {
  const resolve = useOpenExpressDesign(THREAD, enabled);
  return (
    <AppLinkContext value={resolve}>
      <ExpressDesignLinkChip href={DESIGN} words="Spring poster">
        <a href={DESIGN}>Spring poster</a>
      </ExpressDesignLinkChip>
    </AppLinkContext>
  );
}

describe("an Adobe Express design link in a conversation", () => {
  it.each([
    { title: "draws as a card opening the side panel while Express is on", enabled: true },
    { title: "stays a plain link while Express is off", enabled: false },
  ])("$title", ({ enabled }) => {
    const html = renderToStaticMarkup(<Answer enabled={enabled} />);
    expect(html).toContain("Spring poster");
    expect(html.includes("Open in the side panel")).toBe(enabled);
  });
});
