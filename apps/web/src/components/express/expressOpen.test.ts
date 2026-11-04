import { describe, expect, it } from "vite-plus/test";

import { expressDesignId } from "./expressOpen";

// A design id built from parts: never one from a real Adobe account.
const DESIGN_ID = ["urn", "aaid", "sc", "XX1", "00000000-0000-4000-8000-000000000001"].join(":");

describe("expressDesignId", () => {
  it.each([
    {
      title: "reads the design an Express edit link names",
      href: `https://new.express.adobe.com/id/${DESIGN_ID}?referrer=claude`,
      id: DESIGN_ID,
    },
    {
      title: "reads an encoded design address",
      href: "https://express.adobe.com/id/urn%3Aaaid%3Asc%3AVA6C2%3Aabc",
      id: "urn:aaid:sc:VA6C2:abc",
    },
    {
      title: "leaves an Express page that names no design",
      href: "https://new.express.adobe.com/new",
      id: null,
    },
    {
      title: "leaves a lookalike host",
      href: "https://new.express.adobe.com.evil.test/id/urn:aaid:sc:X:1",
      id: null,
    },
    {
      title: "leaves a plain-http address",
      href: "http://new.express.adobe.com/id/urn:aaid:sc:X:1",
      id: null,
    },
    { title: "leaves what is not an address", href: "urn:aaid:sc:X:1", id: null },
  ])("$title", ({ href, id }) => {
    expect(expressDesignId(href)).toBe(id);
  });
});
