import { agentKey, type Agent } from "./projection.ts";

export interface AgentStateSince {
  readonly state: Agent["state"];
  readonly since: number;
}

export const syncStateSince = (
  stateSince: Map<string, AgentStateSince>,
  fleet: ReadonlyArray<Agent>,
  now: number,
): void => {
  const keys = new Set(fleet.map(agentKey));
  for (const agent of fleet) {
    const key = agentKey(agent);
    const previous = stateSince.get(key);
    if (!previous || previous.state !== agent.state) {
      stateSince.set(key, { state: agent.state, since: now });
    }
  }
  for (const key of stateSince.keys()) {
    if (!keys.has(key)) stateSince.delete(key);
  }
};

export interface ScreensaverState {
  readonly fleetSignature: string | undefined;
  readonly idleSince: number | undefined;
  readonly sleeping: boolean;
}

export const initialScreensaverState: ScreensaverState = {
  fleetSignature: undefined,
  idleSince: undefined,
  sleeping: false,
};

export const reconcileScreensaver = (
  previous: ScreensaverState,
  fleet: ReadonlyArray<Agent>,
  now: number,
  timeoutMs: number,
  activity = false,
): ScreensaverState => {
  const fleetSignature = fleet.map((agent) => `${agentKey(agent)}:${agent.state}`).join("|");
  if (fleet.some(({ state }) => state !== "idle")) {
    return { fleetSignature, idleSince: undefined, sleeping: false };
  }
  if (activity || fleetSignature !== previous.fleetSignature) {
    return { fleetSignature, idleSince: now, sleeping: false };
  }
  const idleSince = previous.idleSince ?? now;
  return {
    fleetSignature,
    idleSince,
    sleeping: now - idleSince >= timeoutMs,
  };
};
