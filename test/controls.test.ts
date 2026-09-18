import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import {
  cycleNumbered,
  initialControlState,
  sendSelectedKeys,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlMessage,
  type ControlState,
} from "../src/controls.ts";
import type { Tab, Workspace } from "../src/herdr.ts";
import type { Agent } from "../src/projection.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `p${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "w1",
  tabId: `t${index}`,
  machine: "local",
  cwd: undefined,
  title: undefined,
});

type Maps = Partial<Pick<Config, "commandKeys" | "layerKeys">>;
const reduce = (
  state: ControlState,
  message: ControlMessage,
  fleet: ReadonlyArray<Agent> = [],
  maps: Maps = {},
) => reduceControlMessage(state, message, fleet, { ...DEFAULT_CONFIG, ...maps });
const key = (
  state: ControlState,
  physicalKey: number,
  down: boolean,
  fleet: ReadonlyArray<Agent>,
  maps?: Maps,
) => reduce(state, { t: "key", k: physicalKey, down }, fleet, maps);
const press = (state: ControlState, physicalKey: number, fleet: ReadonlyArray<Agent>) =>
  key(state, physicalKey, true, fleet);

describe("reduceControlMessage", () => {
  test("uses keys 0-4 as Agent Slots and key 5 as the fixed Page Key", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    expect(press(initialControlState, 4, fleet)).toEqual({
      state: initialControlState,
      effects: [{ type: "focusAgent", paneId: "p5", machine: "local" }],
    });
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    expect(press(selected, 5, fleet)).toEqual({
      state: { ...selected, pageIndex: 1 },
      effects: [],
    });
  });

  test("maps command keys 6-11 to the default layout", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    expect(press(selected, 6, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["ctrl+c"] },
    ]);
    expect(press(selected, 7, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["esc"] },
    ]);
    expect(press(selected, 8, [agent(1)]).effects).toEqual([]);
    const aliasDown = press(selected, 9, [agent(1)]);
    expect(aliasDown.effects).toEqual([{ type: "hid", key: "RIGHT_GUI", down: true }]);
    expect(key(aliasDown.state, 9, false, [agent(1)]).effects).toEqual([
      { type: "hid", key: "RIGHT_GUI", down: false },
    ]);
    expect(press(selected, 10, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["enter"] },
    ]);
    expect(press(selected, 11, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["alt+enter"] },
    ]);
  });

  test("uses layered actions only while the layer key is held", () => {
    const fleet = [agent(1)];
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    const layerDown = key(selected, 8, true, fleet);
    expect(layerDown.effects).toEqual([]);
    expect(press(layerDown.state, 6, fleet).effects).toEqual([{ type: "newAgent" }]);

    const layerUp = key(layerDown.state, 8, false, fleet);
    expect(layerUp.effects).toEqual([]);
    expect(press(layerUp.state, 6, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["ctrl+c"] },
    ]);
  });

  test("releases the action resolved at key-down after the layer is released", () => {
    const fleet = [agent(1)];
    const layerKeys = {
      ...DEFAULT_CONFIG.layerKeys,
      "4": { type: "keyAlias" as const, key: "RIGHT_SHIFT" as const, color: "#ffff00" },
    };
    const layerDown = key(initialControlState, 8, true, fleet, { layerKeys });
    const aliasDown = key(layerDown.state, 9, true, fleet, { layerKeys });
    expect(aliasDown.effects).toEqual([{ type: "hid", key: "RIGHT_SHIFT", down: true }]);
    const layerUp = key(aliasDown.state, 8, false, fleet, { layerKeys });
    expect(key(layerUp.state, 9, false, fleet, { layerKeys }).effects).toEqual([
      { type: "hid", key: "RIGHT_SHIFT", down: false },
    ]);
  });

  test("forwards a configured Send Keys sequence unchanged", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    const commandKeys = {
      ...DEFAULT_CONFIG.commandKeys,
      "3": {
        type: "sendKeys" as const,
        keys: ["esc", "ctrl+c"] as const,
        color: "#ff8800",
      },
    };
    expect(key(selected, 8, true, [agent(1)], { commandKeys }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["esc", "ctrl+c"] },
    ]);
  });

  test("logs selected-agent actions without a selection instead of acting", () => {
    expect(press(initialControlState, 6, [agent(1)]).effects).toEqual([
      { type: "log", message: "ctrl+c ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 10, [agent(1)]).effects).toEqual([
      { type: "log", message: "enter ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 11, [agent(1)]).effects).toEqual([
      { type: "log", message: "alt+enter ignored: no agent selected" },
    ]);
  });

  test("flips encoder direction in Workspace mode", () => {
    expect(reduce(initialControlState, { t: "encoder", delta: -1 }).effects).toEqual([
      { type: "selectWorkspace", delta: 1 },
    ]);
  });

  test("toggles Tab mode, flips rotation, and exits on timeout or another press", () => {
    const entered = press(initialControlState, 12, []);
    expect(entered).toEqual({
      state: { ...initialControlState, encoderMode: "tabs" },
      effects: [{ type: "enterTabMode" }],
    });
    expect(reduce(entered.state, { t: "encoder", delta: 1 }).effects).toEqual([
      { type: "selectTab", delta: 1 },
    ]);
    expect(press(entered.state, 12, []).state.encoderMode).toBe("workspaces");
    expect(reduce(entered.state, { t: "encoderTimeout" }).state.encoderMode).toBe("workspaces");
  });

  test("rotates models in both directions while Layer is held, reverting on release", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    const layerDown = key(selected, 8, true, [agent(1)]).state;
    expect(reduce(layerDown, { t: "encoder", delta: 2 }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["ctrl+p", "ctrl+p"] },
    ]);
    expect(reduce(layerDown, { t: "encoder", delta: -1 }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["shift+ctrl+p"] },
    ]);
    const layerUp = key(layerDown, 8, false, [agent(1)]).state;
    expect(reduce(layerUp, { t: "encoder", delta: -1 }).effects).toEqual([
      { type: "selectWorkspace", delta: 1 },
    ]);
  });

  test("logs Model rotation without a selected agent", () => {
    const layerDown = key(initialControlState, 8, true, [agent(1)]).state;
    expect(reduce(layerDown, { t: "encoder", delta: 1 }).effects).toEqual([
      { type: "log", message: "ctrl+p ignored: no agent selected" },
    ]);
  });

  test("previews Targets with Layer + encoder press and commits on Layer release", () => {
    const config = {
      ...DEFAULT_CONFIG,
      targets: { local: { socket: "/local" }, remote: { ssh: "workbox" } },
    };
    const layerDown = key(initialControlState, 8, true, [agent(1)]).state;
    const preview = reduceControlMessage(
      layerDown,
      { t: "key", k: 12, down: true },
      [agent(1)],
      config,
      "local",
    );
    expect(preview.state.targetPreviewName).toBe("remote");
    expect(preview.effects).toEqual([]);
    // A second press wraps back to the active target.
    const wrapped = reduceControlMessage(
      preview.state,
      { t: "key", k: 12, down: true },
      [agent(1)],
      config,
      "local",
    );
    expect(wrapped.state.targetPreviewName).toBe("local");
    const committed = reduceControlMessage(
      preview.state,
      { t: "key", k: 8, down: false },
      [agent(1)],
      config,
      "local",
    );
    expect(committed.state.targetPreviewName).toBeUndefined();
    expect(committed.effects).toEqual([{ type: "switchTarget", name: "remote" }]);
  });

  test("keeps Layer + encoder press a no-op with one Target and release without press cancels", () => {
    const layerDown = key(initialControlState, 8, true, [agent(1)]).state;
    expect(press(layerDown, 12, [agent(1)])).toEqual({ state: layerDown, effects: [] });
    expect(key(layerDown, 8, false, [agent(1)])).toEqual({
      state: initialControlState,
      effects: [],
    });
  });

  test("maps the remaining layered keys to vertical arrows and Thinking cycle", () => {
    const fleet = [agent(1)];
    const selected = { ...initialControlState, selectedPaneId: "p1", selectedMachine: "local" };
    const layerDown = key(selected, 8, true, fleet).state;
    expect(press(layerDown, 9, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["down"] },
    ]);
    expect(press(layerDown, 10, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["up"] },
    ]);
    expect(press(layerDown, 11, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", machine: "local", keys: ["shift+tab"] },
    ]);
  });
});

