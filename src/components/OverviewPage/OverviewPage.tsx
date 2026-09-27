import { useState } from "react";
import type { Cluster, SparkSnapshot } from "../../api/types";
import { isWorkerSpark, resolveSparkRole } from "../../api/sparkRole";
import { clusterStats, groupByCluster } from "../../api/clusters";
import { MetricBar } from "../ui/MetricBar";
import { FleetEnergyCard } from "./FleetEnergyCard";
import { FleetAlertStrip } from "./FleetAlertStrip";
import { BatchActions } from "./BatchActions";
import { ActivityIcon, EditIcon, PlusIcon } from "../ui/icons";

interface OverviewPageProps {
  sparks: SparkSnapshot[];
  clusters?: Cluster[];
  /** null opens the dialog to create a cluster. */
  onEditCluster?: (cluster: Cluster | null) => void;
  hideOffline?: boolean;
  hideWorkers?: boolean;
  showFleetEnergy?: boolean;
  showFleetExceptions?: boolean;
  showOverviewSearch?: boolean;
  temperatureUnit?: "celsius" | "fahrenheit";
  onSelectSpark?: (id: string) => void;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Format a storage value in MB, stripping trailing ".0" and optionally omitting the unit. */
function fmtStorage(mb: number, unit: boolean): string {
  const val = mb >= 1024 ? mb / 1024 : mb;
  const label = mb >= 1024 ? "GB" : "MB";
  const s = val.toFixed(1).replace(/\.0$/, "");
  return unit ? `${s} ${label}` : s;
}

function MiniStat({
  label,
  value,
  tone = "default",
  bold = true,
  title,
  wrap = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
  bold?: boolean;
  title?: string;
  /** Allow value to wrap (no ellipsis trim) — used for long model ids. */
  wrap?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-accent"
          : tone === "success"
            ? "text-success"
            : "text-text";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted">{label}</span>
      <span
        className={`font-tabular text-[13px] ${
          wrap
            ? "whitespace-normal break-words leading-snug [overflow-wrap:anywhere]"
            : "truncate"
        } ${bold ? "font-semibold" : ""} ${toneClass}`}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function SparkCard({
  spark,
  headSparkName,
  temperatureUnit,
  onSelect,
}: {
  spark: SparkSnapshot;
  headSparkName?: string | null;
  temperatureUnit: "celsius" | "fahrenheit";
  onSelect?: (id: string) => void;
}) {
  const gpu = spark.metrics.gpu;
  const um = spark.metrics.unifiedMemory;
  const online = spark.online;

  const usage = gpu?.usage ?? 0;
  const tempRaw = gpu?.temperature ?? 0;
  const displayTemp = temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(tempRaw) : tempRaw;
  const tempLabel = temperatureUnit === "fahrenheit" ? `${displayTemp}°F` : `${displayTemp}°C`;
  const vramPct = gpu?.vram?.percentage ?? um?.percentage ?? 0;
  const vramUsed = gpu?.vram?.used ?? um?.used ?? 0;
  const vramTotal = gpu?.vram?.total ?? um?.total ?? 0;
  const vramAvail = gpu?.vram?.available ?? um?.available ?? 0;

  // Temperature bar: cool → success, warm → warning, hot → danger
  const tempBarColor =
    tempRaw > 85 ? "bg-danger" : tempRaw > 65 ? "bg-warning" : tempRaw > 40 ? "bg-accent" : "bg-success";
  // Usage bar: accent for moderate, warning high, danger critical
  const usageBarColor = usage > 85 ? "bg-danger" : usage > 60 ? "bg-warning" : "bg-accent";
  // VRAM allocation: accent normal → warning/danger as it fills
  const vramBarColor = vramPct > 85 ? "bg-danger" : vramPct > 60 ? "bg-warning" : "bg-accent";

  return (
    <div
      className="overview-card flex flex-col"
      style={{
        padding: "var(--density-card-pad)",
        gap: "var(--density-card-gap)",
        ...(online ? {} : { opacity: 0.6 }),
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-success dot-glow-success" : "bg-danger"}`}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-strong">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(spark.id)}
              className="text-left font-inherit text-inherit hover:underline"
            >
              {spark.name}
            </button>
          ) : (
            spark.name
          )}
        </span>
        {(() => {
          const role = resolveSparkRole(spark);
          const text =
            role === "head" ? "Head" : role === "worker" ? "Worker" : "Standalone";
          const title =
            role === "head"
              ? "Cluster head Spark"
              : role === "worker"
                ? spark.workerLabel?.trim()
                  ? `${spark.workerLabel.trim()} · distributed LLM worker`
                  : "Distributed LLM worker"
                : spark.llmMonitoring === false
                  ? "Standalone — LLM monitoring off"
                  : "Standalone Spark";
          return (
            <span
              className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent"
              title={title}
            >
              {text}
            </span>
          );
        })()}
        {spark.comfyMonitoring ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              !spark.metrics?.comfy?.available
                ? "bg-border/60 text-muted"
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? "bg-accent/15 text-accent"
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? "bg-warning/15 text-warning"
                    : "bg-border/60 text-muted"
            }`}
            title={
              !spark.metrics?.comfy?.available
                ? "ComfyUI monitoring on — not reachable"
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? spark.metrics.comfy.activeJob?.title
                    ? `ComfyUI running: ${spark.metrics.comfy.activeJob.title}`
                    : "ComfyUI job running"
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? `ComfyUI queue: ${spark.metrics.comfy.queuePending} pending`
                    : "ComfyUI idle"
            }
          >
            {!spark.metrics?.comfy?.available
              ? "Comfy"
              : (spark.metrics.comfy.queueRunning ?? 0) > 0
                ? "Comfy · run"
                : (spark.metrics.comfy.queuePending ?? 0) > 0
                  ? `Comfy · ${spark.metrics.comfy.queuePending}q`
                  : "Comfy · idle"}
          </span>
        ) : null}
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {online ? "online" : "offline"}
        </span>
      </div>

      {!online || !gpu ? (
        <div className="flex h-[120px] items-center justify-center">
          <span className="text-[13px] text-muted">
            {online ? "Waiting for metrics…" : "Host unreachable"}
          </span>
        </div>
      ) : (
        <>
          {/* Three headline bars: GPU alloc, Temp, Usage */}
          <div className="flex flex-col gap-3.5">
            <MetricBar
              label="VRAM"
              value={vramUsed}
              max={vramTotal}
              color={vramBarColor}
              caption={vramTotal > 0 ? `${fmtStorage(vramUsed, false)} / ${fmtStorage(vramTotal, true)}` : "—"}
            />
            {spark.kind === "host" && (() => {
              // Non-Spark hosts: system RAM is separate from discrete VRAM.
              const ram = spark.metrics.ram;
              const rUsed = ram?.used ?? 0;
              const rTotal = ram?.total ?? 0;
              const rPct = rTotal > 0 ? Math.round((rUsed / rTotal) * 100) : 0;
              const ramBarColor = rPct > 85 ? "bg-danger" : rPct > 60 ? "bg-warning" : "bg-accent";
              return (
                <MetricBar
                  label="RAM"
                  value={rUsed}
                  max={rTotal}
                  color={ramBarColor}
                  caption={rTotal > 0 ? `${fmtStorage(rUsed, false)} / ${fmtStorage(rTotal, true)}` : "—"}
                />
              );
            })()}
            <MetricBar
              label={
                spark.kind === "host" || (spark.metrics.cpu?.temperature ?? 0) > 0
                  ? "GPU"
                  : "Temperature"
              }
              value={displayTemp}
              max={temperatureUnit === "fahrenheit" ? 212 : 100}
              color={tempBarColor}
              caption={tempLabel}
            />
            {(spark.metrics.cpu?.temperature ?? 0) > 0 && (() => {
              const cpuRaw = spark.metrics.cpu?.temperature ?? 0;
              const cpuDisplay =
                temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(cpuRaw) : cpuRaw;
              const cpuLabel =
                temperatureUnit === "fahrenheit" ? `${cpuDisplay}°F` : `${cpuDisplay}°C`;
              const cpuBarColor =
                cpuRaw > 95 ? "bg-danger" : cpuRaw > 85 ? "bg-warning" : cpuRaw > 50 ? "bg-accent" : "bg-success";
              return (
                <MetricBar
                  label="CPU"
                  value={cpuDisplay}
                  max={temperatureUnit === "fahrenheit" ? 212 : 100}
                  color={cpuBarColor}
                  caption={cpuLabel}
                />
              );
            })()}
            {gpu?.throttle?.thermal && (
              <div
                className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger"
                title={gpu.throttle.detail || "GPU thermal slowdown engaged"}
              >
                Thermal throttle
              </div>
            )}
            <MetricBar
              label="Usage"
              value={usage}
              max={100}
              color={usageBarColor}
              caption={`${usage}%`}
            />
          </div>

          {/* Secondary stats */}
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3.5">
            <MiniStat
              label="GPU Power"
              value={`${gpu?.power?.draw ?? 0}W / ${gpu?.power?.limit ?? 0}W`}
            />
            {vramAvail > 0 && (
              <MiniStat
                label="Available"
                value={formatMb(vramAvail)}
                tone={vramAvail < 4096 ? "danger" : vramAvail < 16384 ? "warning" : "accent"}
              />
            )}
            {(() => {
              // Find the root disk by label "/" (the collector maps the host
              // root mount to that label). Fall back to the GB10 partition name
              // so the overview keeps working where labels aren't populated.
              const rootDisk =
                spark.metrics.storage.find((d) => d.label === "/") ??
                spark.metrics.storage.find((d) => d.device === "nvme0n1p2");
              if (rootDisk) {
                return (
                  <MiniStat
                    label="Storage"
                    value={`${fmtStorage(rootDisk.used, false)} / ${fmtStorage(rootDisk.total, true)}`}
                    tone={rootDisk.percentage > 85 ? "danger" : rootDisk.percentage > 60 ? "warning" : "default"}
                    bold={false}
                  />
                );
              }
              return null;
            })()}
            {(() => {
              const role = resolveSparkRole(spark);

              // Workers have no local LLM API — show cluster/model label instead.
              // Priority: manual workerLabel override > derived head-model
              // mirror > generic fallback. Derived never shows a stale model:
              // the backend nulls it when the head is unresolvable/offline.
              if (role === "worker") {
                const label =
                  spark.workerLabel?.trim() || spark.workerDerivedLabel?.trim() || "distributed";
                const title = headSparkName
                  ? `${label} · worker of ${headSparkName}`
                  : `${label} · distributed LLM worker`;
                return (
                  <MiniStat
                    label="Worker"
                    value={label}
                    tone="accent"
                    title={title}
                    wrap
                  />
                );
              }

              // Head / Standalone: same as before — live backend + model id.
              const llmArr = spark.metrics.llm;
              const llm = Array.isArray(llmArr) ? llmArr.find((l) => l.available) : null;
              if (!llm) return null;
              return (
                <MiniStat
                  label={
                    llm.backend === "vllm"
                      ? "vLLM"
                      : llm.backend === "ds4"
                        ? "ds4"
                        : llm.backend === "sglang"
                          ? "sgLang"
                          : llm.backend === "exl3"
                            ? "EXL3"
                            : llm.backend === "q27"
                              ? "q27"
                              : llm.backend ?? "LLM"
                  }
                  value={llm.modelId ?? "unknown"}
                  tone="accent"
                  title={llm.modelId ?? undefined}
                  wrap
                />
              );
            })()}
          </div>

          {(() => {
            const role = resolveSparkRole(spark);
            if (role === "worker") return null;
            const llmArr = spark.metrics.llm;
            const llm = Array.isArray(llmArr) ? llmArr.find((l) => l.available) : null;
            if (!llm) return null;
            return (
              <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div className="text-center">
                  <span className="font-tabular text-[28px] font-bold leading-none text-text-strong">
                    {llm.generationTps.toFixed(0)}
                  </span>
                  <span className="text-sm font-normal text-muted"> tok/s</span>
                </div>
                <div className="border-l border-border text-center">
                  <span className="font-tabular text-[28px] font-bold leading-none text-text-strong">
                    {llm.prefillTps.toFixed(0)}
                  </span>
                  <span className="text-sm font-normal text-muted"> prefill</span>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function ClusterHeader({
  cluster,
  members,
  onEdit,
}: {
  cluster: Cluster;
  members: SparkSnapshot[];
  onEdit?: (cluster: Cluster) => void;
}) {
  const st = clusterStats(members);
  const stats: { label: string; value: string }[] = [
    { label: "Online", value: `${st.online}/${st.total}` },
  ];
  if (st.online > 0) {
    stats.push({ label: "GPU power", value: `${Math.round(st.gpuPowerW)} W` });
    if (st.gpuUsageAvg != null) stats.push({ label: "GPU avg", value: `${Math.round(st.gpuUsageAvg)}%` });
    if (st.memTotalMb > 0) {
      stats.push({ label: "Memory", value: `${formatMb(st.memUsedMb)} / ${formatMb(st.memTotalMb)}` });
    }
    if (st.decodeTps > 0) stats.push({ label: "Decode", value: `${st.decodeTps.toFixed(1)} tok/s` });
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-text-strong">
          {cluster.name}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(cluster)}
              title="Edit cluster"
              aria-label={`Edit cluster ${cluster.name}`}
              className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {stats.map((stat) => (
            <MiniStat key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-end gap-3">
        <BatchActions sparks={members} cluster={cluster} />
      </div>
    </div>
  );
}

export function OverviewPage({
  sparks,
  clusters = [],
  onEditCluster,
  hideOffline = false,
  hideWorkers = false,
  showFleetEnergy = false,
  showFleetExceptions = false,
  showOverviewSearch = false,
  temperatureUnit = "celsius",
  onSelectSpark,
}: OverviewPageProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "issues">("all");
  const withoutWorkers = hideWorkers ? sparks.filter((s) => !isWorkerSpark(s)) : sparks;
  const visibleSparks = withoutWorkers.filter((spark) => {
    if (hideOffline && !spark.online) return false;
    if (showOverviewSearch && query && !spark.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (showOverviewSearch && statusFilter === "online" && !spark.online) return false;
    if (showOverviewSearch && statusFilter === "offline" && spark.online) return false;
    if (showOverviewSearch && statusFilter === "issues" && spark.online && !spark.metrics.storage.some((disk) => disk.percentage >= 90)) return false;
    return true;
  });
  const hiddenWorkerCount = hideWorkers ? sparks.filter(isWorkerSpark).length : 0;

  if (withoutWorkers.length === 0 || (hideOffline && withoutWorkers.every((spark) => !spark.online))) {
    const allWorkersHidden = hideWorkers && sparks.length > 0 && withoutWorkers.length === 0;
    const allOffline = hideOffline && withoutWorkers.length > 0;
    const title = allWorkersHidden
      ? "Worker nodes are hidden"
      : allOffline
        ? "All Sparks are offline"
        : "No Sparks registered";
    const detail = allWorkersHidden
      ? "Hide worker nodes is on in Settings. Turn it off to show Worker-role Sparks again."
      : allOffline
        ? "Auto-hide is enabled and no Sparks are currently online."
        : "Click the + tab to add a DGX Spark unit.";
    return (
      <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ActivityIcon className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </div>
    );
  }

  const onlineCount = visibleSparks.filter((s) => s.online).length;
  const visibleIds = new Set(visibleSparks.map((s) => s.id));
  // Sections use every member (stats + batch actions cover the whole cluster);
  // cards are filtered. A filtered-out section is dropped unless the cluster is empty.
  const sections = groupByCluster(sparks, clusters)
    .map((g) => ({ ...g, cards: g.sparks.filter((s) => visibleIds.has(s.id)) }))
    .filter((g) => g.cards.length > 0 || (g.cluster && g.sparks.length === 0));

  const renderGrid = (cards: SparkSnapshot[], emptyText: string) => (
    <div className="overview-page grid sm:grid-cols-2 lg:grid-cols-3" style={{ gap: "var(--density-page-gap)" }}>
      {cards.length === 0 && (
        <p className="panel p-6 text-sm text-muted sm:col-span-2 lg:col-span-3">{emptyText}</p>
      )}
      {cards.map((spark) => (
        <SparkCard
          key={spark.id}
          spark={spark}
          headSparkName={
            spark.workerHeadId
              ? sparks.find((s) => s.id === spark.workerHeadId)?.name ?? null
              : null
          }
          temperatureUnit={temperatureUnit}
          onSelect={onSelectSpark}
        />
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-overview-rhythm)" }}>
      {showFleetEnergy ? <FleetEnergyCard nodeCount={sparks.length} /> : null}
      {showFleetExceptions ? <FleetAlertStrip sparks={sparks} onSelect={onSelectSpark} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1
          className="font-normal leading-tight tracking-tight text-text-strong"
          style={{ fontSize: "var(--density-overview-title)" }}
        >
          Overview
        </h1>
        <div className="flex flex-wrap items-end justify-end gap-3">
          <BatchActions sparks={sparks} />
          {onEditCluster && (
            <button
              type="button"
              onClick={() => onEditCluster(null)}
              title="Group Sparks into a cluster"
              className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <PlusIcon className="h-3 w-3" />
              New cluster
            </button>
          )}
          <span className="online-chip">
            <span className="dot" />
            {onlineCount}/{visibleSparks.length} online
          </span>
          {hiddenWorkerCount > 0 && (
            <span className="text-[11px] text-muted">
              {hiddenWorkerCount} worker{hiddenWorkerCount === 1 ? "" : "s"} hidden
            </span>
          )}
        </div>
      </div>
      {showOverviewSearch ? (
      <div className="flex flex-wrap gap-2" role="search" aria-label="Filter fleet units">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search up to 12 units"
          aria-label="Search units by name"
          className="min-h-11 min-w-52 flex-1 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          aria-label="Filter units by status"
          className="min-h-11 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        >
          <option value="all">All status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="issues">Issues</option>
        </select>
      </div>
      ) : null}
      {clusters.length === 0 ? (
        renderGrid(visibleSparks, "No units match the current search and status filters.")
      ) : sections.length === 0 ? (
        renderGrid([], "No units match the current search and status filters.")
      ) : (
        sections.map((g) => (
          <section
            key={g.cluster?.id ?? "ungrouped"}
            className="flex flex-col"
            style={{ gap: "var(--density-page-gap)" }}
            aria-label={g.cluster ? `Cluster ${g.cluster.name}` : "Ungrouped Sparks"}
          >
            {g.cluster ? (
              <ClusterHeader cluster={g.cluster} members={g.sparks} onEdit={onEditCluster} />
            ) : (
              <h2 className="text-lg font-semibold text-text-strong">Ungrouped</h2>
            )}
            {renderGrid(g.cards, "No Sparks in this cluster yet. Edit it to add members.")}
          </section>
        ))
      )}
    </div>
  );
}
