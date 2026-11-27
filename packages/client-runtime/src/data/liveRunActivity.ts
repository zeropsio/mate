/** An open call takes the live row ahead of the run's other activity. */
export function liveRunActivity<T extends { readonly kind: string }, Other>(
  items: ReadonlyArray<T>,
  other: () => Other,
):
  | { readonly kind: "calls"; readonly calls: ReadonlyArray<T & { readonly kind: "call" }> }
  | { readonly kind: "other"; readonly activity: Other } {
  const calls = items.filter(
    (item): item is T & { readonly kind: "call" } =>
      item.kind === "call" && "state" in item && item.state === "running",
  );
  return calls.length > 0 ? { kind: "calls", calls } : { kind: "other", activity: other() };
}
