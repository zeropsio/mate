import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mock = vi.hoisted(() => ({
  setPrompt: vi.fn(),
  creationJobFor: vi.fn(),
  readRegistrationRecords: vi.fn(),
  readFirstPromptMarkers: vi.fn(),
  rememberFirstPromptComposed: vi.fn(),
}));

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ setPrompt: mock.setPrompt }) },
}));
vi.mock("./zeropsBirths", () => ({
  creationJobFor: mock.creationJobFor,
}));
vi.mock("./registrationRecords", () => ({
  readRegistrationRecords: mock.readRegistrationRecords,
}));
vi.mock("./firstPromptStorage", () => ({
  readFirstPromptMarkers: mock.readFirstPromptMarkers,
  rememberFirstPromptComposed: mock.rememberFirstPromptComposed,
}));

const { composeZeropsFirstPrompt } = await import("./composeFirstPrompt");
const { ZEROPS_ONBOARDING_PROMPT } = await import("@t3tools/client-runtime/zerops/firstPrompt");

const TARGET = { kind: "draft", key: "draft-1" } as const;

describe("composeZeropsFirstPrompt (R5: the creation job is the only writer while a hand-off stands)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes nothing at all for an environment with a pending hand-off", () => {
    mock.creationJobFor.mockReturnValue({
      environmentName: "app",
      groupName: "app",
      role: "dev",
      source: { kind: "none" },
    });

    const wrote = composeZeropsFirstPrompt({
      environmentId: "env-1",
      target: TARGET as never,
    });

    expect(wrote).toBe(false);
    expect(mock.setPrompt).not.toHaveBeenCalled();
    expect(mock.rememberFirstPromptComposed).not.toHaveBeenCalled();
    // Never even asks whether it should compose — the hand-off alone decides.
    expect(mock.readFirstPromptMarkers).not.toHaveBeenCalled();
  });

  it("composes the ordinary onboarding line once the hand-off is spent", () => {
    mock.creationJobFor.mockReturnValue(undefined);
    // Registered through the Zerops door: this account's records name it.
    mock.readRegistrationRecords.mockReturnValue([
      { targetKey: "project-1:service-1", environmentId: "env-1" },
    ]);
    mock.readFirstPromptMarkers.mockReturnValue([]);

    const wrote = composeZeropsFirstPrompt({
      environmentId: "env-1",
      target: TARGET as never,
    });

    expect(wrote).toBe(true);
    expect(mock.setPrompt).toHaveBeenCalledWith(TARGET, ZEROPS_ONBOARDING_PROMPT);
    expect(mock.rememberFirstPromptComposed).toHaveBeenCalledWith("env-1");
  });

  it("still says no for an environment no record names, hand-off or not", () => {
    mock.creationJobFor.mockReturnValue(undefined);
    mock.readRegistrationRecords.mockReturnValue([
      { targetKey: "project-1:service-1", environmentId: "env-2" },
    ]);
    mock.readFirstPromptMarkers.mockReturnValue([]);

    expect(composeZeropsFirstPrompt({ environmentId: "env-1", target: TARGET as never })).toBe(
      false,
    );
    expect(mock.setPrompt).not.toHaveBeenCalled();
  });
});
