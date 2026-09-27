import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sparkdash-registry-clusters-"));
process.env.SPARKS_JSON_PATH = path.join(tmp, "sparks.json");
process.env.SPARKS_SECRETS_PATH = path.join(tmp, "sparks-secrets.json");
process.env.SECRETS_KEY_PATH = path.join(tmp, ".secrets-key");

const { SparkRegistry } = await import("../SparkRegistry.js");

function registry() {
  fs.writeFileSync(process.env.SPARKS_JSON_PATH, '{"sparks":[]}\n');
  const r = new SparkRegistry();
  for (const id of ["a", "b", "c"]) r.addSpark({ id, name: id.toUpperCase(), lanIp: "127.0.0.1" });
  return r;
}

const onDisk = () => JSON.parse(fs.readFileSync(process.env.SPARKS_JSON_PATH, "utf-8"));

test("addCluster persists the cluster and assigns members", () => {
  const r = registry();
  const c = r.addCluster({ name: "  Rack 1 ", sparkIds: ["a", "c"] });
  assert.equal(c.name, "Rack 1");
  assert.deepEqual(c.sparkIds, ["a", "c"]);
  assert.equal(r.getSpark("a").clusterId, c.id);
  assert.equal(r.getSpark("b").clusterId, null);
  const disk = onDisk();
  assert.deepEqual(disk.clusters, [{ id: c.id, name: "Rack 1" }]);
  assert.equal(disk.sparks.find((s) => s.id === "c").clusterId, c.id);
});

test("cluster names are required and unique case-insensitively", () => {
  const r = registry();
  r.addCluster({ name: "Rack" });
  assert.throws(() => r.addCluster({ name: "rack" }), /already exists/);
  assert.throws(() => r.addCluster({ name: "   " }), /1–64/);
});

test("updateCluster sparkIds replaces membership and steals from other clusters", () => {
  const r = registry();
  const one = r.addCluster({ name: "One", sparkIds: ["a", "b"] });
  const two = r.addCluster({ name: "Two" });
  r.updateCluster(two.id, { sparkIds: ["b", "c"] });
  assert.deepEqual(r.getCluster(one.id).sparkIds, ["a"]);
  assert.deepEqual(r.getCluster(two.id).sparkIds, ["b", "c"]);
  r.updateCluster(two.id, { sparkIds: [] });
  assert.deepEqual(r.getCluster(two.id).sparkIds, []);
  assert.equal(r.getSpark("c").clusterId, null);
});

test("updateCluster rejects unknown sparks and clusters", () => {
  const r = registry();
  const c = r.addCluster({ name: "One" });
  assert.throws(() => r.updateCluster(c.id, { sparkIds: ["zzz"] }), /Unknown spark/);
  assert.throws(() => r.updateCluster("nope", { name: "x" }), (err) => err.status === 404);
});

test("removeCluster ungroups its members", () => {
  const r = registry();
  const c = r.addCluster({ name: "One", sparkIds: ["a"] });
  assert.equal(r.removeCluster(c.id).id, c.id);
  assert.equal(r.getSpark("a").clusterId, null);
  assert.deepEqual(r.clusters, []);
  assert.equal(r.removeCluster(c.id), null);
});

test("updateSpark validates clusterId", () => {
  const r = registry();
  const c = r.addCluster({ name: "One" });
  r.updateSpark("b", { clusterId: c.id });
  assert.deepEqual(r.getCluster(c.id).sparkIds, ["b"]);
  assert.throws(() => r.updateSpark("b", { clusterId: "missing" }), /not found/);
  r.updateSpark("b", { clusterId: null });
  assert.equal(r.getSpark("b").clusterId, null);
});

test("load drops clusterIds that reference no cluster", () => {
  fs.writeFileSync(
    process.env.SPARKS_JSON_PATH,
    JSON.stringify({
      sparks: [
        { id: "a", lanIp: "127.0.0.1", clusterId: "kept" },
        { id: "b", lanIp: "127.0.0.1", clusterId: "gone" },
      ],
      clusters: [{ id: "kept", name: "Kept" }, { id: "", name: "bad" }],
    })
  );
  const r = new SparkRegistry();
  assert.deepEqual(r.clusters, [{ id: "kept", name: "Kept", sparkIds: ["a"] }]);
  assert.equal(r.getSpark("b").clusterId, null);
});
