import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TOKEN = "remote-test-token";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startRemoteServer(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sparkdash-remote-auth-"));
  const sparksPath = path.join(tmp, "sparks.json");
  await writeFile(sparksPath, "[]\n");
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      BIND_HOST: "0.0.0.0",
      PORT: String(port),
      SPARKDASH_TOKEN: TOKEN,
      SPARKDASH_ALLOW_OPEN_REMOTE: "0",
      SPARKS_JSON_PATH: sparksPath,
      SPARKS_SECRETS_PATH: path.join(tmp, "sparks-secrets.json"),
      SECRETS_KEY_PATH: path.join(tmp, ".secrets-key"),
      LLM_DAILY_JSON_PATH: path.join(tmp, "llm-daily.json"),
      FLEET_ENERGY_JSON_PATH: path.join(tmp, "fleet-energy.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  await Promise.race([
    new Promise((resolve) => {
      const check = () => (output.includes("server listening") ? resolve() : setTimeout(check, 10));
      check();
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 3_000)
    ),
  ]);
  assert.equal(output.includes(TOKEN), false, "the token must never be logged");
  return `127.0.0.1:${port}`;
}

test("remote bind with a token: SPA is public, /api and /ws require the token", async (t) => {
  const host = await startRemoteServer(t);
  const base = `http://${host}`;

  const distDir = path.join(ROOT, "dist");
  const built = existsSync(path.join(distDir, "index.html"));
  const asset = built
    ? readdirSync(path.join(distDir, "assets")).find((name) => name.endsWith(".js"))
    : "index.js";
  const home = await fetch(`${base}/`);
  const script = await fetch(`${base}/assets/${asset}`);
  if (built) {
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") || "", /text\/html/);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") || "", /javascript/);
  } else {
    // Without a build both requests still reach the public SPA fallback, not auth.
    assert.equal(home.status, 503);
    assert.equal(script.status, 503);
  }

  assert.equal((await fetch(`${base}/api/sparks`)).status, 401);
  assert.equal((await fetch(`${base}/api/health`)).status, 401);
  assert.equal(
    (await fetch(`${base}/api/sparks`, { headers: { Authorization: "Bearer wrong" } })).status,
    401
  );
  const authed = await fetch(`${base}/api/sparks`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(authed.status, 200);
  assert.deepEqual(await authed.json(), { sparks: [] });

  const ok = new WebSocket(`ws://${host}/ws?token=${encodeURIComponent(TOKEN)}`);
  t.after(() => ok.close());
  await once(ok, "open");

  const denied = new WebSocket(`ws://${host}/ws?token=wrong`);
  const [err] = await once(denied, "error");
  assert.match(err.message, /401/);

  const anonymous = new WebSocket(`ws://${host}/ws`);
  const [anonErr] = await once(anonymous, "error");
  assert.match(anonErr.message, /401/);
});
