import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenPrompt } from "./TokenPrompt";
import { authHeaders, fetchSparks } from "../api/client";
import { _resetTokenRequest } from "../api/token";
import { useSnapshot } from "../hooks/useSnapshot";
import { flush, render } from "../testing/render";

const reload = vi.fn();
const fetchMock = vi.fn();

function unauthorized() {
  return { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: "Authentication required" }) };
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
}

function tokenInput() {
  return dialog()!.querySelector<HTMLInputElement>('input[type="password"]')!;
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function hitUnauthorizedApi() {
  fetchMock.mockResolvedValue(unauthorized());
  await act(async () => {
    await fetchSparks().catch(() => undefined);
  });
}

class ClosingSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: ClosingSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    ClosingSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function SnapshotProbe() {
  useSnapshot();
  return null;
}

describe("TokenPrompt", () => {
  beforeEach(() => {
    _resetTokenRequest();
    localStorage.clear();
    ClosingSocket.instances = [];
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { protocol: "http:", host: "localhost:5555", reload },
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("stays hidden until the API answers 401", async () => {
    render(<TokenPrompt />);
    expect(dialog()).toBeNull();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sparks: [] }) });
    await act(async () => {
      await fetchSparks();
    });
    expect(dialog()).toBeNull();
  });

  it("asks for the token on 401, stores it, reloads, and sends it afterwards", async () => {
    render(<TokenPrompt />);
    await hitUnauthorizedApi();
    expect(dialog()?.textContent).toContain("Access token required");
    expect(button("Save & reload").disabled).toBe(true);
    expect(document.activeElement).toBe(tokenInput());

    typeInto(tokenInput(), "  s3cret  ");
    act(() => button("Save & reload").click());

    expect(localStorage.getItem("sparkdashToken")).toBe("s3cret");
    expect(reload).toHaveBeenCalledOnce();
    expect(authHeaders()).toEqual({ Authorization: "Bearer s3cret" });
  });

  it("offers an empty field and a way to forget a rejected stored token", async () => {
    localStorage.setItem("sparkdashToken", "stale");
    render(<TokenPrompt />);
    await hitUnauthorizedApi();
    expect(dialog()?.textContent).toContain("rejected the saved token");
    expect(tokenInput().value).toBe("");

    act(() => button("Forget saved token").click());
    expect(localStorage.getItem("sparkdashToken")).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays dismissed after Escape so background retries do not reopen it", async () => {
    render(<TokenPrompt />);
    await hitUnauthorizedApi();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await hitUnauthorizedApi();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(dialog()).toBeNull();
  });

  it("opens when the WebSocket cannot connect and the API probe returns 401", async () => {
    vi.stubGlobal("WebSocket", ClosingSocket);
    fetchMock.mockResolvedValue(unauthorized());
    localStorage.setItem("sparkdashToken", "a b");
    render(
      <>
        <SnapshotProbe />
        <TokenPrompt />
      </>
    );
    expect(ClosingSocket.instances[0].url).toBe("ws://localhost:5555/ws?token=a%20b");

    act(() => ClosingSocket.instances[0].close());
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ headers: { Authorization: "Bearer a b" } }));
    expect(dialog()?.textContent).toContain("Access token required");
  });
});
