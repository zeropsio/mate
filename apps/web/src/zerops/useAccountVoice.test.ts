import { expect, it, vi } from "vite-plus/test";
const facts = vi.hoisted(() => ({
  unanswered: true,
  subject: "Org's projects and services",
  trouble: { sentence: "Zerops isn't answering. Trying again…", tryNow: true },
  retry: vi.fn(),
}));
vi.mock("./inventoryContext", () => ({ useAccountTrouble: () => facts }));
vi.mock("react", () => ({
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
import { useAccountVoice } from "./useAccountVoice";
it("offers Try now while the account retries on its own: Trying… is the person's press alone", () => {
  expect(useAccountVoice()?.actions[0]).toMatchObject({ label: "Try now", busy: false });
});
