import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { OpenCodeProviderKeyRow } from "./OpenCodeProviderKeys";

const nebius = OPENCODE_KEY_PROVIDERS[0]!;
const settled = () => Promise.resolve(null);

const render = (keySet: boolean, readOnly = false) =>
  renderToStaticMarkup(
    <OpenCodeProviderKeyRow
      provider={nebius}
      keySet={keySet}
      readOnly={readOnly}
      onSave={settled}
      onRemove={settled}
    />,
  );

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);

describe("an OpenCode provider's key line", () => {
  it("says a stored key is set, with a way to replace or remove it", () => {
    const html = render(true);
    expect(html).toContain("Nebius Token Factory");
    expect(html).toContain(" · key set");
    expect(buttons(html)).toEqual(["Replace", "Remove key"]);
  });

  it("says there is no key and offers to add one, naming what it runs", () => {
    const html = render(false);
    expect(html).toContain(" · no key");
    expect(html).toContain(`Runs OpenCode on ${nebius.models}`);
    expect(buttons(html)).toEqual(["Add key"]);
  });

  it("shows a read-only viewer whether a key is set, and nothing to change it", () => {
    expect(render(true, true)).toContain(" · key set");
    expect(buttons(render(true, true))).toEqual([]);
    expect(buttons(render(false, true))).toEqual([]);
  });
});
