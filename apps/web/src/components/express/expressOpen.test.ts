import { describe, expect, it } from "vite-plus/test";

import { expressDesignId } from "./expressOpen";

describe("expressDesignId", () => {
  it.each([
    {
      title: "reads the design an Express edit link names",
      href: "https://new.express.adobe.com/id/urn:aaid:sc:DEU1:9c5077dd-6604-4936-97c3-1bbc4c5e0e05?referrer=claude",
      id: "urn:aaid:sc:DEU1:9c5077dd-6604-4936-97c3-1bbc4c5e0e05",
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
