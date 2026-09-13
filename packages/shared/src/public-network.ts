/**
 * Syntactic public-network URL policy shared by renderer and main.
 *
 * HTTPS only; never a loopback or private-network host — trailing dots,
 * IPv4-mapped/compatible and ULA / link-local IPv6 included. DNS resolution
 * is additional and lives in the main process (this module stays I/O-free):
 * a name that passes here can still resolve to a private address.
 */
export function isSafePublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return isPublicHostname(parsed.hostname);
}

/** Trailing-dot FQDN smuggling: `https://localhost./` normalizes to `localhost.`. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return false;
  if (host.startsWith("[")) {
    return isPublicIpLiteral(host.slice(1, -1));
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPublicIpLiteral(host);
  }
  return true;
}

/** False for loopback, unspecified, v4-mapped/compatible, ULA, link-local, multicast and private/reserved IPv4. */
export function isPublicIpLiteral(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return false;
  let groups: number[];
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return false;
    groups = [...head, ...Array.from({ length: fill }, () => "0"), ...tail].map((g) =>
      /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1,
    );
  } else {
    groups = lower.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1));
  }
  if (groups.length !== 8 || groups.some((n) => n < 0)) return false;
  if (groups.every((n) => n === 0)) return false; // unspecified ::
  // ::ffff:a.b.c.d (v4-mapped) and ::a.b.c.d (v4-compatible) inherit v4 rules.
  if (groups.slice(0, 5).every((n) => n === 0)) {
    if (groups[5] === 0xffff || groups[5] === 0) {
      const mapped = `${(groups[6] >> 8) & 255}.${groups[6] & 255}.${(groups[7] >> 8) & 255}.${groups[7] & 255}`;
      return isPublicIpLiteral(mapped);
    }
  }
  const first = groups[0];
  const second = groups[1];
  if (first === 0x7f00) return false; // ::7f00:... loopback variants
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10 link-local
  if (first >>> 8 === 0xfc || first >>> 8 === 0xfd) return false; // fc00::/7 ULA
  if (first >>> 8 === 0xff) return false; // multicast
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  return true;
}
