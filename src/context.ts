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

/**
 * Drop one leading activity or spinner glyph and the whitespace after it,
 * matching what Herdr's own `terminal_title_stripped` token does. Metadata
 * gets no such treatment, and an animating spinner would make the row jitter.
 *
 * The test is "a leading symbol followed by space", which keeps titles that
 * legitimately start with a digit or letter intact.
 */
const stripActivityGlyph = (title: string): string =>
  title.replace(/^[^\p{L}\p{N}\s]\s+/u, "").trim();

export function workspaceContext(
  fleet: ReadonlyArray<Agent>,
): ReadonlyMap<string, WorkspaceTokens> {
  const chosen = new Map<string, { agent: Agent; title: string }>();
  for (const agent of fleet) {
    // An agent with no title cannot describe the workspace, and reporting an
    // empty token would blank the row rather than leaving it alone. A title
    // that is only a spinner glyph reduces to nothing and counts as no title.
    if (!agent.title) continue;
    const title = stripActivityGlyph(agent.title);
    if (!title) continue;
    const previous = chosen.get(agent.workspaceId);
    if (!previous || ATTENTION[agent.state] > ATTENTION[previous.agent.state]) {
      chosen.set(agent.workspaceId, { agent, title });
    }
  }
  return new Map(
    [...chosen].map(([workspaceId, { agent, title }]) => [
      workspaceId,
      { title, agent: agent.name },
    ]),
  );
}