test("reconcileControls derives selection from Herdr focus and clamps a removed page", () => {
  const state = { ...initialControlState, pageIndex: 1, selectedPaneId: "p6" };
  expect(reconcileControls(state, [agent(1)], "p1", "local")).toEqual({
    ...initialControlState,
    selectedPaneId: "p1",
    selectedMachine: "local",
  });
  expect(reconcileControls(state, [agent(1)], "not-an-agent", "local")).toEqual(
    initialControlState,
  );
  expect(reconcileControls(state, [agent(1)], undefined, "local")).toEqual(initialControlState);
});

test("cycleNumbered follows Herdr numbers with wraparound", () => {
  const workspaces: Workspace[] = [
    { id: "w2", number: 2, label: "two", focused: false, activeTabId: "t2" },
    { id: "w1", number: 1, label: "one", focused: true, activeTabId: "t1" },
  ];
  const tabs: Tab[] = [
    { id: "t2", number: 2, label: "two", focused: false },
    { id: "t1", number: 1, label: "one", focused: true },
  ];
  expect(cycleNumbered(workspaces, "w1", 1)?.id).toBe("w2");
  expect(cycleNumbered(tabs, "t1", -1)?.id).toBe("t2");
});

test("shellCommand preserves configured argv boundaries", () => {
  expect(shellCommand(["pi", "--name", "two words", "it's"])).toBe(
    "pi --name 'two words' 'it'\\''s'",
  );
});

