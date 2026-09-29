import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import { useChangedSinceShown } from "./useChangedSinceShown";

function Probe({ value }: { readonly value: string }): ReactNode {
  return useChangedSinceShown(value) ? "changed" : "as shown";
}

describe("useChangedSinceShown", () => {
  it("is false on a first paint, turns true once the value changes, and stays so", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Probe value="Nova is thinking" />);
    });
    expect(renderer!.toJSON()).toBe("as shown");
    act(() => renderer!.update(<Probe value="Nova is working" />));
    expect(renderer!.toJSON()).toBe("changed");
    act(() => renderer!.update(<Probe value="Nova is thinking" />));
    expect(renderer!.toJSON()).toBe("changed");
    act(() => renderer!.unmount());
  });

  it("lets a stand-in give way to the value read without counting a change", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Known({ value, known }: { readonly value: string; readonly known: boolean }) {
      return useChangedSinceShown(value, known) ? "changed" : "as shown";
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<Known known={false} value="remembered words" />);
    });
    act(() => renderer!.update(<Known known value="the words read" />));
    expect(renderer!.toJSON()).toBe("as shown");
    act(() => renderer!.update(<Known known value="newer words" />));
    expect(renderer!.toJSON()).toBe("changed");
    act(() => renderer!.unmount());
  });
});
