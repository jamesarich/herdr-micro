import { expect, test } from "bun:test";

import { initialControlState } from "../src/controls.ts";
import { initialScreensaverState } from "../src/presentation.ts";
import { resetTargetViewState, type TargetSessionState } from "../src/target-state.ts";

const dirtyState = (): TargetSessionState => ({
  fleet: [
    {
      paneId: "same-id",
      workspaceId: "w",
      tabId: "t",
      name: "agent",
      state: "working",
      machine: "local",
    },
  ],
  controls: {
    pageIndex: 2,
    selectedPaneId: "same-id",
    workspaceId: "w",
    encoderMode: "tabs",
    tabId: "t",
    pressedCommandActions: { "1": { type: "newAgent", color: "#ffffff" } },
    targetPreviewName: "remote",
  },
  workspaces: [{ id: "w", number: 1, label: "work", focused: true, activeTabId: "t" }],
  tabs: [{ id: "t", number: 1, label: "tab", focused: true }],
  selectedDetail: { paneId: "same-id", value: undefined },
  sleeping: true,
  stateSince: new Map([["same-id", { state: "working", since: 1 }]]),
  screensaverState: { fleetSignature: "same-id:working", idleSince: 1, sleeping: true },
});

test("Target switch clears the Target-scoped view in one step", () => {
  const state = dirtyState();
  resetTargetViewState(state);

  expect(state.workspaces).toEqual([]);
  expect(state.tabs).toEqual([]);
  expect(state.selectedDetail).toBeUndefined();
});

test("Target switch keeps Fleet state, which spans every machine", () => {
  const state = dirtyState();
  resetTargetViewState(state);

  // Agents on the machines we did not switch away from are still running, so
  // dropping them here would blank slots that are legitimately lit.
  expect(state.fleet).toHaveLength(1);
  expect(state.stateSince.size).toBe(1);
  expect(state.screensaverState).not.toBe(initialScreensaverState);
  expect(state.controls).not.toBe(initialControlState);
});