describe("machine-scoped selection", () => {
  const on = (machine: string, paneId: string): Agent => ({
    ...agent(1),
    machine,
    paneId,
  });

  test("selects the focused pane only on the machine that reported the focus", () => {
    const fleet = [on("local", "w1:p1"), on("macbook", "w1:p1")];

    const local = reconcileControls(initialControlState, fleet, "w1:p1", "local");
    expect(local.selectedPaneId).toBe("w1:p1");
    expect(local.selectedMachine).toBe("local");

    const mac = reconcileControls(initialControlState, fleet, "w1:p1", "macbook");
    expect(mac.selectedMachine).toBe("macbook");
  });

  test("clears the selection when the focused machine has no such pane", () => {
    const fleet = [on("local", "w1:p1")];
    const state = reconcileControls(initialControlState, fleet, "w1:p1", "macbook");
    expect(state.selectedPaneId).toBeUndefined();
    expect(state.selectedMachine).toBeUndefined();
  });

  test("sendKeys targets the selected agent's own machine", () => {
    const fleet = [on("local", "w1:p1"), on("macbook", "w1:p1")];
    const selected = reconcileControls(initialControlState, fleet, "w1:p1", "macbook");
    const effects = sendSelectedKeys(selected, ["enter"]);
    expect(effects).toEqual([
      { type: "sendKeys", paneId: "w1:p1", machine: "macbook", keys: ["enter"] },
    ]);
  });
});

describe("plugin action Command Keys", () => {
  test("invoking a plugin action Command Key asks Herdr to run that action", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      commandKeys: {
        ...DEFAULT_CONFIG.commandKeys,
        "1": { type: "pluginAction", id: "worktrees.create", color: "#b8bb26" },
      },
    };

    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "key", k: 6, down: true },
      [agent(1)],
      config,
    );

    expect(effects).toEqual([{ type: "invokePluginAction", id: "worktrees.create" }]);
  });

  test("a plugin action does not need a selected agent, unlike sendKeys", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      commandKeys: {
        ...DEFAULT_CONFIG.commandKeys,
        "1": { type: "pluginAction", id: "tests.run", color: "#b8bb26" },
      },
    };

    const { effects } = reduceControlMessage(
      { ...initialControlState, selectedPaneId: undefined, selectedMachine: undefined },
      { t: "key", k: 6, down: true },
      [],
      config,
    );

    expect(effects).toEqual([{ type: "invokePluginAction", id: "tests.run" }]);
  });
});

describe("HID chord Command Keys", () => {
  const withKey = (action: Record<string, unknown>): Config => ({
    ...DEFAULT_CONFIG,
    commandKeys: { ...DEFAULT_CONFIG.commandKeys, "1": action as never },
  });

  test("types the chords at the focused window, not into an agent", () => {
    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "key", k: 6, down: true },
      [agent(1)],
      withKey({ type: "hidKeys", keys: ["ctrl+b", "w"], color: "#00ffff" }),
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["ctrl+b", "w"] }]);
  });

  test("needs no selected agent, since it targets the window manager's focus", () => {
    const { effects } = reduceControlMessage(
      { ...initialControlState, selectedPaneId: undefined, selectedMachine: undefined },
      { t: "key", k: 6, down: true },
      [],
      withKey({ type: "hidKeys", keys: ["ctrl+b"], color: "#00ffff" }),
    );
    expect(effects).toHaveLength(1);
  });

  test("optionally arms the encoder to finish the navigation", () => {
    const { state, effects } = reduceControlMessage(
      initialControlState,
      { t: "key", k: 6, down: true },
      [agent(1)],
      withKey({ type: "hidKeys", keys: ["ctrl+b", "w"], navigate: true, color: "#00ffff" }),
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["ctrl+b", "w"] }]);
    expect(state.encoderMode).toBe("navigate");
  });
});

