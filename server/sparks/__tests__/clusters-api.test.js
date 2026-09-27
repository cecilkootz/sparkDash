import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { WebSocket } from "ws";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(t, sparks) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sparkdash-clusters-"));
  const sparksPath = path.join(tmp, "sparks.json");
  await writeFile(sparksPath, JSON.stringify({ sparks }));
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    env: {
      ...process.env,
      BIND_HOST: "127.0.0.1",
      PORT: String(port),
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
      setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 2_000)
    ),
  ]);
  return `http://127.0.0.1:${port}`;
}

async function api(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test("cluster CRUD, snapshot membership, and cluster-scoped batch actions", async (t) => {
  const base = await startServer(t, [
    { id: "a", name: "A", lanIp: "192.0.2.1" },
    { id: "b", name: "B", lanIp: "192.0.2.2" },
    { id: "c", name: "C", lanIp: "192.0.2.3" },
  ]);

  const created = await api(base, "POST", "/api/clusters", { name: "Rack", sparkIds: ["a", "b"] });
  assert.equal(created.status, 200);
  const id = created.body.cluster.id;
  assert.deepEqual(created.body.cluster.sparkIds, ["a", "b"]);

  const dup = await api(base, "POST", "/api/clusters", { name: "rack" });
  assert.equal(dup.status, 400);

  const moved = await api(base, "PATCH", "/api/sparks/c", { clusterId: id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.spark.clusterId, id);

  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  t.after(() => ws.close());
  const snap = JSON.parse(String((await once(ws, "message"))[0]));
  assert.deepEqual(snap.clusters, [{ id, name: "Rack", sparkIds: ["a", "b", "c"] }]);
  assert.deepEqual(snap.sparks.map((s) => s.clusterId), [id, id, id]);

  await api(base, "PATCH", `/api/clusters/${id}`, { name: "Rack 2", sparkIds: ["b"] });
  const scoped = await api(base, "POST", `/api/sparks/hermes/update-all?cluster=${id}`);
  assert.deepEqual(scoped.body.results.map((r) => r.id), ["b"]);
  const all = await api(base, "POST", "/api/sparks/hermes/update-all");
  assert.deepEqual(all.body.results.map((r) => r.id), ["a", "b", "c"]);

  assert.equal((await api(base, "POST", "/api/sparks/shutdown-all?cluster=nope")).status, 404);
  assert.equal((await api(base, "POST", "/api/sparks/wake-all?cluster=nope")).status, 404);

  const removed = await api(base, "DELETE", `/api/clusters/${id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual((await api(base, "GET", "/api/clusters")).body.clusters, []);
  const sparks = (await api(base, "GET", "/api/sparks")).body.sparks;
  assert.deepEqual(sparks.map((s) => s.clusterId), [null, null, null]);
});
