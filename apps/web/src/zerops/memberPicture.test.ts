import { describe, expect, it } from "vite-plus/test";

import { md5, memberPicture } from "./memberPicture";

describe("a person's face, as the Zerops app draws one", () => {
  it.each([
    { input: "", hash: "d41d8cd98f00b204e9800998ecf8427e" },
    { input: "abc", hash: "900150983cd24fb0d6963f7d28e17f72" },
    {
      input: "The quick brown fox jumps over the lazy dog",
      hash: "9e107d9d372bb6826bd81d3542a419d6",
    },
    {
      input: "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      hash: "57edf4a22be3c955ac49da2e2107b67a",
    },
  ])("files a picture under the address's MD5: $input", ({ input, hash }) => {
    expect(md5(input)).toBe(hash);
  });

  it.each([
    {
      sentence: "HQ's picture wins",
      input: { hq: "https://hq/p.png", avatar: { smallAvatarUrl: "https://z/s.png" } },
      url: "https://hq/p.png",
    },
    {
      sentence: "Else the member record's own, small first",
      input: { avatar: { smallAvatarUrl: " ", externalAvatarUrl: "https://ext/e.png" } },
      url: "https://ext/e.png",
    },
    {
      sentence: "Else Gravatar's real picture for their e-mail, never a pattern: none answers 404",
      input: { email: " Petra.Kralova@Example.com " },
      url: `https://www.gravatar.com/avatar/${md5("petra.kralova@example.com")}?s=160&d=404`,
    },
    { sentence: "Nothing known: their initials stand in", input: {}, url: null },
  ])("$sentence", ({ input, url }) => {
    expect(memberPicture(input)).toBe(url);
  });
});
