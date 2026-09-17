export const AGENT_STATES = ["idle", "working", "blocked", "done", "unknown"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export interface Agent {
  readonly paneId: string;
  readonly name: string;
  readonly state: AgentState;
  readonly workspaceId: string;
  readonly tabId: string;
  /** Which machine's Herdr server this agent lives on. */
  readonly machine: string;
}

/**
 * Herdr scopes workspace, tab and pane IDs to a single server, so two machines
 * may both hold `w1:p1`. Anything that keys or compares agents must therefore
 * qualify the pane with its machine. NUL cannot appear in either part, so it is
 * an unambiguous separator.
 */
export const agentKey = ({ machine, paneId }: Pick<Agent, "machine" | "paneId">): string =>
  `${machine}\u0000${paneId}`;

interface FleetProjection {
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly slots: ReadonlyArray<Agent>;
  readonly offPageState: AgentState | undefined;
}

export const PAGE_SIZE = 5;
const PRIORITY: Record<AgentState, number> = {
  idle: 0,
  unknown: 1,
  working: 2,
  done: 3,
  blocked: 4,
};

export function projectFleet(
  fleet: ReadonlyArray<Agent>,
  requestedPageIndex: number,
): FleetProjection {
  const pageCount = Math.max(1, Math.ceil(fleet.length / PAGE_SIZE));
  const pageIndex = Math.max(0, Math.min(Math.trunc(requestedPageIndex), pageCount - 1));
  const start = pageIndex * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const offPage = fleet.filter((_, index) => index < start || index >= end);

  return {
    pageIndex,
    pageCount,
    slots: fleet.slice(start, end),
    offPageState: offPage.reduce<AgentState | undefined>(
      (highest, { state }) =>
        highest === undefined || PRIORITY[state] > PRIORITY[highest] ? state : highest,
      undefined,
    ),
  };
}
