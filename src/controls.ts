import type { CommandAction, CommandKeys, Config } from "./config.ts";
import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";
import type { DeckMessage } from "./serial.ts";

export interface ControlState {
  readonly pageIndex: number;
  readonly selectedPaneId: string | undefined;
  /**
   * Which machine the selected pane belongs to. Herdr scopes pane IDs per
   * server, so the pane ID alone does not identify an agent once the Fleet
   * spans machines.
   */
  readonly selectedMachine: string | undefined;
  readonly workspaceId: string | undefined;
  readonly encoderMode: "workspaces" | "tabs" | "navigate";
  readonly tabId: string | undefined;
  readonly pressedCommandActions: Readonly<Partial<Record<keyof CommandKeys, CommandAction>>>;
  readonly targetPreviewName: string | undefined;
}

export type ControlMessage =
  | Exclude<DeckMessage, { readonly t: "hello" }>
  | { readonly t: "encoderTimeout" };

export type ControlEffect =
  | { readonly type: "focusAgent"; readonly paneId: string; readonly machine: string }
  | {
      readonly type: "sendKeys";
      readonly paneId: string;
      readonly machine: string;
      readonly keys: readonly string[];
    }
  | { readonly type: "newAgent" }
  | { readonly type: "invokePluginAction"; readonly id: string }
  | { readonly type: "hidKeys"; readonly keys: ReadonlyArray<string> }
  | { readonly type: "closeTab" }
  | { readonly type: "hid"; readonly key: string; readonly down: boolean }
  | { readonly type: "selectWorkspace"; readonly delta: number }
  | { readonly type: "enterTabMode" }
  | { readonly type: "selectTab"; readonly delta: number }
  | { readonly type: "switchTarget"; readonly name: string }
  | { readonly type: "log"; readonly message: string };

export const initialControlState: ControlState = {
  pageIndex: 0,
  selectedPaneId: undefined,
  selectedMachine: undefined,
  workspaceId: undefined,
  encoderMode: "workspaces",
  tabId: undefined,
  pressedCommandActions: {},
  targetPreviewName: undefined,
};

export function reconcileControls(
  state: ControlState,
  fleet: ReadonlyArray<Agent>,
  focusedPaneId: string | undefined,
  focusedMachine: string | undefined,
): ControlState {
  // Focus is reported by one server, so the pane must match on that machine;
  // an identically named pane on another machine is a different agent.
  const focused = fleet.find(
    ({ paneId, machine }) => paneId === focusedPaneId && machine === focusedMachine,
  );
  return {
    ...state,
    pageIndex: projectFleet(fleet, state.pageIndex).pageIndex,
    selectedPaneId: focused?.paneId,
    selectedMachine: focused?.machine,
  };
}

export const isLayerHeld = (pressed: ControlState["pressedCommandActions"]): boolean =>
  Object.values(pressed).some((action) => action.type === "layer");

export const sendSelectedKeys = (
  state: ControlState,
  keys: readonly string[],
): ReadonlyArray<ControlEffect> =>
  state.selectedPaneId && state.selectedMachine
    ? [{ type: "sendKeys", paneId: state.selectedPaneId, machine: state.selectedMachine, keys }]
    : // Dropped actions were invisible at the desk and got reported as "key does nothing".
      [{ type: "log", message: `${keys.join("+")} ignored: no agent selected` }];

