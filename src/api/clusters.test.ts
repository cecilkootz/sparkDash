import { describe, expect, it } from "vitest";
import { clusterStats, groupByCluster, sortByCluster } from "./clusters";
import { makeSpark } from "../testing/fixtures";
import type { Cluster } from "./types";

const inCluster = (id: string, clusterId: string | null, online = true) => ({
  ...makeSpark(id, online),
  clusterId,
});

const clusters: Cluster[] = [
  { id: "c1", name: "One", sparkIds: [] },
  { id: "c2", name: "Two", sparkIds: [] },
];

describe("cluster grouping", () => {
  it("groups in cluster order, keeps empty clusters, and treats unknown ids as ungrouped", () => {
    const sparks = [inCluster("a", null), inCluster("b", "c2"), inCluster("c", "gone"), inCluster("d", "c2")];
    const groups = groupByCluster(sparks, clusters);
    expect(groups.map((g) => [g.cluster?.id ?? null, g.sparks.map((s) => s.id)])).toEqual([
      ["c1", []],
      ["c2", ["b", "d"]],
      [null, ["a", "c"]],
    ]);
  });

  it("sortByCluster makes members contiguous and is a no-op without clusters", () => {
    const sparks = [inCluster("a", null), inCluster("b", "c1"), inCluster("c", "c2"), inCluster("d", "c1")];
    expect(sortByCluster(sparks, clusters).map((s) => s.id)).toEqual(["b", "d", "c", "a"]);
    expect(sortByCluster(sparks, [])).toBe(sparks);
  });
});

describe("clusterStats", () => {
  it("sums online members only", () => {
    const st = clusterStats([inCluster("a", "c1"), inCluster("b", "c1"), inCluster("c", "c1", false)]);
    expect(st).toEqual({
      total: 3,
      online: 2,
      gpuPowerW: 100,
      gpuUsageAvg: 42,
      memUsedMb: 2048,
      memTotalMb: 8192,
      decodeTps: 40,
    });
  });

  it("reports no GPU average when nothing is online", () => {
    expect(clusterStats([inCluster("a", "c1", false)]).gpuUsageAvg).toBeNull();
  });
});
