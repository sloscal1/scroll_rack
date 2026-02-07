import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetChromeMock, setStorageValue } from "../mocks/chrome.js";
import EchoAPI from "../../src/shared/echo-api.js";

describe("EchoAPI", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("login", () => {
    it("stores token and returns user on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: "abc123", user: "test@test.com" }),
      });

      const result = await EchoAPI.login("test@test.com", "password");

      expect(result.token).toBe("abc123");
      expect(result.user).toBe("test@test.com");
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ echoToken: "abc123" });
    });

    it("throws when no token in response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await expect(EchoAPI.login("a@b.com", "pass")).rejects.toThrow("No token");
    });
  });

  describe("getStoredToken", () => {
    it("returns stored token", async () => {
      setStorageValue("echoToken", "stored-token");
      const token = await EchoAPI.getStoredToken();
      expect(token).toBe("stored-token");
    });

    it("returns null when no token", async () => {
      const token = await EchoAPI.getStoredToken();
      expect(token).toBeNull();
    });
  });

  describe("logout", () => {
    it("removes token from storage", async () => {
      await EchoAPI.logout();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith("echoToken");
    });
  });

  describe("retry logic", () => {
    it("retries on 429 with backoff", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 429 });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: "ok" }),
        });
      });

      await EchoAPI.searchSets("test", "token123");
      expect(callCount).toBe(2);
    }, 15000);

    it("retries on 500 server error", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: "ok" }),
        });
      });

      await EchoAPI.searchSets("test", "token123");
      expect(callCount).toBe(2);
    }, 15000);

    it("throws immediately on 4xx (non-429)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(EchoAPI.searchSets("test", "token123")).rejects.toThrow("HTTP 403");
    }, 15000);

    it("throws after exhausting retries on network error", async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.reject(new TypeError("Failed to fetch"));
      });

      await expect(EchoAPI.searchSets("test", "token123")).rejects.toThrow("Failed to fetch");
    }, 15000);
  });
});
