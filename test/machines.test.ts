import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import { machineTargets, mergeMachineTargets, parseMachineList } from "../src/machines.ts";

// Real `herdr machine list` output: id, label, ssh target, session, enabled state,
// tab separated, one machine per line.
const LIST = [
  "ad3d314a910fc8f4daf1a443a4c77b4c\tmacbook\tjames@Jamess-MacBook-Air.local\tdefault\tenabled",
  "bb11223344556677889900aabbccddee\tworkbox\tjames@workbox.local\tdefault\tdisabled",
].join("\n");

describe("Herdr machines", () => {
  test("parses the tab separated machine list", () => {
    expect(parseMachineList(LIST)).toEqual([
      {
        id: "ad3d314a910fc8f4daf1a443a4c77b4c",
        label: "macbook",
        ssh: "james@Jamess-MacBook-Air.local",
        session: "default",
        enabled: true,
      },
      {
        id: "bb11223344556677889900aabbccddee",
        label: "workbox",
        ssh: "james@workbox.local",
        session: "default",
        enabled: false,
      },
    ]);
  });

  test("ignores blank lines and malformed rows rather than throwing", () => {
    expect(parseMachineList("\n\nnot-a-machine-row\n")).toEqual([]);
  });

  test("projects only enabled machines onto Targets, keyed by label", () => {
    expect(machineTargets(parseMachineList(LIST))).toEqual({
      macbook: { ssh: "james@Jamess-MacBook-Air.local" },
    });
  });
});

describe("merging machines into configured Targets", () => {
  const machines = parseMachineList(LIST);

  test("adds enabled machines alongside the configured Targets", () => {
    const merged = mergeMachineTargets(DEFAULT_CONFIG, machines);
    expect(merged.targets).toEqual({
      local: { socket: "~/.config/herdr/herdr.sock" },
      macbook: { ssh: "james@Jamess-MacBook-Air.local" },
    });
    expect(merged.defaultTarget).toBe("local");
  });

  test("an explicitly configured Target wins over a machine of the same name", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      targets: { macbook: { ssh: "pinned-host" } },
      defaultTarget: "macbook",
    };
    expect(mergeMachineTargets(config, machines).targets).toEqual({
      macbook: { ssh: "pinned-host" },
    });
  });

  test("leaves the config untouched when no machines are enabled", () => {
    const disabledOnly = machines.filter(({ enabled }) => !enabled);
    expect(mergeMachineTargets(DEFAULT_CONFIG, disabledOnly)).toEqual(DEFAULT_CONFIG);
  });
});
