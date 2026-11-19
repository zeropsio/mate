import { expect, it } from "vite-plus/test";
import { readOncePerFile } from "./fileReads.ts";

const picture = () => new File([], "shot.png", { type: "image/png" });

// witness: packages/client-runtime/src/zerops/composer/fileReads.ts | if (known) return known; → if (known) return read(file);
it("CP45: A draft saved again reads each of its files once, and a new file anew", async () => {
  let reads = 0;
  const readOnce = readOncePerFile(async () => `read ${++reads}`);
  const first = picture();
  expect(await readOnce(first)).toBe("read 1");
  expect(await readOnce(first)).toBe("read 1");
  expect(await readOnce(picture())).toBe("read 2");
});

// witness: packages/client-runtime/src/zerops/composer/fileReads.ts | reading.catch(() => reads.delete(file)); → reading.catch(() => undefined);
it("CP46: A file that could not be read is read again the next time its draft is saved", async () => {
  let attempts = 0;
  const readOnce = readOncePerFile(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("busy");
    return "read";
  });
  const shot = picture();
  expect(await readOnce(shot).catch(() => "failed")).toBe("failed");
  expect(await readOnce(shot).catch(() => "failed")).toBe("read");
});
