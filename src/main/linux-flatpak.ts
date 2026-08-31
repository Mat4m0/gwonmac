/**
 * Read the identity that Flatpak mounts at `/.flatpak-info`.
 *
 * The distribution marker inside the Electron package is only configuration.
 * The read-only Flatpak metadata is the installed package trust boundary.
 */
export function flatpakApplicationId(info: string): string | null {
  let section = "";
  let applicationId: string | null = null;

  for (const rawLine of info.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    if (section !== "Application") continue;
    const separator = line.indexOf("=");
    if (separator === -1 || line.slice(0, separator) !== "name") continue;
    if (applicationId !== null) return null;
    const value = line.slice(separator + 1);
    if (!/^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)+$/u.test(value)) return null;
    applicationId = value;
  }

  return applicationId;
}

export function trustedFlatpakIdentity(input: {
  readonly info: string;
  readonly environmentId: string | undefined;
  readonly expectedId: string;
}): boolean {
  return input.environmentId === input.expectedId
    && flatpakApplicationId(input.info) === input.expectedId;
}
