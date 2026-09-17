import { describe, expect, test } from "bun:test";

import {
  initialScreensaverState,
  reconcileScreensaver,
  syncStateSince,
} from "../src/presentation.ts";
import { agentKey, type Agent } from "../src/projection.ts";

const agent = (paneId: string, state: Agent["state"]): Agent => ({
  paneId,
  name: paneId,
  state,
  workspaceId: "workspace",
  tabId: "tab",
  machine: "local",
  cwd: undefined,
  title: undefined,
});

describe("syncStateSince", () => {
  test("preserves timestamps across unchanged snapshots and updates changed states", () => {
    const stateSince = new Map<string, { state: Agent["state"]; since: number }>();
    syncStateSince(stateSince, [agent("p1", "idle"), agent("p2", "working")], 100);
    syncStateSince(stateSince, [agent("p1", "idle"), agent("p2", "done")], 200);

    expect([...stateSince]).toEqual([
      [agentKey(agent("p1", "idle")), { state: "idle", since: 100 }],
      [agentKey(agent("p2", "done")), { state: "done", since: 200 }],
    ]);

    syncStateSince(stateSince, [agent("p1", "idle")], 300);
    expect([...stateSince]).toEqual([
      [agentKey(agent("p1", "idle")), { state: "idle", since: 100 }],
    ]);
  });
});

describe("reconcileScreensaver", () => {
  test("sleeps only after an all-idle window and wakes on fleet or Deck activity", () => {
    const timeout = 10_000;
    const idle = [agent("p1", "idle")];
    const working = [agent("p1", "working")];

    const idleSignature = `${agentKey(agent("p1", "idle"))}:idle`;
    const workingSignature = `${agentKey(agent("p1", "working"))}:working`;

    const armed = reconcileScreensaver(initialScreensaverState, idle, 100, timeout);
    expect(armed).toEqual({ fleetSignature: idleSignature, idleSince: 100, sleeping: false });
    expect(reconcileScreensaver(armed, idle, 10_099, timeout).sleeping).toBe(false);

    const sleeping = reconcileScreensaver(armed, idle, 10_100, timeout);
    expect(sleeping.sleeping).toBe(true);
    expect(reconcileScreensaver(sleeping, idle, 11_000, timeout, true)).toEqual({
      fleetSignature: idleSignature,
      idleSince: 11_000,
      sleeping: false,
    });
    expect(reconcileScreensaver(sleeping, working, 11_000, timeout)).toEqual({
      fleetSignature: workingSignature,
      idleSince: undefined,
      sleeping: false,
    });
  });

  test("treats an empty Fleet as idle", () => {
    expect(reconcileScreensaver(initialScreensaverState, [], 100, 10_000)).toEqual({
      fleetSignature: "",
      idleSince: 100,
      sleeping: false,
    });
  });
});

// Herdr scopes IDs per server: "Two machines may both contain `w1:p1`".
// Anything keyed on a bare paneId therefore merges two machines' agents once
// more than one machine is live at a time.
const onMachine = (machine: string, paneId: string, state: Agent["state"]): Agent => ({
  ...agent(paneId, state),
  machine,
});

describe("machine-scoped agent identity", () => {
  test("distinguishes the same paneId on two different machines", () => {
    expect(agentKey(onMachine("local", "w1:p1", "idle"))).not.toBe(
      agentKey(onMachine("macbook", "w1:p1", "idle")),
    );
  });

  test("tracks state for colliding paneIds on different machines separately", () => {
    const stateSince = new Map<string, { state: Agent["state"]; since: number }>();
    syncStateSince(
      stateSince,
      [onMachine("local", "w1:p1", "idle"), onMachine("macbook", "w1:p1", "working")],
      100,
    );
    expect(stateSince.size).toBe(2);

    // Only the Mac's agent changes; the local agent must keep its timestamp.
    syncStateSince(
      stateSince,
      [onMachine("local", "w1:p1", "idle"), onMachine("macbook", "w1:p1", "blocked")],
      200,
    );
    expect(stateSince.get(agentKey(onMachine("local", "w1:p1", "idle")))).toEqual({
      state: "idle",
      since: 100,
    });
    expect(stateSince.get(agentKey(onMachine("macbook", "w1:p1", "blocked")))).toEqual({
      state: "blocked",
      since: 200,
    });
  });

  test("a fleet signature changes when only the machine differs", () => {
    const local = reconcileScreensaver(
      initialScreensaverState,
      [onMachine("local", "w1:p1", "idle")],
      100,
      10_000,
    );
    const mac = reconcileScreensaver(
      initialScreensaverState,
      [onMachine("macbook", "w1:p1", "idle")],
      100,
      10_000,
    );
    expect(local.fleetSignature).not.toBe(mac.fleetSignature);
  });
});
