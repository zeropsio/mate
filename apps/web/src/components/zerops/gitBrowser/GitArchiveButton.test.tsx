// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { GitArchiveButton, useGitArchive } from "./GitArchiveButton";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const sha = "c".repeat(40);
const held = vi.hoisted(() => ({
  views: {} as Record<string, unknown>,
  asked: [] as Array<{ params: unknown; allowed: unknown }>,
  again: 0,
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowse: (request: { params: { format: string } }, allowed: unknown) => {
    held.asked.push({ params: request.params, allowed });
    return {
      view: held.views[request.params.format] ?? { state: "unread", busy: allowed === true },
      again: () => held.again++,
    };
  },
}));

function Downloads() {
  return <GitArchiveButton archive={useGitArchive("app", "shop", sha)} />;
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
const saved: Array<{ href: string; download: string }> = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  held.views = {};
  held.asked = [];
  held.again = 0;
  saved.length = 0;
  vi.restoreAllMocks();
});

async function page() {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ href: this.href, download: this.download });
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:archive");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Downloads />));
}
const rerender = () => act(async () => root!.render(<Downloads />));
const press = (label: string) =>
  act(async () =>
    [...host!.querySelectorAll("button")].find((button) => button.textContent === label)!.click(),
  );

describe("Git browser archive download", () => {
  it("Download ZIP reads the commit's archive only when pressed and saves it under the repository and short commit id", async () => {
    await page();
    expect(held.asked.every((ask) => ask.allowed === undefined)).toBe(true);
    await press("Download ZIP");
    expect(held.asked.at(-1)).toEqual({ params: { sha, format: "zip" }, allowed: true });
    expect(saved).toEqual([]);
    held.views["zip"] = { state: "known", answer: new Blob(["zip"]), busy: false, failed: false };
    await rerender();
    expect(saved).toEqual([{ href: "blob:archive", download: "shop-ccccccc.zip" }]);
    // Pressed again, the archive held is saved again without another read.
    const asks = held.asked.length;
    await press("Download ZIP");
    expect(saved).toHaveLength(2);
    expect(held.asked.slice(asks).every((ask) => ask.allowed === true)).toBe(true);
    await press("Download tar.gz");
    expect(held.asked.at(-1)).toEqual({ params: { sha, format: "tar.gz" }, allowed: true });
  });

  it("An archive past the size cap says to clone the repository instead", async () => {
    await page();
    await press("Download tar.gz");
    held.views["tar.gz"] = {
      state: "refused",
      reason: "too_large",
      words: "It is larger than 100 MiB. Clone the repository instead.",
    };
    await rerender();
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe(
      "It is larger than 100 MiB. Clone the repository instead.",
    );
    expect(host!.textContent).not.toContain("Read again");
    expect(saved).toEqual([]);
  });

  it("An archive HQ could not send offers Read again, and saves once it arrives", async () => {
    await page();
    await press("Download ZIP");
    held.views["zip"] = { state: "failed", words: "HQ is busy. Read again in a moment." };
    await rerender();
    await press("Read again");
    expect(held.again).toBe(1);
    held.views["zip"] = { state: "known", answer: new Blob(["zip"]), busy: false, failed: false };
    await rerender();
    expect(saved).toEqual([{ href: "blob:archive", download: "shop-ccccccc.zip" }]);
  });
});
