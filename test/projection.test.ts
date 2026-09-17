import { describe, expect, test } from "bun:test";

import { mergeFleets, projectFleet, type Agent } from "../src/projection.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `pane-${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "workspace",
  tabId: `tab-${index}`,
  machine: "local",
  cwd: undefined,
  title: undefined,
});

describe("projectFleet", () => {
  test("projects an empty fleet as one empty page", () => {
    expect(projectFleet([], 0)).toEqual({
      pageIndex: 0,
      pageCount: 1,
      slots: [],
      offPageState: undefined,
    });
  });

  test("projects exactly five agents in Herdr order", () => {
    const fleet = Array.from({ length: 5 }, (_, index) => agent(index + 1));
    const projection = projectFleet(fleet, 0);
    expect(projection.slots.map(({ paneId }) => paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
    ]);
    expect(projection.pageCount).toBe(1);
    expect(projection.offPageState).toBeUndefined();
  });

  test("pages six agents and prioritizes off-page state", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    fleet[5] = agent(6, "blocked");

    const first = projectFleet(fleet, 0);
    expect(first.slots).toHaveLength(5);
    expect(first.pageCount).toBe(2);
    expect(first.offPageState).toBe("blocked");

    const second = projectFleet(fleet, 1);
    expect(second.slots.map(({ paneId }) => paneId)).toEqual(["pane-6"]);
    expect(second.offPageState).toBe("idle");
  });

  test("shifts following agents left when an agent exits mid-page", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    const withoutThird = fleet.filter(({ paneId }) => paneId !== "pane-3");

    expect(projectFleet(withoutThird, 0).slots.map(({ paneId }) => paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-4",
      "pane-5",
      "pane-6",
    ]);
  });

  test("clamps the current page after the last page disappears", () => {
    const fleet = Array.from({ length: 5 }, (_, index) => agent(index + 1));
    expect(projectFleet(fleet, 1).pageIndex).toBe(0);
  });
});

describe("mergeFleets", () => {
  const on = (machine: string, id: number): Agent => ({ ...agent(id), machine });

  test("groups agents by machine in the given order, preserving Herdr order within each", () => {
    const merged = mergeFleets(
      ["local", "macbook"],
      new Map([
        ["macbook", [on("macbook", 1), on("macbook", 2)]],
        ["local", [on("local", 9)]],
      ]),
    );
    expect(merged.map(({ machine, paneId }) => `${machine}/${paneId}`)).toEqual([
      "local/pane-9",
      "macbook/pane-1",
      "macbook/pane-2",
    ]);
  });

  test("skips machines that have not reported a fleet yet", () => {
    const merged = mergeFleets(["local", "macbook"], new Map([["local", [on("local", 1)]]]));
    expect(merged).toEqual([on("local", 1)]);
  });

  test("ignores fleets from machines outside the order", () => {
    const merged = mergeFleets(["local"], new Map([["ghost", [on("ghost", 1)]]]));
    expect(merged).toEqual([]);
  });
});
