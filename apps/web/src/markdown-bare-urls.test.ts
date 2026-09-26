import { describe, expect, it } from "vite-plus/test";

import { bareUrlLabel } from "./markdown-bare-urls";

describe("bareUrlLabel", () => {
  it.each([
    {
      address: "https://gardendev-5b2d-9000.prg1.zerops.app",
      label: "gardendev-5b2d-9000.prg1.zerops.app",
    },
    {
      address: "https://gardenstage-5b2d-9000.prg1.zerops.app/app",
      label: "gardenstage-5b2d-9000.prg1.zerops.app/app",
    },
    {
      address: "https://github.com/fxck/noola/tree/main/.zerops-recipe",
      label: "github.com/fxck/noola/tree/main/.zerops-recipe",
    },
    // The protocol, the query and the fragment are machinery, not where it goes.
    {
      address: "https://orbitstage-6e3f-3000.prg1.zerops.app/?view=orbit&knights=3#hud",
      label: "orbitstage-6e3f-3000.prg1.zerops.app",
    },
    { address: "http://localhost:5733/settings/?tab=appearance", label: "localhost:5733/settings" },
    // Credentials in an address are never shown.
    { address: "https://user:secret@example.com/private", label: "example.com/private" },
    {
      address: "https://example.com/%C5%BElu%C5%A5ou%C4%8Dk%C3%BD",
      label: "example.com/žluťoučký",
    },
    // Past 48 characters the middle gives way, by whole segments where it can:
    // the host says where, the last segments what.
    {
      address:
        "https://git-4c1a-3000.prg1.zerops.app/garden/group/src/branch/main/environments.yaml",
      label: "git-4c1a-3000.prg1.zerops.app/…/environments.yaml",
    },
    {
      address: "https://git-4c1a-3000.prg1.zerops.app/garden/medusadev/actions/runs/83",
      label: "git-4c1a-3000.prg1.zerops.app/…/actions/runs/83",
    },
    {
      address: "https://shopfront-7c3e-8000.prg1.zerops.app/en/products/harbor",
      label: "shopfront-7c3e-8000.prg1.zerops.app/…/harbor",
    },
    // A segment too long to keep whole is cut in its middle instead.
    {
      address:
        "https://app-1234.prg1.zerops.app/reset-password/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      label: "app-1234.prg1.zerops.app…zdWIiOiIxMjM0NTY3ODkwIn0",
    },
  ])("shows $address as $label", ({ address, label }) => {
    expect(bareUrlLabel(address, address)).toBe(label);
  });

  it("reads an address the parser percent-encoded as the same bare address", () => {
    expect(
      bareUrlLabel(
        "https://example.com/žluťoučký",
        "https://example.com/%C5%BElu%C5%A5ou%C4%8Dk%C3%BD",
      ),
    ).toBe("example.com/žluťoučký");
  });

  it.each([
    {
      text: "the recipe's tier folder",
      href: "https://github.com/fxck/noola/tree/main/.zerops-recipe",
    },
    { text: "admin@example.com", href: "mailto:admin@example.com" },
    { text: "mailto:admin@example.com", href: "mailto:admin@example.com" },
    { text: "ftp://example.com/file", href: "ftp://example.com/file" },
    { text: "#still-open", href: "#still-open" },
  ])("keeps the text of $text, which is not a bare web address", ({ text, href }) => {
    expect(bareUrlLabel(text, href)).toBeNull();
  });

  it("keeps every label within 48 characters of the address", () => {
    const address = `https://example.com/${"segment/".repeat(12)}end`;
    const label = bareUrlLabel(address, address) ?? "";

    expect(label.replace("…", "").length).toBeLessThanOrEqual(48);
    expect(label.startsWith("example.com/…/")).toBe(true);
    expect(label.endsWith("/end")).toBe(true);
  });
});
