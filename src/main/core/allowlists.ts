/**
 * What a game connection is allowed to reach: three ports, public IPv4 unicast,
 * and the ArenaNet domain suffixes.
 *
 * Every rule here is a refusal. Loopback, link-local, RFC1918, carrier-grade
 * NAT, this-network, benchmarking and multicast are all excluded, so a hostile
 * or confused destination cannot turn the main process into a scanner of the
 * player's own network — and the address is matched as text before it is
 * matched as a range, because a spelling the platform resolver reads
 * differently is a way past every range below. Suffix matching is anchored on a
 * dot, so `notarenanetworks.com` is not a match for `arenanetworks.com`.
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

/**
 * Four decimal groups and nothing else, matched before any range is consulted.
 * `Number` accepted spellings that reach a refused address by another route: an
 * empty group in `8.8.8.`, surrounding whitespace, `0x08.8.8.8`, and the leading
 * zeros `inet_aton` reads as octal, where `012.0.0.1` is a public decimal 12
 * here and 10.0.0.1 to whatever connects. IPv4-in-IPv6 is refused by this rule
 * rather than by how the dots happen to divide, so the refusal survives an edit
 * to the ranges below.
 */
const IPV4_TEXT = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export function isPublicIpv4(ip: string): boolean {
  const groups = IPV4_TEXT.exec(ip);
  if (!groups) return false;
  const nums = groups.slice(1).map(Number);
  if (nums.some((n) => n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0) return false;
  // Benchmarking range: never routed, and a lab's test harness is the last
  // thing a game connection should be able to reach.
  if (a === 198 && (b === 18 || b === 19)) return false;
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
