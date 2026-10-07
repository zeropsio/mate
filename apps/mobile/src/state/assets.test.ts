import { EnvironmentId, ThreadId, type AssetResource } from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  modern: true,
  read: "ready",
  uri: "data:image/png;base64,AQID" as string | null,
  createUrl: vi.fn(),
  image: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ _tag: "Success", value: { relativeUrl: "/api/assets/legacy/image.png" } }),
}));
vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/state/assets")>()),
  createAssetEnvironmentAtoms: () => ({ createUrl: mocks.createUrl }),
}));
vi.mock("./session", () => ({
  usePreparedConnection: () => ({
    _tag: "Some",
    value: {
      httpBaseUrl: "https://mate.test/mate",
      contentAddressedImages: mocks.modern,
    },
  }),
}));
vi.mock("../assets/MateImages", () => ({
  useMateImageUri: (key: unknown) => {
    mocks.image(key);
    return { read: { kind: mocks.read }, uri: mocks.uri };
  },
}));
import { useAssetUrlState } from "./assets";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.modern = true;
  mocks.read = "ready";
  mocks.uri = "data:image/png;base64,AQID";
});
const environmentId = EnvironmentId.make("mate");
const resources: AssetResource[] = [
  { _tag: "attachment", attachmentId: "image", mimeType: "image/png", occurrenceId: "occurrence" },
  {
    _tag: "workspace-file",
    threadId: ThreadId.make("thread"),
    path: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  },
  { _tag: "workspace-file", threadId: ThreadId.make("thread"), path: "/workspace/shot.png" },
  { _tag: "project-favicon", cwd: "/workspace" },
];
it.each(resources)(
  "native modern images use only the authorized data-layer bytes: $_tag",
  (resource) => {
    expect(useAssetUrlState(environmentId, resource)).toEqual({ _tag: "Success", url: mocks.uri });
    expect(mocks.image).toHaveBeenCalledWith({ environmentId, resource, rendition: "original" });
    expect(mocks.createUrl).not.toHaveBeenCalled();
  },
);
it.each(["unknown", "reading", "failed"])(
  "native modern image $0 never falls back to a signed URL",
  (kind) => {
    mocks.read = kind;
    mocks.uri = null;
    expect(useAssetUrlState(environmentId, resources[0]!)).toEqual({
      _tag: kind === "failed" ? "Failure" : "Loading",
    });
    expect(mocks.createUrl).not.toHaveBeenCalled();
  },
);
it("native legacy servers retain their signed route as the only read path", () => {
  mocks.modern = false;
  expect(useAssetUrlState(environmentId, resources[0]!)).toEqual({
    _tag: "Success",
    url: "https://mate.test/mate/api/assets/legacy/image.png",
  });
  expect(mocks.createUrl).toHaveBeenCalledOnce();
  expect(mocks.image).toHaveBeenCalledWith(null);
});
