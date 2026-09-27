import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { createCluster, deleteCluster, updateCluster } from "../api/client";
import type { Cluster, SparkSnapshot } from "../api/types";
import { useModalPresence } from "../hooks/useModalPresence";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ClusterDialogProps {
  open: boolean;
  /** null creates a new cluster. */
  cluster: Cluster | null;
  clusters: Cluster[];
  sparks: Pick<SparkSnapshot, "id" | "name" | "clusterId">[];
  onClose: () => void;
  onSaved: () => void;
}

export function ClusterDialog({ open, cluster, clusters, sparks, onClose, onSaved }: ClusterDialogProps) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);

  useEffect(() => {
    if (!open) return;
    setName(cluster?.name ?? "");
    setMembers(new Set(cluster?.sparkIds ?? []));
    setError(null);
    setBusy(false);
    // Reseed only on open / target change, not on every WS frame.
  }, [open, cluster?.id]);

  useEffect(() => {
    if (!open || busy) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, onClose]);

  if (!mounted) return null;

  const clusterName = (id: string | null | undefined) =>
    clusters.find((c) => c.id === id)?.name ?? null;

  const toggle = (id: string) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleSave = () => {
    const sparkIds = sparks.filter((s) => members.has(s.id)).map((s) => s.id);
    void run(() =>
      cluster
        ? updateCluster(cluster.id, { name: name.trim(), sparkIds })
        : createCluster({ name: name.trim(), sparkIds })
    );
  };

  const handleDelete = () => {
    if (!cluster) return;
    if (!confirm(`Delete cluster "${cluster.name}"? Its Sparks become ungrouped.`)) return;
    void run(() => deleteCluster(cluster.id));
  };

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        className="modal-sheet max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-sheet__header" id={titleId}>
          {cluster ? "Edit cluster" : "New cluster"}
        </div>

        <form
          className="modal-sheet__body space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor={`${titleId}-name`}>
              Name
            </label>
            <input
              id={`${titleId}-name`}
              type="text"
              autoFocus
              maxLength={64}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rack A"
              className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
          </div>

          <fieldset>
            <legend className="mb-1 text-xs text-muted">Members</legend>
            {sparks.length === 0 ? (
              <p className="text-xs text-muted">No Sparks registered.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-2">
                {sparks.map((s) => {
                  const other =
                    s.clusterId && s.clusterId !== cluster?.id ? clusterName(s.clusterId) : null;
                  return (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={members.has(s.id)}
                        disabled={busy}
                        onChange={() => toggle(s.id)}
                        className="rounded border-border"
                      />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {other && (
                        <span className="shrink-0 text-[10px] text-muted">
                          {members.has(s.id) ? `moves from ${other}` : `in ${other}`}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          {error && <p className="text-xs text-danger">{error}</p>}
          <button type="submit" hidden />
        </form>

        <div className="modal-sheet__footer">
          {cluster && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !name.trim()}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "Saving…" : cluster ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
