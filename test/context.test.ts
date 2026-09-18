import { describe, expect, test } from "bun:test";

import { workspaceContext } from "../src/context.ts";
import type { Agent } from "../src/projection.ts";

const agent = (
  workspaceId: string,
  state: Agent["state"],
  title: string | undefined,
  name = "claude",
): Agent => ({
  paneId: `${workspaceId}:p1`,
  name,
  state,
  workspaceId,
  tabId: "t",
  machine: "local",
  cwd: undefined,
  title,
});

describe("workspaceContext", () => {
  test("carries each workspace's agent title and kind", () => {
    const ctx = workspaceContext([
      agent("w16", "working", "bindery audiobook fetch"),
      agent("w19", "idle", "check github discord updates"),
    ]);
    expect(ctx.get("w16")).toEqual({ title: "bindery audiobook fetch", agent: "claude" });
    expect(ctx.get("w19")).toEqual({ title: "check github discord updates", agent: "claude" });
  });

  test("a workspace with several agents shows the one most wanting attention", () => {
    // The Spaces list rolls a whole workspace into one line, so it should carry
    // the agent you would want to look at rather than whichever sorted first.
    const ctx = workspaceContext([
      agent("w1", "idle", "quiet one"),
      agent("w1", "blocked", "needs an answer"),
      agent("w1", "working", "busy one"),
    ]);
    expect(ctx.get("w1")?.title).toBe("needs an answer");
  });

  test("omits a workspace whose agent reports no title", () => {
    // Reporting an empty token would blank the row rather than leave it alone.
    const ctx = workspaceContext([agent("w2", "idle", undefined)]);
    expect(ctx.has("w2")).toBe(false);
  });

  test("still reports the agent kind when only some agents have titles", () => {
    const ctx = workspaceContext([
      agent("w3", "idle", undefined, "codex"),
      agent("w3", "working", "compiling", "codex"),
    ]);
    expect(ctx.get("w3")).toEqual({ title: "compiling", agent: "codex" });
  });
});
