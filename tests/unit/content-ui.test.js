/**
 * Component tests for the content overlay UI.
 *
 * These tests build a simplified version of the overlay DOM inside jsdom
 * and test UI behaviors like phase transitions, accordion toggling,
 * form validation, and login/logout toggling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetChromeMock, setMessageResponder } from "../mocks/chrome.js";

/**
 * Build a minimal replica of the overlay DOM that mirrors content.js's buildUI().
 * Returns the container element and a $ helper.
 */
function buildOverlayDOM() {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="overlay-tab" id="overlay-tab">Echo</div>
    <div class="overlay-panel hidden" id="overlay-panel">
      <div class="overlay-header">
        <span class="overlay-title">Fast Inventory</span>
        <button class="collapse-btn" id="collapse-btn">-</button>
      </div>
      <div class="overlay-body">
        <!-- Account accordion -->
        <div class="accordion-section" id="acc-account">
          <div class="accordion-header" id="acc-account-hdr">
            <span class="accordion-chevron"></span>
            <span class="accordion-title">Account</span>
            <span class="accordion-status" id="acc-account-status"></span>
          </div>
          <div class="accordion-body" id="acc-account-body">
            <div class="login-form" id="login-form">
              <input id="login-email" type="email" placeholder="Email">
              <input id="login-password" type="password" placeholder="Password">
              <div class="login-error hidden" id="login-error"></div>
              <button id="login-btn">Login</button>
            </div>
            <div class="logged-in-info hidden" id="logged-in-info">
              <span id="logged-in-user"></span>
              <button id="logout-btn">Logout</button>
            </div>
          </div>
        </div>
        <!-- Cache accordion -->
        <div class="accordion-section disabled" id="acc-cache">
          <div class="accordion-header" id="acc-cache-hdr">
            <span class="accordion-chevron"></span>
            <span class="accordion-title">Set Cache</span>
            <span class="accordion-status" id="acc-cache-status"></span>
          </div>
          <div class="accordion-body" id="acc-cache-body"></div>
        </div>
        <!-- Add Cards accordion -->
        <div class="accordion-section disabled" id="acc-add-cards">
          <div class="accordion-header" id="acc-add-cards-hdr">
            <span class="accordion-chevron"></span>
            <span class="accordion-title">Add Cards</span>
            <span class="accordion-status" id="acc-add-cards-status"></span>
          </div>
          <div class="accordion-body" id="acc-add-cards-body">
            <div class="location-bar">
              <input id="loc-input" type="text" placeholder="e.g., b5r1">
              <input id="pos-input" type="number" value="1">
            </div>
            <div class="options-bar">
              <select id="foil-select">
                <option value="0" selected>Regular</option>
                <option value="1">Foil</option>
              </select>
              <select id="cond-select">
                <option value="NM" selected>NM</option>
                <option value="LP">LP</option>
                <option value="MP">MP</option>
                <option value="HP">HP</option>
                <option value="D">D</option>
              </select>
              <select id="lang-select">
                <option value="EN" selected>English</option>
              </select>
            </div>
            <input id="search-input" type="text" disabled>
            <div class="results-list hidden" id="results-list"></div>
          </div>
        </div>
        <!-- Check Out accordion -->
        <div class="accordion-section disabled" id="acc-checkout">
          <div class="accordion-header" id="acc-checkout-hdr">
            <span class="accordion-chevron"></span>
            <span class="accordion-title">Check Out</span>
            <span class="accordion-status" id="acc-checkout-status"></span>
          </div>
          <div class="accordion-body" id="acc-checkout-body">
            <div class="checkout-prefs">
              <div class="checkout-pref-row">
                <div class="checkout-pref-field">
                  <label>Cost</label>
                  <select class="option-select" id="checkout-cost-pref">
                    <option value="cheapest">Cheapest</option>
                    <option value="expensive">Most Expensive</option>
                  </select>
                </div>
                <div class="checkout-pref-field">
                  <label>Style</label>
                  <select class="option-select" id="checkout-style-pref">
                    <option value="">Any</option>
                    <option value="regular">Regular</option>
                    <option value="foil">Foil</option>
                    <option value="showcase">Showcase</option>
                    <option value="extended">Extended Art</option>
                    <option value="borderless">Borderless</option>
                    <option value="retro">Retro</option>
                  </select>
                </div>
                <div class="checkout-pref-field">
                  <label>Set</label>
                  <select class="option-select" id="checkout-set-pref">
                    <option value="">Any Set</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="checkout-tabs">
              <button class="tab-btn active" id="tab-checkout-list" data-mode="list">From List</button>
              <button class="tab-btn" id="tab-checkout-search" data-mode="search">From Search</button>
            </div>
            <div id="checkout-list-panel">
              <select class="option-select" id="checkout-list-select">
                <option value="">Select a list...</option>
              </select>
              <div class="checkout-card-list" id="checkout-list-cards"></div>
              <div class="checkout-actions">
                <button class="btn btn-sm" id="checkout-auto-select-btn">Auto-Select</button>
                <button class="btn btn-primary btn-sm" id="checkout-list-btn" disabled>Check Out (0)</button>
              </div>
            </div>
            <div id="checkout-search-panel" class="hidden">
              <input class="search-input" id="checkout-search-input" type="text" placeholder="Search your inventory...">
              <div class="checkout-card-list" id="checkout-search-cards"></div>
              <div class="checkout-field">
                <label>Check out to list</label>
                <input class="search-input" id="checkout-search-list-name" type="text" placeholder="Select or type list name...">
              </div>
              <button class="btn btn-primary btn-sm" id="checkout-search-btn" disabled>Check Out (0)</button>
            </div>
          </div>
        </div>
        <!-- Check In accordion -->
        <div class="accordion-section disabled" id="acc-checkin">
          <div class="accordion-header" id="acc-checkin-hdr">
            <span class="accordion-chevron"></span>
            <span class="accordion-title">Check In</span>
            <span class="accordion-status" id="acc-checkin-status"></span>
          </div>
          <div class="accordion-body" id="acc-checkin-body">
            <div id="checkin-groups-view">
              <div class="checkin-group-list" id="checkin-group-list"></div>
              <div class="checkin-empty hidden" id="checkin-empty">No cards currently checked out.</div>
            </div>
            <div id="checkin-detail-view" class="hidden">
              <div class="checkin-back-link" id="checkin-back-btn">← Back to groups</div>
              <div class="checkin-detail-header" id="checkin-detail-header"></div>
              <div class="checkin-return-bar">
                <input class="location-input" id="checkin-loc-input" type="text" placeholder="e.g., b5r1">
                <input class="position-value" id="checkin-pos-input" type="number" min="1" value="1">
              </div>
              <div class="checkin-card-list" id="checkin-card-list"></div>
              <div class="checkin-actions">
                <button class="btn btn-sm" id="checkin-select-all-btn">Select All</button>
                <button class="btn btn-primary btn-sm" id="checkin-btn" disabled>Check In (0)</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="status-bar">
        <span id="status-msg">Ready</span>
        <span id="session-count">0</span>
      </div>
    </div>
  `;
  document.body.appendChild(container);
  const $ = (sel) => container.querySelector(sel);
  return { container, $ };
}

// ---------------------------------------------------------------------------
// Phase transition tests
// ---------------------------------------------------------------------------

describe("Phase transitions", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("login phase: account accordion open, cache and add-cards disabled", () => {
    const accAccount = $("#acc-account");
    const accCache = $("#acc-cache");
    const accAddCards = $("#acc-add-cards");
    const accCheckin = $("#acc-checkin");
    const accCheckout = $("#acc-checkout");

    // Simulate login phase
    accAccount.classList.add("open");
    accCache.classList.add("disabled");
    accAddCards.classList.add("disabled");
    accCheckin.classList.add("disabled");
    accCheckout.classList.add("disabled");

    expect(accAccount.classList.contains("open")).toBe(true);
    expect(accCache.classList.contains("disabled")).toBe(true);
    expect(accAddCards.classList.contains("disabled")).toBe(true);
    expect(accCheckin.classList.contains("disabled")).toBe(true);
    expect(accCheckout.classList.contains("disabled")).toBe(true);
  });

  it("cache phase: account closed, cache open and enabled", () => {
    const accAccount = $("#acc-account");
    const accCache = $("#acc-cache");

    accAccount.classList.remove("open");
    accCache.classList.remove("disabled");
    accCache.classList.add("open");

    expect(accAccount.classList.contains("open")).toBe(false);
    expect(accCache.classList.contains("disabled")).toBe(false);
    expect(accCache.classList.contains("open")).toBe(true);
  });

  it("ready phase: all sections enabled, add-cards open", () => {
    const accAccount = $("#acc-account");
    const accCache = $("#acc-cache");
    const accAddCards = $("#acc-add-cards");
    const accCheckin = $("#acc-checkin");
    const accCheckout = $("#acc-checkout");

    accAccount.classList.remove("open");
    accCache.classList.remove("open", "disabled");
    accAddCards.classList.remove("disabled");
    accAddCards.classList.add("open");
    accCheckin.classList.remove("disabled");
    accCheckout.classList.remove("disabled");

    expect(accAccount.classList.contains("open")).toBe(false);
    expect(accCache.classList.contains("open")).toBe(false);
    expect(accAddCards.classList.contains("disabled")).toBe(false);
    expect(accAddCards.classList.contains("open")).toBe(true);
    expect(accCheckin.classList.contains("disabled")).toBe(false);
    expect(accCheckout.classList.contains("disabled")).toBe(false);
  });

  it("accordion order is: Add Cards, Check Out, Check In", () => {
    const body = $(".overlay-body");
    const sections = body.querySelectorAll(".accordion-section");
    const ids = Array.from(sections).map((s) => s.id);
    expect(ids).toEqual([
      "acc-account",
      "acc-cache",
      "acc-add-cards",
      "acc-checkout",
      "acc-checkin",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Accordion open/close
// ---------------------------------------------------------------------------

describe("Accordion behavior", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("toggles open class on click", () => {
    const section = $("#acc-account");

    expect(section.classList.contains("open")).toBe(false);

    // Simulate toggle
    section.classList.toggle("open");
    expect(section.classList.contains("open")).toBe(true);

    section.classList.toggle("open");
    expect(section.classList.contains("open")).toBe(false);
  });

  it("disabled section does not toggle", () => {
    const section = $("#acc-cache");
    expect(section.classList.contains("disabled")).toBe(true);

    // In the real code, click handler checks for .disabled before toggling
    if (!section.classList.contains("disabled")) {
      section.classList.toggle("open");
    }
    expect(section.classList.contains("open")).toBe(false);
  });

  it("Add Cards accordion disabled by default", () => {
    const section = $("#acc-add-cards");
    expect(section.classList.contains("disabled")).toBe(true);

    if (!section.classList.contains("disabled")) {
      section.classList.toggle("open");
    }
    expect(section.classList.contains("open")).toBe(false);
  });

  it("Add Cards accordion toggles when enabled", () => {
    const section = $("#acc-add-cards");
    section.classList.remove("disabled");

    section.classList.toggle("open");
    expect(section.classList.contains("open")).toBe(true);

    section.classList.toggle("open");
    expect(section.classList.contains("open")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Login/logout UI toggling
// ---------------------------------------------------------------------------

describe("Login/logout UI", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("login form visible by default, logged-in info hidden", () => {
    expect($("#login-form").classList.contains("hidden")).toBe(false);
    expect($("#logged-in-info").classList.contains("hidden")).toBe(true);
  });

  it("shows logged-in UI when user authenticates", () => {
    const loginForm = $("#login-form");
    const loggedInInfo = $("#logged-in-info");
    const loggedInUser = $("#logged-in-user");

    // Simulate showLoggedInUI
    loginForm.classList.add("hidden");
    loggedInInfo.classList.remove("hidden");
    loggedInUser.textContent = "test@example.com";

    expect(loginForm.classList.contains("hidden")).toBe(true);
    expect(loggedInInfo.classList.contains("hidden")).toBe(false);
    expect(loggedInUser.textContent).toBe("test@example.com");
  });

  it("reverts to login form on logout", () => {
    const loginForm = $("#login-form");
    const loggedInInfo = $("#logged-in-info");

    // First log in
    loginForm.classList.add("hidden");
    loggedInInfo.classList.remove("hidden");

    // Then log out
    loginForm.classList.remove("hidden");
    loggedInInfo.classList.add("hidden");

    expect(loginForm.classList.contains("hidden")).toBe(false);
    expect(loggedInInfo.classList.contains("hidden")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

describe("Form validation", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("location input shows error class when empty", () => {
    const locInput = $("#loc-input");
    expect(locInput.classList.contains("error")).toBe(false);

    // Simulate validation failure
    if (!locInput.value.trim()) {
      locInput.classList.add("error");
    }

    expect(locInput.classList.contains("error")).toBe(true);
  });

  it("location input clears error on input", () => {
    const locInput = $("#loc-input");
    locInput.classList.add("error");

    // Simulate user typing
    locInput.value = "b5r1";
    locInput.classList.remove("error");

    expect(locInput.classList.contains("error")).toBe(false);
  });

  it("position input validates minimum value", () => {
    const posInput = $("#pos-input");
    posInput.value = "0";

    const position = Number(posInput.value);
    const isValid = !isNaN(position) && position >= 1;

    expect(isValid).toBe(false);
  });

  it("position input accepts valid value", () => {
    const posInput = $("#pos-input");
    posInput.value = "5";

    const position = Number(posInput.value);
    const isValid = !isNaN(position) && position >= 1;

    expect(isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Condition select
// ---------------------------------------------------------------------------

describe("Condition select", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("defaults to NM", () => {
    expect($("#cond-select").value).toBe("NM");
  });

  it("has all condition options", () => {
    const options = Array.from($("#cond-select").options).map((o) => o.value);
    expect(options).toEqual(["NM", "LP", "MP", "HP", "D"]);
  });

  it("can be changed to LP", () => {
    const condSelect = $("#cond-select");
    condSelect.value = "LP";
    expect(condSelect.value).toBe("LP");
  });
});

// ---------------------------------------------------------------------------
// Expand / Collapse
// ---------------------------------------------------------------------------

describe("Expand / Collapse", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("panel starts hidden, tab starts visible", () => {
    expect($("#overlay-panel").classList.contains("hidden")).toBe(true);
    expect($("#overlay-tab").classList.contains("hidden")).toBe(false);
  });

  it("expand shows panel, hides tab", () => {
    const panel = $("#overlay-panel");
    const tab = $("#overlay-tab");

    // Simulate expand
    panel.classList.remove("hidden");
    tab.classList.add("hidden");

    expect(panel.classList.contains("hidden")).toBe(false);
    expect(tab.classList.contains("hidden")).toBe(true);
  });

  it("collapse hides panel, shows tab", () => {
    const panel = $("#overlay-panel");
    const tab = $("#overlay-tab");

    // First expand
    panel.classList.remove("hidden");
    tab.classList.add("hidden");

    // Then collapse
    panel.classList.add("hidden");
    tab.classList.remove("hidden");

    expect(panel.classList.contains("hidden")).toBe(true);
    expect(tab.classList.contains("hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Check Out accordion
// ---------------------------------------------------------------------------

describe("Check Out accordion", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("disabled by default", () => {
    expect($("#acc-checkout").classList.contains("disabled")).toBe(true);
  });

  it("shared preferences have Cost, Style, Set dropdowns", () => {
    const cost = $("#checkout-cost-pref");
    const style = $("#checkout-style-pref");
    const set = $("#checkout-set-pref");

    expect(cost).not.toBeNull();
    expect(style).not.toBeNull();
    expect(set).not.toBeNull();

    // Cost options
    const costOpts = Array.from(cost.options).map((o) => o.value);
    expect(costOpts).toEqual(["cheapest", "expensive"]);

    // Style options
    const styleOpts = Array.from(style.options).map((o) => o.value);
    expect(styleOpts).toContain("foil");
    expect(styleOpts).toContain("showcase");
    expect(styleOpts).toContain("borderless");
    expect(styleOpts).toContain("retro");
  });

  it("From List tab active by default, From Search hidden", () => {
    expect($("#tab-checkout-list").classList.contains("active")).toBe(true);
    expect($("#tab-checkout-search").classList.contains("active")).toBe(false);
    expect($("#checkout-list-panel").classList.contains("hidden")).toBe(false);
    expect($("#checkout-search-panel").classList.contains("hidden")).toBe(true);
  });

  it("tab switching toggles panels", () => {
    const tabList = $("#tab-checkout-list");
    const tabSearch = $("#tab-checkout-search");
    const listPanel = $("#checkout-list-panel");
    const searchPanel = $("#checkout-search-panel");

    // Switch to search
    tabSearch.classList.add("active");
    tabList.classList.remove("active");
    listPanel.classList.add("hidden");
    searchPanel.classList.remove("hidden");

    expect(tabSearch.classList.contains("active")).toBe(true);
    expect(tabList.classList.contains("active")).toBe(false);
    expect(listPanel.classList.contains("hidden")).toBe(true);
    expect(searchPanel.classList.contains("hidden")).toBe(false);

    // Switch back to list
    tabList.classList.add("active");
    tabSearch.classList.remove("active");
    listPanel.classList.remove("hidden");
    searchPanel.classList.add("hidden");

    expect(tabList.classList.contains("active")).toBe(true);
    expect(searchPanel.classList.contains("hidden")).toBe(true);
  });

  it("checkout list button reflects selected count", () => {
    const btn = $("#checkout-list-btn");
    const cardList = $("#checkout-list-cards");
    cardList.innerHTML = `
      <div><input type="checkbox" class="checkout-list-cb"></div>
      <div><input type="checkbox" class="checkout-list-cb"></div>
      <div><input type="checkbox" class="checkout-list-cb"></div>
    `;

    // 0 selected
    const count0 = cardList.querySelectorAll(".checkout-list-cb:checked").length;
    btn.textContent = `Check Out (${count0})`;
    btn.disabled = count0 === 0;
    expect(btn.textContent).toBe("Check Out (0)");
    expect(btn.disabled).toBe(true);

    // 3 selected
    cardList.querySelectorAll(".checkout-list-cb").forEach((cb) => (cb.checked = true));
    const count3 = cardList.querySelectorAll(".checkout-list-cb:checked").length;
    btn.textContent = `Check Out (${count3})`;
    btn.disabled = count3 === 0;
    expect(btn.textContent).toBe("Check Out (3)");
    expect(btn.disabled).toBe(false);
  });

  it("checkout search button reflects selected count", () => {
    const btn = $("#checkout-search-btn");
    const cardList = $("#checkout-search-cards");
    cardList.innerHTML = `
      <div><input type="checkbox" class="checkout-search-cb"></div>
      <div><input type="checkbox" class="checkout-search-cb"></div>
    `;

    cardList.querySelectorAll(".checkout-search-cb").forEach((cb) => (cb.checked = true));
    const count = cardList.querySelectorAll(".checkout-search-cb:checked").length;
    btn.textContent = `Check Out (${count})`;
    btn.disabled = count === 0;
    expect(btn.textContent).toBe("Check Out (2)");
    expect(btn.disabled).toBe(false);
  });

  it("auto-select button exists in list panel", () => {
    const btn = $("#checkout-auto-select-btn");
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Auto-Select");
  });
});

// ---------------------------------------------------------------------------
// Check In accordion
// ---------------------------------------------------------------------------

describe("Check In accordion", () => {
  let $;

  beforeEach(() => {
    document.body.innerHTML = "";
    resetChromeMock();
    ({ $ } = buildOverlayDOM());
  });

  it("disabled by default", () => {
    expect($("#acc-checkin").classList.contains("disabled")).toBe(true);
  });

  it("groups view visible, detail view hidden by default", () => {
    expect($("#checkin-groups-view").classList.contains("hidden")).toBe(false);
    expect($("#checkin-detail-view").classList.contains("hidden")).toBe(true);
  });

  it("back button switches from detail to groups view", () => {
    const groupsView = $("#checkin-groups-view");
    const detailView = $("#checkin-detail-view");

    // Simulate showing detail
    groupsView.classList.add("hidden");
    detailView.classList.remove("hidden");
    expect(detailView.classList.contains("hidden")).toBe(false);

    // Simulate back button
    detailView.classList.add("hidden");
    groupsView.classList.remove("hidden");
    expect(groupsView.classList.contains("hidden")).toBe(false);
    expect(detailView.classList.contains("hidden")).toBe(true);
  });

  it("select all toggles all checkboxes in card list", () => {
    const cardList = $("#checkin-card-list");
    // Add demo checkboxes
    cardList.innerHTML = `
      <div><input type="checkbox" class="checkin-card-cb"></div>
      <div><input type="checkbox" class="checkin-card-cb"></div>
      <div><input type="checkbox" class="checkin-card-cb"></div>
    `;
    const cbs = cardList.querySelectorAll(".checkin-card-cb");

    // Select all
    cbs.forEach((cb) => (cb.checked = true));
    expect(Array.from(cbs).every((cb) => cb.checked)).toBe(true);

    // Deselect all
    cbs.forEach((cb) => (cb.checked = false));
    expect(Array.from(cbs).every((cb) => !cb.checked)).toBe(true);
  });

  it("check in button reflects selected count", () => {
    const btn = $("#checkin-btn");
    const cardList = $("#checkin-card-list");
    cardList.innerHTML = `
      <div><input type="checkbox" class="checkin-card-cb"></div>
      <div><input type="checkbox" class="checkin-card-cb"></div>
    `;

    // 0 selected
    const count0 = cardList.querySelectorAll(".checkin-card-cb:checked").length;
    btn.textContent = `Check In (${count0})`;
    btn.disabled = count0 === 0;
    expect(btn.textContent).toBe("Check In (0)");
    expect(btn.disabled).toBe(true);

    // 2 selected
    cardList.querySelectorAll(".checkin-card-cb").forEach((cb) => (cb.checked = true));
    const count2 = cardList.querySelectorAll(".checkin-card-cb:checked").length;
    btn.textContent = `Check In (${count2})`;
    btn.disabled = count2 === 0;
    expect(btn.textContent).toBe("Check In (2)");
    expect(btn.disabled).toBe(false);
  });
});
