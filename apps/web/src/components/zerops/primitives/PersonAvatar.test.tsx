import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PersonAvatar } from "./PersonAvatar";

describe("Avatar", () => {
  it("shows the initials when there is no picture", () => {
    const html = renderToStaticMarkup(<PersonAvatar name="Ada Lovelace" />);
    expect(html).toContain('data-zerops-primitive="avatar"');
    expect(html).toContain('data-zerops-avatar="initials"');
    expect(html).toContain(">A<");
    expect(html).not.toContain("<img");
  });

  it("lays the picture over the initials, so a slow or broken image still reads", () => {
    const html = renderToStaticMarkup(
      <PersonAvatar name="Ada Lovelace" picture="https://cdn/ada.png" />,
    );
    expect(html).toContain('data-zerops-avatar="picture"');
    expect(html).toContain('src="https://cdn/ada.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain(">A<");
  });

  it("is decoration: the name it stands for is written beside it", () => {
    expect(renderToStaticMarkup(<PersonAvatar name="Ada" />)).toContain('aria-hidden="true"');
  });

  it("draws one person with the same letter whether a surface names them in full or by first name", () => {
    const letter = (name: string) =>
      /data-zerops-avatar="initials"[^>]*>(.)</u.exec(
        renderToStaticMarkup(<PersonAvatar name={name} />),
      )?.[1];
    expect(letter("Ada")).toBe(letter("Ada Lovelace"));
  });
});
