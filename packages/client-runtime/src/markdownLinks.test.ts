import { describe, expect, it } from "vite-plus/test";

import { inlineCodeFilePathCandidate } from "./markdownLinks.js";

describe("inlineCodeFilePathCandidate", () => {
  it.each([
    ["src\\main.ts", "src/main.ts"],
    ["C:\\Users\\demo\\image.png", "C:\\Users\\demo\\image.png"],
    ["\\\\server\\share\\image.png", "\\\\server\\share\\image.png"],
    ["conf.d/nginx.conf", "conf.d/nginx.conf"],
    ["script.pl:10", "script.pl:10"],
    ["node.meta", null],
    ["Recorded evidence here: /tmp/image.png", null],
    ["origin/main", null],
    ["127.0.0.1:3000", null],
    ["example.com/index.html", null],
    ["example.pl/index.html", null],
    ["z-ai/glm-5.3", null],
    ["z-ai/glm-5.3:12", null],
    ["python/3.12", null],
    ["Qwen/Qwen2.5-Coder", null],
    ["meta-llama/Llama-3.1-8B", null],
    ["share/man/ls.1", "share/man/ls.1"],
    ["usr/lib/libfoo.so.1", "usr/lib/libfoo.so.1"],
    ["vendor/jquery-3.6.0.min.js", "vendor/jquery-3.6.0.min.js"],
    ["./models/glm-5.3", "./models/glm-5.3"],
  ])("distinguishes file paths from code and hostnames in %s", (source, candidate) => {
    expect(inlineCodeFilePathCandidate(source)).toBe(candidate);
  });
});