describe("encoder navigate mode", () => {
  const navConfig: Config = {
    ...DEFAULT_CONFIG,
    commandKeys: {
      ...DEFAULT_CONFIG.commandKeys,
      "1": { type: "hidKeys", keys: ["ctrl+b", "w"], navigate: true, color: "#00ffff" } as never,
    },
  };
  const armed = () =>
    reduceControlMessage(initialControlState, { t: "key", k: 6, down: true }, [agent(1)], navConfig)
      .state;

  test("rotating types arrow keys at the picker instead of moving Herdr workspaces", () => {
    const { effects } = reduceControlMessage(
      armed(),
      { t: "encoder", delta: 1 },
      [agent(1)],
      navConfig,
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["down"] }]);

    const up = reduceControlMessage(armed(), { t: "encoder", delta: -1 }, [agent(1)], navConfig);
    expect(up.effects).toEqual([{ type: "hidKeys", keys: ["up"] }]);
  });

  test("pressing confirms the picker and leaves navigate mode", () => {
    const { state, effects } = reduceControlMessage(
      armed(),
      { t: "key", k: 12, down: true },
      [agent(1)],
      navConfig,
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["enter"] }]);
    expect(state.encoderMode).toBe("workspaces");
  });

  test("the encoder timeout cancels the picker rather than leaving it open", () => {
    const { state, effects } = reduceControlMessage(
      armed(),
      { t: "encoderTimeout" },
      [agent(1)],
      navConfig,
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["esc"] }]);
    expect(state.encoderMode).toBe("workspaces");
  });
});

describe("syncing the local view when the Target switches", () => {
  const syncing: Config = {
    ...DEFAULT_CONFIG,
    targets: { local: { socket: "/tmp/a.sock" }, macbook: { ssh: "mac" } },
    syncLocalViewKeys: ["ctrl+b", "w"],
  };

  const previewThenRelease = (config: Config) => {
    // Hold LAYER, press the encoder to preview, release LAYER to commit.
    const held = reduceControlMessage(
      initialControlState,
      { t: "key", k: 8, down: true },
      [agent(1)],
      config,
    ).state;
    const previewed = reduceControlMessage(
      held,
      { t: "key", k: 12, down: true },
      [agent(1)],
      config,
    ).state;
    return reduceControlMessage(previewed, { t: "key", k: 8, down: false }, [agent(1)], config);
  };

  test("also opens the local picker so the view follows the Deck", () => {
    const { effects } = previewThenRelease(syncing);
    expect(effects).toEqual([
      { type: "switchTarget", name: "macbook" },
      { type: "hidKeys", keys: ["ctrl+b", "w"] },
    ]);
  });

  test("arms the encoder so the picker it just opened can be walked", () => {
    // Without this the encoder would still be driving the newly selected
    // machine's workspaces while a picker sits open on the local screen.
    const { state } = previewThenRelease(syncing);
    expect(state.encoderMode).toBe("navigate");
  });

  test("leaves the encoder alone when the user has not opted in", () => {
    const { state } = previewThenRelease({ ...syncing, syncLocalViewKeys: undefined });
    expect(state.encoderMode).toBe("workspaces");
  });

  test("sends nothing extra when the user has not opted in", () => {
    const { effects } = previewThenRelease({
      ...syncing,
      syncLocalViewKeys: undefined,
    });
    expect(effects).toEqual([{ type: "switchTarget", name: "macbook" }]);
  });
});

describe("the navigate key is a toggle", () => {
  const navConfig: Config = {
    ...DEFAULT_CONFIG,
    commandKeys: {
      ...DEFAULT_CONFIG.commandKeys,
      "1": { type: "hidKeys", keys: ["ctrl+b", "w"], navigate: true, color: "#427b58" } as never,
    },
  };
  const tapNavigateKey = (state: ControlState) =>
    reduceControlMessage(state, { t: "key", k: 6, down: true }, [agent(1)], navConfig);

  test("a second press dismisses the surface instead of retyping the opening chord", () => {
    const opened = tapNavigateKey(initialControlState).state;
    expect(opened.encoderMode).toBe("navigate");

    // Retyping ctrl+b at an open picker dismisses it and leaks the `w` into
    // the pane as a literal character, which is what pressing twice did.
    const closed = tapNavigateKey(opened);
    expect(closed.effects).toEqual([{ type: "hidKeys", keys: ["esc"] }]);
    expect(closed.state.encoderMode).toBe("workspaces");
  });

  test("a third press opens it again", () => {
    const opened = tapNavigateKey(initialControlState).state;
    const closed = tapNavigateKey(opened).state;
    const reopened = tapNavigateKey(closed);
    expect(reopened.effects).toEqual([{ type: "hidKeys", keys: ["ctrl+b", "w"] }]);
    expect(reopened.state.encoderMode).toBe("navigate");
  });
});

