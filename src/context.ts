import type { Agent, AgentState } from "./projection.ts";

/**
 * Context the Deck's Host pushes onto Herdr workspaces, so the Spaces sidebar
 * can say what a workspace is doing.
 *
 * The Spaces row layout has a much smaller token set than the Agents one — no
 * `agent`, no `terminal_title` — so the only way to get that information up
 * there is custom metadata under a `$name` token.
 */
export type WorkspaceTokens = { readonly title: string; readonly agent: string };

// Highest wins: a workspace collapses to one line, so it should carry the agent
// the user would want to look at rather than whichever happened to sort first.
const ATTENTION: Record<AgentState, number> = {
  idle: 0,
  unknown: 1,
  working: 2,
  done: 3,
  blocked: 4,
};

export function workspaceContext(
  fleet: ReadonlyArray<Agent>,
): ReadonlyMap<string, WorkspaceTokens> {
  const chosen = new Map<string, Agent>();
  for (const agent of fleet) {
    // An agent with no title cannot describe the workspace, and reporting an
    // empty token would blank the row rather than leaving it alone.
    if (!agent.title) continue;
    const previous = chosen.get(agent.workspaceId);
    if (!previous || ATTENTION[agent.state] > ATTENTION[previous.state]) {
      chosen.set(agent.workspaceId, agent);
    }
  }
  return new Map(
    [...chosen].map(([workspaceId, agent]) => [
      workspaceId,
      { title: agent.title as string, agent: agent.name },
    ]),
  );
}
