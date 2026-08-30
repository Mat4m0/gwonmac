/**
 * The stable Squirrel.Windows identity shared by installer shortcuts and the
 * running process. Windows groups launcher and game previews under this one
 * identity; no per-window AppUserModelID creates a second taskbar product.
 */
import {
  DISTRIBUTION_CHANNEL_CONFIG,
  DISTRIBUTION_CHANNELS,
  type DistributionChannel,
} from "../shared/distribution-channel.js";

export function windowsSquirrelPackageId(
  channel: DistributionChannel,
): string {
  if (channel === "release") return "GuildWarsReforged";
  if (channel === "preview") return "GuildWarsReforgedPreview";
  return "GuildWarsReforgedDev";
}

export function windowsAppUserModelId(productName: string): string {
  const channel = DISTRIBUTION_CHANNELS.find(
    (candidate) => DISTRIBUTION_CHANNEL_CONFIG[candidate].productName === productName,
  );
  if (!channel) throw new Error(`unknown Windows product identity: ${productName}`);
  return `com.squirrel.${windowsSquirrelPackageId(channel)}.${productName}`;
}
