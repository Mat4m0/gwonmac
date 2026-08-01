/**
 * What a game connection is allowed to reach: three ports, public IPv4 unicast,
 * and the ArenaNet domain suffixes.
 *
 * Every rule here is a refusal. Loopback, link-local, RFC1918, carrier-grade
 * NAT, this-network and multicast are all excluded, so a hostile or confused
 * destination cannot turn the main process into a scanner of the player's own
 * network. Suffix matching is anchored on a dot, so `notarenanetworks.com` is
 * not a match for `arenanetworks.com`.
 *
 * These are the game-infrastructure rules. Web services are allowlisted
 * separately in `proxy-routes.ts`; the two lists grant different things and
 * must not be merged into one.
 */
import { AllowlistError, ValidationError } from "../../shared/errors.js";

export const ALLOWED_PORTS = new Set([6112, 80, 443]);

export const ALLOWED_DOMAINS = ["arenanetworks.com", "guildwars.com"] as const;

export function isAllowedPort(port: number): boolean {
  return ALLOWED_PORTS.has(port);
}

export function allowedName(
  host: string,
  domains: readonly string[] = ALLOWED_DOMAINS,
): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return domains.some((d) => h === d || h.endsWith("." + d));
}

export function isPublicIpv4(ip: string): boolean {
  const p = ip.split(".");
  if (p.length !== 4) return false;
  const nums = p.map((x) => Number(x));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

export function isPublicIp(ip: string): boolean {
  return isPublicIpv4(ip);
}

export function assertPublicDestination(host: string, port: number): void {
  if (!isAllowedPort(port)) {
    throw new AllowlistError(`port ${port} is not allowed`);
  }
  if (!isPublicIp(host)) {
    throw new AllowlistError(`address ${host} is not public unicast`);
  }
}

export interface Destination {
  host: string;
  port: number;
}

/** The official client currently resolves and connects through IPv4 only. */
export function parseDestination(dest: string): Destination {
  if (typeof dest !== "string" || !dest) {
    throw new ValidationError(`malformed dest ${JSON.stringify(dest)}`);
  }
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/.exec(dest);
  if (v4) {
    const port = Number(v4[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError(`malformed dest ${JSON.stringify(dest)}`);
    }
    return { host: v4[1]!, port };
  }
  throw new ValidationError(`malformed dest ${JSON.stringify(dest)}`);
}
