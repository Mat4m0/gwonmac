import { createSocket } from "node:dgram";
import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { AllowlistError, AppError, ValidationError } from "../../shared/errors.js";
import { ALLOWED_DOMAINS, allowedName } from "./allowlists.js";

const FALLBACK_DNS = ["1.1.1.1", "8.8.8.8"];

export function normalizeDnsName(name: string): string {
  return name.toLowerCase().replace(/\.$/, "");
}

function skipName(data: Buffer, off: number): number {
  while (off < data.length) {
    const n = data[off]!;
    if (n === 0) return off + 1;
    if ((n & 0xc0) === 0xc0) return off + 2;
    off += n + 1;
  }
  throw new AppError("dns_truncated", "truncated DNS name");
}

/** Minimal A-record query for the geodc 0.0.1.2 sentinel some resolvers reject. */
export async function rawDnsQuery(
  name: string,
  server: string,
  timeoutMs = 3000,
): Promise<string> {
  const qid = randomBytes(2).readUInt16BE(0);
  const labels = name.replace(/\.$/, "").split(".");
  const parts: Buffer[] = [Buffer.alloc(12)];
  parts[0]!.writeUInt16BE(qid, 0);
  parts[0]!.writeUInt16BE(0x0100, 2);
  parts[0]!.writeUInt16BE(1, 4);
  for (const label of labels) {
    const buf = Buffer.from(label, "utf8");
    parts.push(Buffer.from([buf.length]), buf);
  }
  parts.push(Buffer.from([0, 0, 1, 0, 1]));
  const query = Buffer.concat(parts);

  const data = await new Promise<Buffer>((resolve, reject) => {
    const s = createSocket("udp4");
    const timer = setTimeout(() => {
      s.close();
      reject(new AppError("dns_timeout", `DNS timeout talking to ${server}`));
    }, timeoutMs);
    s.once("error", (err) => {
      clearTimeout(timer);
      s.close();
      reject(err);
    });
    s.once("message", (msg) => {
      clearTimeout(timer);
      s.close();
      resolve(msg);
    });
    s.send(query, 53, server);
  });

  if (data.length < 12 || data.readUInt16BE(0) !== qid) {
    throw new AppError("dns_bad_reply", "bad DNS reply");
  }
  const rcode = data.readUInt16BE(2) & 0xf;
  if (rcode) throw new AppError("dns_rcode", `DNS rcode ${rcode}`);
  const qd = data.readUInt16BE(4);
  const an = data.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < qd; i++) off = skipName(data, off) + 4;
  for (let i = 0; i < an; i++) {
    off = skipName(data, off);
    if (off + 10 > data.length) throw new AppError("dns_truncated", "truncated DNS answer");
    const rtype = data.readUInt16BE(off);
    const rdlen = data.readUInt16BE(off + 8);
    off += 10;
    if (rtype === 1 && rdlen === 4) {
      return `${data[off]}.${data[off + 1]}.${data[off + 2]}.${data[off + 3]}`;
    }
    off += rdlen;
  }
  throw new AppError("dns_no_a", "no A record");
}

async function systemResolvers(): Promise<string[]> {
  try {
    const text = await readFile("/etc/resolv.conf", "utf8");
    return [...text.matchAll(/^nameserver\s+([0-9.]+)/gm)].map((m) => m[1]!);
  } catch {
    return [];
  }
}

export async function resolveDns(
  name: string,
  domains: readonly string[] = ALLOWED_DOMAINS,
): Promise<string> {
  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("dns name must be a non-empty string");
  }
  const host = normalizeDnsName(name.trim());
  if (isIP(host)) {
    throw new ValidationError(`IP literal refused as DNS name: ${host}`);
  }
  if (!allowedName(host, domains)) {
    throw new AllowlistError(`dns name not allowed: ${name}`);
  }

  const tried: string[] = [];
  try {
    const r = await dns.lookup(host, { family: 4 });
    return r.address;
  } catch (e) {
    tried.push(`lookup:${e instanceof Error ? e.message : String(e)}`);
  }

  const servers = [...(await systemResolvers()), ...FALLBACK_DNS];
  for (const server of servers) {
    try {
      return await rawDnsQuery(host, server);
    } catch (e) {
      tried.push(`${server}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new AppError("dns_failed", tried.join("; "));
}
