import type { ComponentType, ReactElement } from "react";

import { StatusPage } from "~/components/ui/status-page";

interface FlowState<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface FlowStates<Id extends string = string> {
  readonly id: string;
  readonly title: string;
  readonly area: string;
  readonly states: readonly [FlowState<Id>, ...FlowState<Id>[]];
}

const FRAMES = {
  page: "flex h-dvh flex-col bg-background text-foreground",
};

export interface DesignFlow {
  readonly id: string;
  readonly defaultState: string;
  readonly frame: keyof typeof FRAMES;
  readonly viewFor: (id: string) => ReactElement | undefined;
}

/** Bind each listed state to the inputs of the component the product renders. */
export function defineFlow<const Id extends string, Props extends object>(
  definition: FlowStates<Id>,
  {
    view: View,
    frame,
    states,
  }: {
    readonly view: ComponentType<Props>;
    readonly frame: DesignFlow["frame"];
    readonly states: Readonly<Record<NoInfer<Id>, NoInfer<Props>>>;
  },
): DesignFlow {
  const fixtures = new Map<string, Props>(definition.states.map(({ id }) => [id, states[id]]));
  return {
    id: definition.id,
    defaultState: definition.states[0].id,
    frame,
    viewFor(id) {
      const fixture = fixtures.get(id);
      return fixture === undefined ? undefined : <View {...fixture} />;
    },
  };
}

/** The frame around the selected state, shared by the browser and in-process readers. */
export function stateElement(flow: DesignFlow, id: string): ReactElement {
  return (
    <div className={FRAMES[flow.frame]} data-kit-state={`${flow.id}/${id}`}>
      {flow.viewFor(id) ?? <StatusPage title={`no state ${id} in ${flow.id}`} />}
    </div>
  );
}
