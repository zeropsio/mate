import { expect, it } from "vite-plus/test";
import { deadline } from "../harness/http.ts";

it("a receipt wait its test stops names the receipt it waited for", async () => {
  const stop = new AbortController();
  const waited = deadline(new Promise(() => {}), "HQ's first answer", stop.signal).catch(
    (error: Error) => error.message,
  );
  stop.abort();
  expect(await waited).toBe("Timed out: HQ's first answer");
});
