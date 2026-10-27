import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const env = vi.hoisted(() => ({ isElectron: false }));

vi.mock("../../env", () => ({
  get isElectron() {
    return env.isElectron;
  },
}));

import { DesktopDownloadRow } from "./DesktopDownloadRow";

describe("DesktopDownloadRow", () => {
  it("links to the latest desktop release when running in a browser tab", () => {
    env.isElectron = false;

    const markup = renderToStaticMarkup(<DesktopDownloadRow />);

    expect(markup).toContain('href="https://github.com/zeropsio/mate/releases/latest"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("renders nothing inside the Electron shell, where the entry would be noise", () => {
    env.isElectron = true;

    const markup = renderToStaticMarkup(<DesktopDownloadRow />);

    expect(markup).toBe("");
  });
});
