import { expect, it, vi } from "vite-plus/test";
const facts = vi.hoisted(() => ({
  running: true,
  lapse: null,
  subject: "Your Zerops access",
  trouble: { sentence: "Zerops isn't answering.", tryNow: true },
  retry: vi.fn(),
  signOut: vi.fn(),
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
it("busy follows the request state and a failed attempt immediately offers again", () => {
  expect(useAccountVoice()?.actions[0]).toMatchObject({ label: "Trying…", busy: true });
  facts.running = false;
  expect(useAccountVoice()?.actions[0]).toMatchObject({ label: "Try now", busy: false });
});
