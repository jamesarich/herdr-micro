import type { ControlState } from "./controls.ts";
import type { Tab, Workspace } from "./herdr.ts";
import type { AgentStateSince, ScreensaverState } from "./presentation.ts";
import type { Agent } from "./projection.ts";
import type { PiStatus } from "./render.ts";

export interface TargetSessionState {
  fleet: ReadonlyArray<Agent>;
  controls: ControlState;
  workspaces: ReadonlyArray<Workspace>;
  tabs: ReadonlyArray<Tab>;
  selectedDetail: { readonly paneId: string; readonly value: PiStatus | undefined } | undefined;
  sleeping: boolean;
  stateSince: Map<string, AgentStateSince>;
  screensaverState: ScreensaverState;
}

/**
 * Clear the view that belongs to one Target: its workspaces, its tabs and the
 * detail being polled from it.
 *
 * Deliberately narrow. The Fleet, its state timestamps, the screensaver and the
 * controls all span every watched machine now, so wiping them on a Target
 * switch would blank slots whose agents are still running elsewhere.
 */
export function resetTargetViewState(state: TargetSessionState): void {
  state.workspaces = [];
  state.tabs = [];
  state.selectedDetail = undefined;
}
