const TOKEN_KEY = "sparkdashToken";

// Storage can throw (blocked site data, some private modes); treat that as no token.
export function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function storeToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* the prompt reappears after reload */
  }
}

type TokenRequest = "idle" | "open" | "dismissed";

let request: TokenRequest = "idle";
const listeners = new Set<() => void>();

function setRequest(next: TokenRequest) {
  if (request === next) return;
  request = next;
  listeners.forEach((listener) => listener());
}

/** Called on any 401. A dismissed prompt stays closed until reload so background retries cannot nag. */
export function requestToken(): void {
  if (request === "idle") setRequest("open");
}

export function dismissTokenRequest(): void {
  setRequest("dismissed");
}

export function isTokenRequested(): boolean {
  return request === "open";
}

export function subscribeTokenRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetTokenRequest(): void {
  request = "idle";
}
