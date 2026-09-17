import { Effect } from "effect";

import type { Config, TargetConfig } from "./config.ts";

/**
 * A machine saved in Herdr itself (`herdr machine add`), as opposed to a Target
 * configured in herdr-micro. Herdr prepares the remote Herdr server when the
 * machine is added, so a saved machine is known-good in a way a bare SSH host
 * string in our own config is not.
 */
export interface HerdrMachine {
  readonly id: string;
  readonly label: string;
  readonly ssh: string;
  readonly session: string;
  readonly enabled: boolean;
}

// `herdr machine list` prints one machine per line as
// id \t label \t ssh \t session \t (enabled|disabled).
const MACHINE_FIELDS = 5;

export const parseMachineList = (stdout: string): ReadonlyArray<HerdrMachine> => {
  const machines: HerdrMachine[] = [];
  for (const line of stdout.split("\n")) {
    const fields = line.split("\t");
    if (fields.length !== MACHINE_FIELDS) continue;
    const [id, label, ssh, session, enabled] = fields as [string, string, string, string, string];
    machines.push({ id, label, ssh, session, enabled: enabled === "enabled" });
  }
  return machines;
};

/**
 * Enabled machines projected onto Targets, keyed by the label the user already
 * chose in Herdr. Disabled machines are omitted: Herdr's enable/disable is the
 * user saying which machines they currently care about.
 */
export const machineTargets = (
  machines: ReadonlyArray<HerdrMachine>,
): Record<string, TargetConfig> =>
  Object.fromEntries(
    machines.filter(({ enabled }) => enabled).map(({ label, ssh }) => [label, { ssh }]),
  );

/**
 * Fold Herdr's saved machines into the configured Targets.
 *
 * A Target the user configured explicitly always wins over a machine of the
 * same name: herdr-micro's own config is the more specific statement of intent,
 * and silently overriding it would make a pinned host impossible to express.
 * When nothing is added the original config is returned unchanged, so callers
 * can treat machine discovery as purely additive.
 */
export const mergeMachineTargets = (
  config: Config,
  machines: ReadonlyArray<HerdrMachine>,
): Config => {
  const discovered = Object.entries(machineTargets(machines)).filter(
    ([label]) => !(label in config.targets),
  );
  if (discovered.length === 0) return config;
  return {
    ...config,
    targets: { ...config.targets, ...Object.fromEntries(discovered) },
  };
};

/**
 * Ask Herdr for its saved machines.
 *
 * Never fails: an older Herdr without `machine`, or a Herdr that is not running,
 * simply means no machines to add. Machine discovery is an enhancement over the
 * configured Targets, so it must not be able to stop the Host from starting.
 */
export const discoverMachines = Effect.sync((): ReadonlyArray<HerdrMachine> => {
  try {
    const result = Bun.spawnSync(["herdr", "machine", "list"], { timeout: 5_000 });
    if (!result.success) return [];
    return parseMachineList(result.stdout.toString());
  } catch {
    return [];
  }
});
