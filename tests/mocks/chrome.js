/**
 * Chrome extension API mock for tests.
 *
 * Provides configurable mocks for chrome.runtime, chrome.storage, and chrome.action.
 */

const storage = new Map();

const messagingResponders = new Map();

const chrome = {
  runtime: {
    sendMessage: vi.fn(async (message) => {
      const responder = messagingResponders.get(message.type);
      if (responder) return responder(message);
      return { ok: true };
    }),
    onMessage: {
      addListener: vi.fn(),
    },
    getURL: vi.fn((path) => `chrome-extension://fake-id/${path}`),
  },
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (typeof keys === "string") {
          const val = storage.get(keys);
          return val !== undefined ? { [keys]: val } : {};
        }
        const result = {};
        for (const k of Array.isArray(keys) ? keys : Object.keys(keys)) {
          if (storage.has(k)) result[k] = storage.get(k);
        }
        return result;
      }),
      set: vi.fn(async (items) => {
        for (const [k, v] of Object.entries(items)) {
          storage.set(k, v);
        }
      }),
      remove: vi.fn(async (keys) => {
        const list = typeof keys === "string" ? [keys] : keys;
        for (const k of list) storage.delete(k);
      }),
    },
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    sendMessage: vi.fn(async () => {}),
  },
};

// Expose on globalThis so extension code can access chrome.*
globalThis.chrome = chrome;

/**
 * Helper: set a responder for a specific message type.
 * Usage in tests:
 *   setMessageResponder("LOGIN", (msg) => ({ ok: true, user: msg.email }));
 */
export function setMessageResponder(type, fn) {
  messagingResponders.set(type, fn);
}

/**
 * Helper: clear all responders and storage between tests.
 */
export function resetChromeMock() {
  messagingResponders.clear();
  storage.clear();
  chrome.runtime.sendMessage.mockClear();
  chrome.runtime.onMessage.addListener.mockClear();
  chrome.runtime.getURL.mockClear();
  chrome.storage.local.get.mockClear();
  chrome.storage.local.set.mockClear();
  chrome.storage.local.remove.mockClear();
}

/**
 * Helper: directly set storage values for test setup.
 */
export function setStorageValue(key, value) {
  storage.set(key, value);
}

export { chrome };
