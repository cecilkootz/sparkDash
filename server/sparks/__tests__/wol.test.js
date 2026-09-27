import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMagicPacket,
  pickWolRelayPeer,
  relayWol,
  wakeWithRelay,
  WOL_RELAY_TIMEOUT_MS,
  wolRelayCommand,
} from "../../wol.js";

const PY_SOURCE =
  'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);' +
  "s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1);" +
  's.sendto(bytes.fromhex("f"*12+"aabbccddeeff"*16),("192.168.2.255",9))';

test("wolRelayCommand builds a single-quoted python3 one-liner", () => {
  assert.equal(wolRelayCommand("aa:bb:cc:dd:ee:ff", "192.168.2.255"), `python3 -c '${PY_SOURCE}'`);
  assert.equal(wolRelayCommand("AA-BB-CC-DD-EE-FF", "192.168.2.255"), `python3 -c '${PY_SOURCE}'`);
});

test("wolRelayCommand payload expression matches the direct magic packet", () => {
  const hex = "aabbccddeeff";
  assert.deepEqual(Buffer.from("f".repeat(12) + hex.repeat(16), "hex"), buildMagicPacket("aa:bb:cc:dd:ee:ff"));
});

test("wolRelayCommand refuses anything that is not a validated MAC / IPv4", () => {
  for (const mac of ["aa:bb:cc:dd:ee:ff'; reboot; '", "aa:bb:cc:dd:ee", "", null]) {
    assert.throws(() => wolRelayCommand(mac, "192.168.2.255"), /Invalid MAC/);
  }
  for (const bc of ["192.168.2.255'", "192.168.2.256", "spark.local", "$(reboot)", ""]) {
    assert.throws(() => wolRelayCommand("aa:bb:cc:dd:ee:ff", bc), /Invalid broadcast/);
  }
});

test("wolRelayCommand survives the remote shell intact", () => {
  // Stand-in python3 that echoes the -c source, run the way sshd does ($SHELL -c).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparkdash-wol-"));
  try {
    fs.writeFileSync(path.join(dir, "python3"), '#!/bin/sh\nprintf "%s|%s" "$1" "$2"\n', { mode: 0o755 });
    const env = { PATH: `${dir}:${process.env.PATH}` };
    for (const shell of ["/bin/sh", "/bin/bash"]) {
      if (!fs.existsSync(shell)) continue;
      const out = execFileSync(shell, ["-c", wolRelayCommand("aa:bb:cc:dd:ee:ff", "192.168.2.255")], { env });
      assert.equal(String(out), `-c|${PY_SOURCE}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const target = { id: "t", lanIp: "192.168.2.21", ssh: { host: "192.168.2.21", user: "matt", auth: "key" } };
const peer = (id, lanIp, ssh = { host: lanIp, user: "matt", auth: "key" }, extra = {}) => ({ id, lanIp, ssh, ...extra });

test("pickWolRelayPeer picks an online peer on the same /24 only", () => {
  const sparks = [
    target,
    peer("offline", "192.168.2.22"),
    peer("other-subnet", "192.168.3.23"),
    peer("no-password", "192.168.2.24", { host: "192.168.2.24", user: "matt", auth: "pass" }),
    peer("no-ssh", "192.168.2.25", null),
    peer("local", "192.168.2.26", null, { isLocal: true }),
    peer("good", "192.168.2.27"),
  ];
  const online = new Set(["t", "other-subnet", "no-password", "no-ssh", "local", "good"]);
  assert.equal(pickWolRelayPeer(target, sparks, (id) => online.has(id))?.id, "good");
  assert.equal(pickWolRelayPeer(target, sparks.slice(0, -1), (id) => online.has(id)), null);
});

test("pickWolRelayPeer never relays through the target and needs an IPv4 target", () => {
  const good = peer("good", "192.168.2.27");
  assert.equal(pickWolRelayPeer(target, [target], () => true), null);
  assert.equal(pickWolRelayPeer({ ...target, lanIp: "" }, [good], () => true), null);
  assert.equal(pickWolRelayPeer({ ...target, lanIp: "spark-t.local" }, [good], () => true), null);
  assert.equal(
    pickWolRelayPeer(target, [peer("pw", "192.168.2.28", { user: "matt", auth: "pass", password: "x" })], () => true)?.id,
    "pw"
  );
});

test("relayWol runs the command over the injected exec with a short timeout", async () => {
  const calls = [];
  const relay = await relayWol(peer("good", "192.168.2.27"), "aa:bb:cc:dd:ee:ff", "192.168.2.255", async (...args) => {
    calls.push(args);
    return "";
  });
  assert.deepEqual(relay, { via: "good", ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].id, "good");
  assert.equal(calls[0][1], `python3 -c '${PY_SOURCE}'`);
  assert.deepEqual(calls[0][2], { timeoutMs: WOL_RELAY_TIMEOUT_MS });
  assert.ok(WOL_RELAY_TIMEOUT_MS <= 5000);
});

test("relayWol reports failures instead of throwing", async () => {
  const relay = await relayWol(peer("good", "192.168.2.27"), "aa:bb:cc:dd:ee:ff", "192.168.2.255", async () => {
    throw new Error("SSH to 192.168.2.27 failed: timed out");
  });
  assert.deepEqual(relay, { via: "good", ok: false, error: "SSH to 192.168.2.27 failed: timed out" });
});

test("wakeWithRelay: a failed relay does not fail a successful direct send", async () => {
  const wake = await wakeWithRelay("aa:bb:cc:dd:ee:ff", "192.168.2.255", peer("good", "192.168.2.27"), {
    send: async () => ({}),
    exec: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(wake.ok, true);
  assert.equal(wake.error, undefined);
  assert.deepEqual(wake.relay, { via: "good", ok: false, error: "boom" });
  assert.equal(wake.mac, "aa:bb:cc:dd:ee:ff");
  assert.equal(wake.broadcast, "192.168.2.255");
});

test("wakeWithRelay: no peer means relay null and no exec", async () => {
  let execCalls = 0;
  const wake = await wakeWithRelay("aa:bb:cc:dd:ee:ff", "192.168.2.255", null, {
    send: async () => ({}),
    exec: async () => {
      execCalls += 1;
    },
  });
  assert.deepEqual(wake, { ok: true, mac: "aa:bb:cc:dd:ee:ff", broadcast: "192.168.2.255", relay: null });
  assert.equal(execCalls, 0);
});

test("wakeWithRelay: direct failure is only fatal when the relay also fails", async () => {
  const send = async () => {
    throw new Error("EACCES");
  };
  const relayed = await wakeWithRelay("aa:bb:cc:dd:ee:ff", "192.168.2.255", peer("good", "192.168.2.27"), {
    send,
    exec: async () => "",
  });
  assert.equal(relayed.ok, true);
  assert.equal(relayed.error, "EACCES");
  assert.deepEqual(relayed.relay, { via: "good", ok: true });

  const failed = await wakeWithRelay("aa:bb:cc:dd:ee:ff", "192.168.2.255", null, { send });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "EACCES");
  assert.equal(failed.relay, null);
});
