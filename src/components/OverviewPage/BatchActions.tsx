import { useEffect, useState } from "react";
import type { SparkSnapshot } from "../../api/types";
import { shutdownAllSparks, updateAllHermes, wakeAllSparks } from "../../api/client";
import { ConfirmShutdownDialog } from "../ConfirmShutdownDialog";
import { PowerOffIcon, PowerOnIcon, RotateIcon } from "../ui/icons";

/**
 * Wake / Shutdown / Update Hermes for the whole fleet, or for one cluster when
 * `cluster` is given. `sparks` must be exactly the Sparks the server will target.
 */
export function BatchActions({
  sparks,
  cluster,
}: {
  sparks: SparkSnapshot[];
  cluster?: { id: string; name: string };
}) {
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMsg, setBatchMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  /** Spark ids we started a batch Hermes update on; drives the live progress bar. */
  const [batchRun, setBatchRun] = useState<string[] | null>(null);

  const onlineShutdownCount = sparks.filter((s) => s.online).length;
  const hermesMonitoredCount = sparks.filter((s) => s.hermes?.monitoring).length;
  const hermesPendingUpdateCount = sparks.filter((s) => s.hermes?.updateAvailable === true).length;
  const scope = cluster ? ` in ${cluster.name}` : "";

  // Live batch progress — counted from WS snapshots, not from the one-shot HTTP response.
  const batchProg = (() => {
    if (!batchRun || batchRun.length === 0) return null;
    let done = 0;
    let failed = 0;
    for (const id of batchRun) {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) continue;
      if (h.status === "error") {
        done += 1;
        failed += 1;
      } else if (h.status === "success" || h.finishedAt != null) {
        done += 1;
      }
    }
    return { total: batchRun.length, done, failed };
  })();

  // Once every started update has settled (success/error), dismiss the progress bar.
  useEffect(() => {
    if (!batchRun || batchRun.length === 0) return;
    const settled = batchRun.reduce((n, id) => {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) return n;
      return n + (h.status === "success" || h.status === "error" || h.finishedAt != null ? 1 : 0);
    }, 0);
    if (settled === batchRun.length) {
      const t = setTimeout(() => setBatchRun(null), 6000);
      return () => clearTimeout(t);
    }
  }, [batchRun, sparks]);

  async function runBatch(fallbackError: string, action: () => Promise<void>) {
    setBatchLoading(true);
    setBatchMsg(null);
    try {
      await action();
    } catch (err: unknown) {
      setBatchMsg({ text: err instanceof Error ? err.message : fallbackError, tone: "err" });
    } finally {
      setBatchLoading(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  }

  const handleUpdateAllHermes = () =>
    runBatch("Batch hermes update failed", async () => {
      const res = await updateAllHermes(cluster?.id);
      const started = res.results.filter((r) => r.started);
      const skipped = res.results.filter((r) => r.skipped).length;
      const failed = res.results.filter((r) => !r.ok && !r.skipped).length;
      const parts = [`${started.length} update${started.length === 1 ? "" : "s"} started`];
      if (skipped) parts.push(`${skipped} skipped`);
      if (failed) parts.push(`${failed} failed`);
      setBatchMsg({ text: parts.join(", "), tone: failed === 0 ? "ok" : "err" });
      // Merge with any in-flight batch instead of replacing (server may skip
      // already-running jobs, which must not clear a live progress bar).
      setBatchRun((prev) => {
        const ids = started.map((r) => r.id);
        if (ids.length === 0) return prev;
        return [...new Set([...(prev ?? []), ...ids])];
      });
    });

  const handleShutdownAll = () =>
    runBatch("Batch shutdown failed", async () => {
      const res = await shutdownAllSparks(cluster?.id);
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok && !r.skipped).length;
      const skipped = res.results.filter((r) => r.skipped).length;
      const parts = [`${ok} shut down`];
      if (fail) parts.push(`${fail} failed`);
      if (skipped) parts.push(`${skipped} skipped`);
      setBatchMsg({ text: parts.join(", "), tone: fail === 0 ? "ok" : "err" });
    });

  const handleWakeAll = () =>
    runBatch("Batch wake failed", async () => {
      const res = await wakeAllSparks(cluster?.id);
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok).length;
      setBatchMsg({
        text: fail === 0 ? `${ok} wake packet(s) sent` : `${ok} sent, ${fail} failed`,
        tone: fail === 0 ? "ok" : "err",
      });
    });

  if (sparks.length === 0) return null;

  return (
    <>
      {batchMsg && (
        <span className={`text-[11px] ${batchMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
          {batchMsg.text}
        </span>
      )}
      {batchProg && (
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <RotateIcon className="h-3 w-3" />
            Updating Hermes — {batchProg.done}/{batchProg.total}
            {batchProg.failed > 0 && <span className="text-danger">({batchProg.failed} failed)</span>}
            <button
              type="button"
              onClick={() => setBatchRun(null)}
              aria-label="Dismiss update progress"
              title="Dismiss"
              className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <span className="text-xs leading-none">✕</span>
            </button>
          </span>
          <div className="h-1 w-36 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                batchProg.failed > 0 ? "bg-danger" : "bg-accent"
              }`}
              style={{
                width: `${batchProg.total > 0 ? Math.round((batchProg.done / batchProg.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {hermesMonitoredCount > 0 && (
          <button
            type="button"
            onClick={() => void handleUpdateAllHermes()}
            disabled={batchLoading}
            title={`Run \`hermes update\` on every Spark${scope} with Hermes Agent enabled`}
            className={`flex items-center gap-1 rounded-md border bg-surface-elevated px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
              hermesPendingUpdateCount > 0
                ? "border-warning/40 text-warning hover:bg-warning/15"
                : "border-border text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            <RotateIcon className="h-3 w-3" />
            Update Hermes
            {hermesPendingUpdateCount > 0 && (
              <span
                className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-white"
                title={`${hermesPendingUpdateCount} Spark${hermesPendingUpdateCount === 1 ? "" : "s"} with a Hermes update available`}
              >
                {hermesPendingUpdateCount}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleWakeAll()}
          disabled={batchLoading}
          title={`Wake all Sparks${scope} that have a MAC configured (WoL)`}
          className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-muted hover:bg-success/20 hover:text-success transition-colors disabled:opacity-50"
        >
          <PowerOnIcon className="h-3 w-3" />
          {cluster ? "Wake" : "Wake All"}
        </button>
        <button
          type="button"
          onClick={() => setShutdownOpen(true)}
          disabled={batchLoading || onlineShutdownCount === 0}
          title={`Shut down all online Sparks${scope}`}
          className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:bg-danger/20 hover:text-danger disabled:opacity-50"
        >
          <PowerOffIcon className="h-3 w-3" />
          {cluster ? "Shutdown" : "Shutdown All"}
        </button>
      </div>
      <ConfirmShutdownDialog
        open={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdownAll}
        title={cluster ? `Shutdown ${cluster.name}` : "Shutdown All"}
        description={`Gracefully shut down ${cluster ? "" : "all "}${onlineShutdownCount} online Spark${onlineShutdownCount === 1 ? "" : "s"}${scope}? Offline nodes will be skipped.`}
        confirmLabel={cluster ? "Shut down cluster" : "Shut down all"}
      />
    </>
  );
}