export function reduceControlMessage(
  state: ControlState,
  message: ControlMessage,
  fleet: ReadonlyArray<Agent>,
  config: Pick<
    Config,
    "commandKeys" | "layerKeys" | "targets" | "defaultTarget" | "syncLocalViewKeys"
  >,
  activeTargetName = config.defaultTarget,
): { readonly state: ControlState; readonly effects: ReadonlyArray<ControlEffect> } {
  if (message.t === "encoderTimeout") {
    return {
      state: { ...state, encoderMode: "workspaces", tabId: undefined },
      // Leaving a picker open on screen would strand the user's terminal in a
      // mode they did not choose, so time-out dismisses it.
      effects: state.encoderMode === "navigate" ? [{ type: "hidKeys", keys: ["esc"] }] : [],
    };
  }
  if (message.t === "encoder") {
    if (message.delta === 0) return { state, effects: [] };
    if (isLayerHeld(state.pressedCommandActions)) {
      // Built-in like base rotation: layer-held rotation cycles pi's model.
      const binding = message.delta > 0 ? ["ctrl+p"] : ["shift+ctrl+p"];
      const keys = Array.from({ length: Math.abs(message.delta) }, () => binding).flat();
      return { state, effects: sendSelectedKeys(state, keys) };
    }
    if (state.encoderMode === "navigate") {
      const arrow = message.delta > 0 ? "down" : "up";
      return {
        state,
        effects: [
          { type: "hidKeys", keys: Array.from({ length: Math.abs(message.delta) }, () => arrow) },
        ],
      };
    }
    return {
      state,
      effects: [
        // Workspace rotation is inverted (user preference); tab rotation is not.
        state.encoderMode === "tabs"
          ? { type: "selectTab", delta: message.delta }
          : { type: "selectWorkspace", delta: -message.delta },
      ],
    };
  }
  if (message.k === 12) {
    if (!message.down) return { state, effects: [] };
    // Layer + encoder press advances the Target preview; Layer release commits.
    if (isLayerHeld(state.pressedCommandActions)) {
      const targets = Object.keys(config.targets);
      if (targets.length < 2) return { state, effects: [] };
      const currentName = state.targetPreviewName ?? activeTargetName;
      const index = (Math.max(0, targets.indexOf(currentName)) + 1) % targets.length;
      return { state: { ...state, targetPreviewName: targets[index] }, effects: [] };
    }
    if (state.encoderMode === "navigate") {
      return {
        state: { ...state, encoderMode: "workspaces", tabId: undefined },
        effects: [{ type: "hidKeys", keys: ["enter"] }],
      };
    }
    const nextMode = state.encoderMode === "workspaces" ? "tabs" : "workspaces";
    return {
      state: { ...state, encoderMode: nextMode, tabId: undefined },
      effects: nextMode === "tabs" ? [{ type: "enterTabMode" }] : [],
    };
  }

  const page = projectFleet(fleet, state.pageIndex);
  if (message.k < PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    const selected = page.slots[message.k];
    if (!selected) return { state, effects: [] };
    return {
      state,
      effects: [{ type: "focusAgent", paneId: selected.paneId, machine: selected.machine }],
    };
  }
  if (message.k === PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    return {
      state: {
        ...state,
        pageIndex: (page.pageIndex + 1) % page.pageCount,
      },
      effects: [],
    };
  }

  const slot = String(message.k - 5) as keyof CommandKeys;
  let action: CommandAction | undefined;
  let pressedCommandActions: Partial<Record<keyof CommandKeys, CommandAction>>;
  if (message.down) {
    action = isLayerHeld(state.pressedCommandActions)
      ? config.layerKeys[slot]
      : config.commandKeys[slot];
    pressedCommandActions = { ...state.pressedCommandActions, [slot]: action };
  } else {
    action = state.pressedCommandActions[slot];
    if (!action) return { state, effects: [] };
    pressedCommandActions = { ...state.pressedCommandActions };
    delete pressedCommandActions[slot];
  }

  let nextState = { ...state, pressedCommandActions };
  if (!message.down && action.type === "layer" && state.targetPreviewName) {
    const name = state.targetPreviewName;
    nextState = { ...nextState, targetPreviewName: undefined };
    const sync = config.syncLocalViewKeys;
    if (!sync) return { state: nextState, effects: [{ type: "switchTarget", name }] };
    return {
      // The chords open a picker on the local screen, so the encoder has to
      // drive that picker rather than the machine we just switched to —
      // otherwise the knob moves one machine while the user reads another.
      state: { ...nextState, encoderMode: "navigate" },
      effects: [
        { type: "switchTarget", name },
        // The Herdr client's machine view is its own UI state, so the only
        // way to move it with the Deck is to type at it.
        { type: "hidKeys", keys: sync },
      ],
    };
  }
  if (action.type === "keyAlias") {
    return { state: nextState, effects: [{ type: "hid", key: action.key, down: message.down }] };
  }
  if (!message.down) return { state: nextState, effects: [] };
  switch (action.type) {
    case "none":
    case "layer":
      return { state: nextState, effects: [] };
    case "newAgent":
      return { state: nextState, effects: [{ type: "newAgent" }] };
    case "closeTab":
      return { state: nextState, effects: [{ type: "closeTab" }] };
    case "sendKeys":
      return { state: nextState, effects: sendSelectedKeys(state, action.keys) };
    case "hidKeys":
      return {
        state: action.navigate ? { ...nextState, encoderMode: "navigate" } : nextState,
        effects: [{ type: "hidKeys", keys: action.keys }],
      };
    case "pluginAction":
      // A plugin action is a workflow on the server, not keystrokes for an
      // agent, so unlike sendKeys it needs no selection to be meaningful.
      return { state: nextState, effects: [{ type: "invokePluginAction", id: action.id }] };
  }
}

export const cycleNumbered = <
  A extends { readonly id: string; readonly number: number; readonly focused: boolean },
>(
  values: ReadonlyArray<A>,
  currentId: string | undefined,
  delta: number,
): A | undefined => {
  const ordered = [...values].sort((left, right) => left.number - right.number);
  if (ordered.length === 0) return;
  const focusedIndex = ordered.findIndex((value) => value.focused);
  const current = ordered.findIndex(({ id }) => id === currentId);
  const start = current >= 0 ? current : focusedIndex >= 0 ? focusedIndex : 0;
  const index = (((start + delta) % ordered.length) + ordered.length) % ordered.length;
  return ordered[index];
};

export const shellCommand = (argv: readonly string[]): string =>
  argv
    .map((argument) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
