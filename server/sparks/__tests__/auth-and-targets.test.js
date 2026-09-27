import { test } from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { allowOpenRemote, authenticate, authorizeUpgrade, configuredToken, requireRemoteAuth } from "../../auth.js";
import { createRateLimiter, validateSparkTarget } from "../../validate.js";

test("loopback bind does not require a remote token", () => {
  assert.equal(requireRemoteAuth("127.0.0.1"), false);
  assert.equal(requireRemoteAuth("0.0.0.0"), true);
});

test("open remote bind is on by default and off when SPARKDASH_ALLOW_OPEN_REMOTE=0", () => {
  const previous = process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
  try {
    delete process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
    assert.equal(allowOpenRemote(), true);
    process.env.SPARKDASH_ALLOW_OPEN_REMOTE = "1";
    assert.equal(allowOpenRemote(), true);
    process.env.SPARKDASH_ALLOW_OPEN_REMOTE = "0";
    assert.equal(allowOpenRemote(), false);
  } finally {
    if (previous == null) delete process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
    else process.env.SPARKDASH_ALLOW_OPEN_REMOTE = previous;
  }
});

test("bearer authentication rejects a wrong token", () => {
  const previous = process.env.SPARKDASH_TOKEN;
  process.env.SPARKDASH_TOKEN = "secret-token";
  try {
    assert.equal(configuredToken(), "secret-token");
    const denied = authenticate({ headers: { authorization: "Bearer no" }, query: {} });
    assert.equal(denied.ok, false);
    const allowed = authenticate({ headers: { authorization: "Bearer secret-token" }, query: {} });
    assert.equal(allowed.ok, true);
  } finally {
    if (previous == null) delete process.env.SPARKDASH_TOKEN;
    else process.env.SPARKDASH_TOKEN = previous;
  }
});

function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Mirrors what ws passes to verifyClient: no Express `query`, token only in `url`.
function upgradeRequest(url, headers = {}) {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.headers = headers;
  return req;
}

test("WebSocket upgrade on a remote bind accepts ?token= from a raw request", () => {
  withEnv({ BIND_HOST: "0.0.0.0", SPARKDASH_TOKEN: "secret-token", SPARKDASH_ALLOW_OPEN_REMOTE: "0" }, () => {
    assert.equal(upgradeRequest("/ws?token=secret-token").query, undefined);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws?token=secret-token")), true);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws?token=secret%2Dtoken")), true);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws", { authorization: "Bearer secret-token" })), true);
  });
});

test("WebSocket upgrade on a remote bind rejects a missing or wrong token", () => {
  withEnv({ BIND_HOST: "0.0.0.0", SPARKDASH_TOKEN: "secret-token", SPARKDASH_ALLOW_OPEN_REMOTE: "0" }, () => {
    assert.equal(authorizeUpgrade(upgradeRequest("/ws")), false);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws?token=wrong")), false);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws?token=")), false);
    assert.equal(authorizeUpgrade(upgradeRequest("/ws?other=secret-token")), false);
  });
});

test("WebSocket upgrade on loopback without a token stays open", () => {
  withEnv({ BIND_HOST: "127.0.0.1", SPARKDASH_TOKEN: null, DASHBOARD_TOKEN: null }, () => {
    assert.equal(authorizeUpgrade(upgradeRequest("/ws")), true);
  });
});

test("local units may omit LAN IP while remote units still require a host", () => {
  assert.equal(validateSparkTarget({ isLocal: true }), null);
  assert.match(validateSparkTarget({ isLocal: false }), /lanIp or ssh.host/);
  assert.equal(validateSparkTarget({ lanIp: "192.168.1.20" }), null);
});

test("rate limiter expires stale keys instead of growing forever", () => {
  const allow = createRateLimiter(2, 20);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  const started = Date.now();
  while (Date.now() - started < 30) { /* wait out the window */ }
  assert.equal(allow("a"), true);
});
