import type { Cluster, SparkSnapshot } from "./types";

export interface SparkGroup<T> {
  /** null for Sparks that belong to no (known) cluster. */
  cluster: Cluster | null;
  sparks: T[];
}

/** Clusters in their order, then ungrouped; empty clusters are kept, an empty ungrouped group is not. */
export function groupByCluster<T extends { id: string; clusterId?: string | null }>(
  sparks: T[],
  clusters: Cluster[]
): SparkGroup<T>[] {
  const known = new Set(clusters.map((c) => c.id));
  const groups: SparkGroup<T>[] = clusters.map((cluster) => ({
    cluster,
    sparks: sparks.filter((s) => s.clusterId === cluster.id),
  }));
  const ungrouped = sparks.filter((s) => !s.clusterId || !known.has(s.clusterId));
  if (ungrouped.length > 0) groups.push({ cluster: null, sparks: ungrouped });
  return groups;
}

/** Stable reorder so each cluster's members are contiguous (tab + overview order). */
export function sortByCluster<T extends { id: string; clusterId?: string | null }>(
  sparks: T[],
  clusters: Cluster[]
): T[] {
  if (clusters.length === 0) return sparks;
  return groupByCluster(sparks, clusters).flatMap((g) => g.sparks);
}

export interface ClusterStats {
  total: number;
  online: number;
  gpuPowerW: number;
  /** Mean GPU utilization over online members reporting a GPU; null when none do. */
  gpuUsageAvg: number | null;
  memUsedMb: number;
  memTotalMb: number;
  decodeTps: number;
}

export function clusterStats(sparks: SparkSnapshot[]): ClusterStats {
  let online = 0;
  let gpuPowerW = 0;
  let usageSum = 0;
  let usageCount = 0;
  let memUsedMb = 0;
  let memTotalMb = 0;
  let decodeTps = 0;
  for (const s of sparks) {
    if (!s.online) continue;
    online += 1;
    const gpu = s.metrics.gpu;
    const um = s.metrics.unifiedMemory;
    if (gpu) {
      gpuPowerW += gpu.power?.draw ?? 0;
      usageSum += gpu.usage ?? 0;
      usageCount += 1;
    }
    memUsedMb += gpu?.vram?.used ?? um?.used ?? 0;
    memTotalMb += gpu?.vram?.total ?? um?.total ?? 0;
    for (const llm of s.metrics.llm ?? []) {
      if (llm.available) decodeTps += llm.generationTps ?? 0;
    }
  }
  return {
    total: sparks.length,
    online,
    gpuPowerW,
    gpuUsageAvg: usageCount > 0 ? usageSum / usageCount : null,
    memUsedMb,
    memTotalMb,
    decodeTps,
  };
}
