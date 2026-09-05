import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows the initials when there is no picture", () => {
    const html = renderToStaticMarkup(<Avatar initials="AL" />);
    expect(html).toContain('data-zerops-primitive="avatar"');
    expect(html).toContain('data-zerops-avatar="initials"');
    expect(html).toContain(">AL<");
    expect(html).not.toContain("<img");
  });

  it("lays the picture over the initials, so a slow or broken image still reads", () => {
    const html = renderToStaticMarkup(<Avatar initials="AL" src="https://cdn/ada.png" />);
    expect(html).toContain('data-zerops-avatar="picture"');
    expect(html).toContain('src="https://cdn/ada.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain(">AL<");
  });

  it("is decoration: the name it stands for is written beside it", () => {
    expect(renderToStaticMarkup(<Avatar initials="A" />)).toContain('aria-hidden="true"');
  });

  it("has the bar size and the identity-block size", () => {
    expect(renderToStaticMarkup(<Avatar initials="A" />)).toContain("size-6");
    expect(renderToStaticMarkup(<Avatar initials="A" size="md" />)).toContain("size-8");
  });
});
