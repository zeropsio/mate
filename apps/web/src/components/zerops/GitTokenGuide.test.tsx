// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { GitTokenGuide } from "./GitTokenGuide";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

async function guide() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<GitTokenGuide project="Shop" />));
  const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
  return {
    host,
    input,
    enter: async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("direct push token guide", () => {
  it("offers only a URL and instructions without a token field, save, probe or connection claim", async () => {
    const view = await guide();
    try {
      expect(view.host.textContent).toContain("Enter your repository URL");
      expect(view.host.querySelectorAll("input")).toHaveLength(1);
      expect(view.host.querySelector("button")).toBeNull();
      expect(view.host.querySelector("a")).toBeNull();
      await view.enter("https://github.com/acme/widgets");
      expect(view.host.textContent).toContain("Resource owner: acme");
      expect(view.host.textContent).toContain("The link cannot select the repository for you.");
      expect(view.host.textContent).toContain("Workflows: Read and write is optional");
      expect(view.host.textContent).toContain("Direct push to a branch only");
      expect(view.host.textContent).toContain(
        "This guide does not connect a repository or check access.",
      );
      const url = new URL(view.host.querySelector<HTMLAnchorElement>("a")!.href);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        name: "Mate Shop",
        target_name: "acme",
        expires_in: "366",
        contents: "write",
        workflows: "write",
        checks: "read",
        statuses: "read",
        actions: "read",
        // Automated Mates take the repository's issues and HQ makes its webhook.
        issues: "write",
        repository_hooks: "write",
      });
      expect(view.host.querySelectorAll("input")).toHaveLength(1);
      expect(view.host.querySelector("button")).toBeNull();
      await view.enter("git@github.com:acme/widgets");
      expect(view.input.getAttribute("aria-invalid")).toBe("true");
      expect(view.host.querySelector("a")).toBeNull();
      expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
        "SSH URLs are not supported",
      );
      await view.enter("");
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(view.host.textContent).toContain("Enter your repository URL");
    } finally {
      await view.close();
    }
  });
  it.each([
    ["https://gitlab.com/team/widgets", "write_repository", "Create GitLab personal access token"],
    ["https://forge.example.org/team/widgets", "write:repository", "Open likely token settings"],
  ])(
    "replaces host-specific instructions when the URL changes to %s",
    async (url, permission, linkLabel) => {
      const view = await guide();
      try {
        await view.enter("https://github.com/acme/widgets");
        await view.enter(url);
        expect(view.host.textContent).toContain(permission);
        expect(view.host.querySelector("a")?.textContent).toBe(linkLabel);
        expect(view.host.textContent).not.toContain("Resource owner: acme");
        expect(view.host.textContent).not.toContain("Only select repositories");
        expect(view.host.textContent).toContain("Direct push to a branch only");
        if (url.includes("forge"))
          expect(view.host.textContent).toContain(
            "Other hosts may use different permission names.",
          );
      } finally {
        await view.close();
      }
    },
  );
});
