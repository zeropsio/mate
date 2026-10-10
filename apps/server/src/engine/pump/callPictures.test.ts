// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PAGE_MAX_BYTES, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PIXEL } from "../testing/bridge/callHeavy.ts";
import { makeCallPictures, publishedPage } from "./callPictures.ts";

const thread = ThreadId.make("mate/s/1");

const fixture = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "call-pictures-"));
  const cwd = NodePath.join(root, "work");
  NodeFS.mkdirSync(NodePath.join(cwd, "shots"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(cwd, "shots", "home.png"), Buffer.from(PIXEL, "base64"));
  return makeCallPictures(NodePath.join(root, "state"), () => Effect.succeed(cwd));
};

describe("a call's pictures in the Mate's asset store", () => {
  it.effect("stores a result's picture once, however often its batch is told", () =>
    Effect.gen(function* () {
      const pictures = fixture();
      const image = { mimeType: "image/png", data: PIXEL };
      const first = yield* pictures.results(thread, "call-1", [image]);
      const again = yield* pictures.results(thread, "call-1", [image]);
      assert.isFalse(first.dropped);
      assert.strictEqual(first.images.length, 1);
      const idOf = (stored: typeof first) =>
        (stored.images[0]?.asset as { id?: string } | undefined)?.id;
      assert.strictEqual(idOf(again), idOf(first));
      assert.include(first.images[0], { mimeType: "image/png", width: 1, height: 1 });
    }),
  );

  it.effect("names a workspace picture a call looked at by its asset, with its name and size", () =>
    Effect.gen(function* () {
      const looked = yield* fixture().looked(thread, "call-3", "shots/home.png");
      assert.match(looked?.imagePath ?? "", /^mate-asset:[0-9a-f-]{36}$/);
      assert.strictEqual(looked?.imageName, "home.png");
      assert.deepStrictEqual(looked?.imageDimensions, { width: 1, height: 1 });
    }),
  );
});

describe("a page the Mate publishes, in its asset store", () => {
  const pagesOf = () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "call-pages-"));
    const pages = NodePath.join(root, "work", ".zcp", "state", "pages");
    NodeFS.mkdirSync(pages, { recursive: true });
    const outside = NodePath.join(root, "secret.html");
    NodeFS.writeFileSync(outside, "<p>not a page</p>");
    NodeFS.writeFileSync(NodePath.join(pages, "page-0123456789abcdef.html"), "<h1>Plan</h1>");
    NodeFS.symlinkSync(outside, NodePath.join(pages, "page-1111111111111111.html"));
    NodeFS.writeFileSync(
      NodePath.join(pages, "page-2222222222222222.html"),
      Buffer.alloc(PAGE_MAX_BYTES + 1, 0x61),
    );
    NodeFS.mkdirSync(NodePath.join(pages, "page-3333333333333333.html"));
    // Another session's pages: named as zcp names them, not this session's.
    const theirs = NodePath.join(root, "other", ".zcp", "state", "pages");
    NodeFS.mkdirSync(theirs, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(theirs, "page-5555555555555555.html"), "<p>theirs</p>");
    return {
      pages,
      outside,
      theirs,
      store: makeCallPictures(NodePath.join(root, "state"), () =>
        Effect.succeed(NodePath.join(root, "work")),
      ),
    };
  };

  it.effect("keeps a published page once, by reference, with its size", () =>
    Effect.gen(function* () {
      const { pages, store } = pagesOf();
      const file = NodePath.join(pages, "page-0123456789abcdef.html");
      const first = yield* store.page(thread, "call-4", file);
      const again = yield* store.page(thread, "call-4", file);
      assert.strictEqual(first?.asset.original.status, "ready");
      assert.include(first?.asset.original, { mimeType: "text/html", sizeBytes: 13 });
      assert.strictEqual(first?.bytes, 13);
      assert.strictEqual(again?.asset.id, first?.asset.id);
    }),
  );

  it.effect.each([
    ["a file outside zcp's pages", "outside"],
    ["a page that links elsewhere", "page-1111111111111111.html"],
    ["a page over the cap", "page-2222222222222222.html"],
    ["a directory", "page-3333333333333333.html"],
    ["a page that is not there", "page-4444444444444444.html"],
    ["a relative name", "relative"],
    ["another session's page", "theirs"],
  ] as const)("never reads %s", ([_what, name]) =>
    Effect.gen(function* () {
      const { pages, outside, theirs, store } = pagesOf();
      const file =
        name === "outside"
          ? outside
          : name === "relative"
            ? ".zcp/state/pages/page-0123456789abcdef.html"
            : name === "theirs"
              ? NodePath.join(theirs, "page-5555555555555555.html")
              : NodePath.join(pages, name);
      assert.isNull(yield* store.page(thread, "call-5", file));
    }),
  );
});

describe("the page a call published", () => {
  it.each([
    [
      "zcp's result",
      {
        toolName: "zerops_publish_page",
        resultText: JSON.stringify({
          page: { id: "page-1", title: "Plan", file: "/w/.zcp/state/pages/page-1.html", bytes: 9 },
          message: "Published",
        }),
      },
      { title: "Plan", file: "/w/.zcp/state/pages/page-1.html" },
    ],
    [
      "zcp's result with the page's measured height",
      {
        toolName: "zerops_publish_page",
        resultText: JSON.stringify({
          page: { title: "Plan", file: "/w/.zcp/state/pages/page-1.html", height: 611.5 },
        }),
      },
      { title: "Plan", file: "/w/.zcp/state/pages/page-1.html", height: 612 },
    ],
    ["another tool's", { toolName: "zerops_browser", resultText: '{"page":{}}' }, null],
    ["a refusal", { toolName: "zerops_publish_page", resultText: '{"code":"X"}' }, null],
    ["a result over the wire's limit", { toolName: "zerops_publish_page", truncated: true }, null],
    [
      "a page with no title",
      { toolName: "zerops_publish_page", resultText: '{"page":{"file":"/w/p.html"}}' },
      null,
    ],
  ] as const)("is read from %s", (_what, result, want) => {
    assert.deepStrictEqual(publishedPage(result), want);
  });
});
