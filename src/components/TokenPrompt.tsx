import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  dismissTokenRequest,
  isTokenRequested,
  readStoredToken,
  storeToken,
  subscribeTokenRequest,
} from "../api/token";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalPresence } from "../hooks/useModalPresence";

function saveAndReload(token: string) {
  storeToken(token);
  window.location.reload();
}

/** Shown after the server answers 401; stores the token for API and WebSocket auth. */
export function TokenPrompt() {
  const open = useSyncExternalStore(subscribeTokenRequest, isTokenRequested);
  const [token, setToken] = useState("");
  const titleId = useId();
  const formId = useId();
  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);
  const hasStoredToken = Boolean(readStoredToken());

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissTokenRequest();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!mounted) return null;

  const trimmed = token.trim();

  return createPortal(
    <div className={`modal-overlay${visible ? " is-open" : ""}`}>
      <div
        ref={trapRef}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-sheet__header" id={titleId}>
          Access token required
        </div>

        <form
          id={formId}
          className="modal-sheet__body space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) saveAndReload(trimmed);
          }}
        >
          <p className="text-xs leading-relaxed text-muted">
            {hasStoredToken
              ? "The server rejected the saved token. Enter the current SPARKDASH_TOKEN."
              : "This server requires its SPARKDASH_TOKEN. It is saved in this browser only."}
          </p>
          <div>
            <label htmlFor={`${formId}-token`} className="mb-1 block text-xs text-muted">
              Access token
            </label>
            <input
              id={`${formId}-token`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded border border-border bg-surface-elevated px-3 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
            />
          </div>
        </form>

        <div className="modal-sheet__footer">
          {hasStoredToken && (
            <button
              type="button"
              onClick={() => saveAndReload("")}
              className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
            >
              Forget saved token
            </button>
          )}
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={dismissTokenRequest}
              className="rounded border border-border bg-surface-elevated px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              disabled={!trimmed}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Save &amp; reload
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