describe("driving the local client's workspace list with chords", () => {
  const chorded: Config = {
    ...DEFAULT_CONFIG,
    workspaceChords: { previous: ["ctrl+alt+k"], next: ["ctrl+alt+j"] },
  };

  test("rotating types the chords instead of moving the server's focus", () => {
    // selectWorkspace moves focus on whichever machine the Deck is aimed at,
    // which is not the machine the user is looking at. A chord goes to the
    // client, whose workspace list spans every connected machine.
    const forward = reduceControlMessage(
      initialControlState,
      { t: "encoder", delta: 1 },
      [agent(1)],
      chorded,
    );
    expect(forward.effects).toEqual([{ type: "hidKeys", keys: ["ctrl+alt+j"] }]);

    const back = reduceControlMessage(
      initialControlState,
      { t: "encoder", delta: -1 },
      [agent(1)],
      chorded,
    );
    expect(back.effects).toEqual([{ type: "hidKeys", keys: ["ctrl+alt+k"] }]);
  });

  test("repeats the chord once per detent so a fast spin lands them all", () => {
    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "encoder", delta: 3 },
      [agent(1)],
      chorded,
    );
    expect(effects).toEqual([
      { type: "hidKeys", keys: ["ctrl+alt+j", "ctrl+alt+j", "ctrl+alt+j"] },
    ]);
  });

  test("falls back to moving the server's focus when no chords are configured", () => {
    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "encoder", delta: 1 },
      [agent(1)],
      DEFAULT_CONFIG,
    );
    expect(effects).toEqual([{ type: "selectWorkspace", delta: -1 }]);
  });

  test("tabs mode is untouched: tabs are per-machine, so the API is right there", () => {
    const { effects } = reduceControlMessage(
      { ...initialControlState, encoderMode: "tabs" },
      { t: "encoder", delta: 1 },
      [agent(1)],
      chorded,
    );
    expect(effects).toEqual([{ type: "selectTab", delta: 1 }]);
  });
});

describe("focusing an agent by chord", () => {
  const chorded: Config = {
    ...DEFAULT_CONFIG,
    // Herdr's indexed shortcuts run 1-9, so a real config lists nine.
    agentChords: Array.from({ length: 9 }, (_, i) => `ctrl+super+${i + 1}`) as [
      string,
      ...string[],
    ],
  };
  const fleet = Array.from({ length: 8 }, (_, i) => agent(i));

  test("a slot types its chord instead of focusing on the server", () => {
    // agent.focus moves focus on the agent's own server, which is invisible
    // unless the client happens to be displaying that machine. The chord drives
    // the client's agent panel, which spans machines and moves the view.
    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "key", k: 2, down: true },
      fleet,
      chorded,
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["ctrl+super+3"] }]);
  });

  test("page two continues the numbering, since the panel index is absolute", () => {
    const { effects } = reduceControlMessage(
      { ...initialControlState, pageIndex: 1 },
      { t: "key", k: 0, down: true },
      fleet,
      chorded,
    );
    expect(effects).toEqual([{ type: "hidKeys", keys: ["ctrl+super+6"] }]);
  });

  test("falls back to the server call past the end of the configured chords", () => {
    const { effects } = reduceControlMessage(
      { ...initialControlState, pageIndex: 1 },
      { t: "key", k: 2, down: true },
      fleet,
      { ...chorded, agentChords: ["ctrl+super+1"] },
    );
    expect(effects).toEqual([{ type: "focusAgent", paneId: "p7", machine: "local" }]);
  });

  test("still focuses on the server when no chords are configured", () => {
    const { effects } = reduceControlMessage(
      initialControlState,
      { t: "key", k: 0, down: true },
      fleet,
      DEFAULT_CONFIG,
    );
    expect(effects).toEqual([{ type: "focusAgent", paneId: "p0", machine: "local" }]);
  });
});
