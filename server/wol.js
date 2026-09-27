/**
 * Wake-on-LAN helpers: MAC validation, /24 broadcast derivation, magic packet send,
 * and relay through an online peer Spark on the target's /24.
 */
import dgram from "node:dgram";
import { sshExec } from "./collectors/ssh.js";
import { isAllowedTargetHost, isValidSshUser } from "./validate.js";

const MAC_RE = /^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/;

/** Primary LAN NIC on DGX Spark used for WoL auto-detect. */
export const WOL_INTERFACE = "enP7s7";

/**
 * Resolve MAC for wake: user override first, then last auto-detected enP7s7 MAC.
 * @param {{ macAddress?: string | null, detectedMacAddress?: string | null }} spark
 */
export function effectiveMac(spark) {
  return normalizeMac(spark?.macAddress) || normalizeMac(spark?.detectedMacAddress);
}

/** @param {unknown} mac */
export function normalizeMac(mac) {
  if (mac == null) return null;
  const clean = String(mac).trim().toLowerCase();
  if (!MAC_RE.test(clean)) return null;
  return clean;
}

/**
 * Derive a /24 directed broadcast from an IPv4 address, else global broadcast.
 * @param {unknown} lanIp
 */
export function broadcastForLanIp(lanIp) {
  if (typeof lanIp === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lanIp.trim())) {
    const parts = lanIp.trim().split(".");
    const nums = parts.map((p) => Number(p));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return `${nums[0]}.${nums[1]}.${nums[2]}.255`;
    }
  }
  return "255.255.255.255";
}

/** @param {unknown} ip @returns {number[] | null} octets of a dotted-quad IPv4 */
function parseIpv4(ip) {
  const m = typeof ip === "string" ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim()) : null;
  const octets = m ? m.slice(1).map(Number) : null;
  return octets && octets.every((n) => n <= 255) ? octets : null;
}

/** @param {unknown} ip */
function subnet24(ip) {
  return parseIpv4(ip)?.slice(0, 3).join(".") ?? null;
}

/**
 * Build a WoL magic packet for a normalized MAC (aa:bb:… or aa-bb-…).
 * @param {string} cleanMac
 */
export function buildMagicPacket(cleanMac) {
  const macBytes = cleanMac.split(/[:\-]/).map((b) => parseInt(b, 16));
  const magic = Buffer.alloc(6 + 16 * 6);
  magic.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 6; j++) {
      magic[6 + i * 6 + j] = macBytes[j];
    }
  }
  return magic;
}

/**
 * Send one WoL magic packet. Settles exactly once (no hanging bind, no double settle).
 * @param {string} cleanMac normalized MAC
 * @param {string} [broadcastAddr]
 * @param {number} [port=9]
 * @returns {Promise<{ mac: string, broadcast: string }>}
 */
export function sendWol(cleanMac, broadcastAddr = "255.255.255.255", port = 9) {
  const magic = buildMagicPacket(cleanMac);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(result);
    };

    const sock = dgram.createSocket("udp4");
    sock.on("error", (err) => {
      finish(err);
    });

    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
        sock.send(magic, 0, magic.length, port, broadcastAddr, (err) => {
          if (err) finish(err);
          else finish(null, { mac: cleanMac, broadcast: broadcastAddr });
        });
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export const WOL_RELAY_TIMEOUT_MS = 5000;

/** POSIX single-quote for the remote login shell. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Remote command that sends the magic packet from a peer on the target's LAN.
 * Needed because a directed broadcast from outside the subnet (e.g. a pod) is
 * dropped by the router while the local send still reports success.
 * Only validated values are embedded, so the python source is quote-free.
 * @param {string} mac
 * @param {string} broadcast IPv4 broadcast address
 */
export function wolRelayCommand(mac, broadcast) {
  const cleanMac = normalizeMac(mac);
  if (!cleanMac) throw new Error("Invalid MAC for WoL relay");
  const octets = parseIpv4(broadcast);
  if (!octets) throw new Error("Invalid broadcast address for WoL relay");
  const hex = cleanMac.replace(/[:-]/g, "");
  const addr = octets.join(".");
  const py = [
    "import socket",
    "s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)",
    "s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)",
    `s.sendto(bytes.fromhex("f"*12+"${hex}"*16),("${addr}",9))`,
  ].join(";");
  return `python3 -c ${shQuote(py)}`;
}

/** Same checks sshCommandSpec enforces, without its side effects. */
function hasUsableSsh(spark) {
  const ssh = spark?.ssh;
  if (!ssh || !isValidSshUser(ssh.user)) return false;
  if (!isAllowedTargetHost(ssh.host || spark.lanIp)) return false;
  return ssh.auth !== "pass" || Boolean(ssh.password);
}

/**
 * First online remote peer on the target's /24 that can run the relay.
 * @param {{ id: string, lanIp?: string }} target
 * @param {Array<object>} sparks
 * @param {(id: string) => boolean} isOnline
 */
export function pickWolRelayPeer(target, sparks, isOnline) {
  const subnet = subnet24(target?.lanIp);
  if (!subnet) return null;
  return (
    (sparks || []).find(
      (peer) =>
        peer?.id !== target.id &&
        !peer.isLocal &&
        subnet24(peer.lanIp) === subnet &&
        isOnline(peer.id) &&
        hasUsableSsh(peer)
    ) || null
  );
}

/**
 * Relay the magic packet through `peer`. Never throws: the caller reports the
 * outcome next to the direct send.
 * @returns {Promise<{ via: string, ok: boolean, error?: string }>}
 */
export async function relayWol(peer, mac, broadcast, exec = sshExec) {
  try {
    await exec(peer, wolRelayCommand(mac, broadcast), { timeoutMs: WOL_RELAY_TIMEOUT_MS });
    return { via: peer.id, ok: true };
  } catch (err) {
    return { via: peer.id, ok: false, error: err?.message || String(err) };
  }
}

/**
 * Direct send plus optional relay, concurrently. The wake only fails when the
 * direct send failed and no relay got through.
 * @returns {Promise<{ ok: boolean, mac: string, broadcast: string, relay: { via: string, ok: boolean, error?: string } | null, error?: string }>}
 */
export async function wakeWithRelay(mac, broadcast, peer, { send = sendWol, exec = sshExec } = {}) {
  const [direct, relay] = await Promise.all([
    send(mac, broadcast).then(
      () => null,
      (err) => err?.message || String(err)
    ),
    peer ? relayWol(peer, mac, broadcast, exec) : null,
  ]);
  const result = { ok: !direct || Boolean(relay?.ok), mac, broadcast, relay };
  return direct ? { ...result, error: direct } : result;
}
