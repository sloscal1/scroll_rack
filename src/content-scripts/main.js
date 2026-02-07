/**
 * Content script — in-page overlay for rapid card inventory entry.
 *
 * Injected into echomtg.com pages. All UI lives inside a Shadow DOM root
 * to isolate styles from the host page.
 *
 * Flow state machine: login → cache → ready
 */

// ---------------------------------------------------------------------------
// Shadow DOM setup
// ---------------------------------------------------------------------------

const HOST = document.createElement("div");
HOST.id = "echomtg-fast-inventory";
document.body.appendChild(HOST);

const shadow = HOST.attachShadow({ mode: "closed" });

const styleLink = document.createElement("link");
styleLink.rel = "stylesheet";
styleLink.href = chrome.runtime.getURL("assets/content.css");
shadow.appendChild(styleLink);

// ---------------------------------------------------------------------------
// Known sets — loaded asynchronously via service worker
// ---------------------------------------------------------------------------

let KNOWN_SETS = [];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RARITY_CODES = { "Mythic Rare": "M", Rare: "R", Uncommon: "U", Common: "C" };

// Flow phases
const PHASE_LOGIN = "login";
const PHASE_CACHE = "cache";
const PHASE_READY = "ready";

// ---------------------------------------------------------------------------
// Enhanced Search Index with Keyboard Navigation
// ---------------------------------------------------------------------------

class SetSearchIndex {
  constructor(sets) {
    // Fast lookup maps for performance
    this.setCodeMap = new Map(sets.map(s => [s.code, s]));
    this.nameIndex = new Map(sets.map(s => [s.name.toLowerCase(), s]));
    this.originalOrder = sets; // Preserve EchoMTG chronological order
  }
  
  search(query) {
    if (!query) return this.originalOrder;
    
    const q = query.toLowerCase().trim();
    const results = [];
    
    for (const set of this.originalOrder) {
      let score = 0;
      
      // Priority 1: Exact set code match (STA, FDN, etc.)
      if (set.code.toLowerCase() === q) {
        score = 100;
      }
      // Priority 2: Set code starts with query
      else if (set.code.toLowerCase().startsWith(q) && q.length >= 2) {
        score = 80;
      }
      // Priority 3: Name starts with query
      else if (set.name.toLowerCase().startsWith(q)) {
        score = 60;
      }
      // Priority 4: Name contains query
      else if (set.name.toLowerCase().includes(q)) {
        score = 40;
      }
      
      if (score > 0) {
        results.push({ set, score });
      }
    }
    
    // Sort: highest score first, then original order for ties
    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.set.displayOrder - b.set.displayOrder;
    }).map(r => r.set);
  }
}

let selectedSetIndex = -1;

// ---------------------------------------------------------------------------
// Build DOM
// ---------------------------------------------------------------------------

function buildUI() {
  const container = document.createElement("div");
  container.innerHTML = `
    <!-- Collapsed tab -->
    <div class="overlay-tab" id="overlay-tab">⚡ Echo</div>

    <!-- Expanded panel -->
    <div class="overlay-panel hidden" id="overlay-panel">
      <div class="overlay-header">
        <span class="overlay-title">⚡ Fast Inventory</span>
        <button class="collapse-btn" id="collapse-btn" title="Collapse (Ctrl+Shift+E)">−</button>
      </div>

      <div class="overlay-body">
        <!-- === Account accordion === -->
        <div class="accordion-section" id="acc-account">
          <div class="accordion-header" id="acc-account-hdr">
            <div class="accordion-header-left">
              <span class="accordion-chevron">▶</span>
              <span class="accordion-title">Account</span>
            </div>
            <span class="accordion-status" id="acc-account-status"></span>
          </div>
          <div class="accordion-body" id="acc-account-body">
            <!-- Login form (shown when logged out) -->
            <div class="login-form" id="login-form">
              <input class="login-input" id="login-email" type="email" placeholder="Email" autocomplete="email">
              <input class="login-input" id="login-password" type="password" placeholder="Password" autocomplete="current-password">
              <div class="login-error hidden" id="login-error"></div>
              <div class="login-row">
                <button class="btn btn-primary" id="login-btn">Login</button>
              </div>
            </div>
            <!-- Logged-in info (shown when logged in) -->
            <div class="logged-in-info hidden" id="logged-in-info">
              <span class="logged-in-user" id="logged-in-user"></span>
              <button class="btn btn-sm btn-danger" id="logout-btn">Logout</button>
            </div>
          </div>
        </div>

        <!-- === Set Cache accordion === -->
        <div class="accordion-section disabled" id="acc-cache">
          <div class="accordion-header" id="acc-cache-hdr">
            <div class="accordion-header-left">
              <span class="accordion-chevron">▶</span>
              <span class="accordion-title">Set Cache</span>
            </div>
            <span class="accordion-status" id="acc-cache-status"></span>
          </div>
          <div class="accordion-body" id="acc-cache-body">
            <div class="set-filter-row">
              <input class="set-filter-input" id="set-filter-input" type="text" placeholder="Filter sets...">
              <button class="btn btn-sm" id="refresh-sets-btn" title="Refresh set list from EchoMTG">↻</button>
            </div>
            <div class="set-list" id="set-list"></div>
            <div class="cache-actions" id="cache-actions">
              <button class="btn btn-primary btn-sm" id="cache-btn" disabled>Cache Selected (0)</button>
              <button class="btn btn-sm hidden" id="cache-cancel-btn">Cancel</button>
            </div>
            <div class="cache-progress hidden" id="cache-progress">
              <div class="cache-progress-label" id="cache-progress-label"></div>
              <div class="cache-progress-track">
                <div class="cache-progress-fill" id="cache-progress-fill"></div>
              </div>
            </div>
            <div id="cached-data-area">
              <div class="cached-summary" id="cache-summary"></div>
              <div class="cached-set-list" id="cached-set-list"></div>
              <div class="clear-all-row hidden" id="clear-all-area">
                <button class="btn btn-sm btn-danger" id="clear-all-btn">Clear All</button>
              </div>
            </div>
          </div>
        </div>

        <!-- === Add Cards accordion === -->
        <div class="accordion-section disabled" id="acc-add-cards">
          <div class="accordion-header" id="acc-add-cards-hdr">
            <div class="accordion-header-left">
              <span class="accordion-chevron">▶</span>
              <span class="accordion-title">Add Cards</span>
            </div>
            <span class="accordion-status" id="acc-add-cards-status"></span>
          </div>
          <div class="accordion-body" id="acc-add-cards-body">
            <div class="location-bar">
              <label>Loc</label>
              <input class="location-input" id="loc-input" type="text" placeholder="tag">
              <label>Pos</label>
              <input class="position-value" id="pos-input" type="number" min="1" value="1">
              <label>Div</label>
              <input class="divider-input" id="div-input" type="number" min="0" value="50"
                     title="Insert divider every N cards (0 = off)">
            </div>

            <div class="options-bar">
              <label>Foil</label>
              <select class="option-select" id="foil-select">
                <option value="0" selected>Regular</option>
                <option value="1">Foil</option>
              </select>
              <label>Lang</label>
              <select class="option-select" id="lang-select">
                <option value="EN" selected>English</option>
                <option value="JA">Japanese</option>
                <option value="ZHS">Chinese (S)</option>
                <option value="ZHT">Chinese (T)</option>
                <option value="FR">French</option>
                <option value="DE">German</option>
                <option value="IT">Italian</option>
                <option value="KO">Korean</option>
                <option value="PT">Portuguese</option>
                <option value="RU">Russian</option>
                <option value="ES">Spanish</option>
              </select>
            </div>

            <div class="divider-alert hidden" id="divider-alert">
              <span class="divider-alert-icon">📋</span>
              <span class="divider-alert-text" id="divider-alert-text"></span>
            </div>

            <div class="search-container">
              <input class="search-input" id="search-input" type="text"
                     placeholder="Type card name to search...">
            </div>

            <div class="results-list hidden" id="results-list"></div>
          </div>
        </div>

        <!-- === Move accordion === -->
        <div class="accordion-section disabled" id="acc-checkout">
          <div class="accordion-header" id="acc-checkout-hdr">
            <div class="accordion-header-left">
              <span class="accordion-chevron">▶</span>
              <span class="accordion-title">Move</span>
            </div>
            <span class="accordion-status" id="acc-checkout-status"></span>
          </div>
          <div class="accordion-body" id="acc-checkout-body">
            <!-- Inventory import -->
            <div class="checkout-import">
              <div class="checkout-import-row">
                <label class="btn btn-sm" id="checkout-import-label">
                  Import CSV
                  <input type="file" accept=".csv" id="checkout-import-file" style="display:none">
                </label>
                <button class="btn btn-sm hidden" id="checkout-sync-notes-btn" title="Sync note IDs from EchoMTG">Sync Notes</button>
                <span class="checkout-import-status" id="checkout-import-status">No inventory loaded</span>
                <button class="btn btn-sm btn-danger hidden" id="checkout-clear-inv-btn">Clear</button>
              </div>
            </div>

            <!-- Search mode tabs -->
            <div class="checkout-tabs">
              <button class="tab-btn active" id="checkout-tab-name">By Name</button>
              <button class="tab-btn" id="checkout-tab-list">By List</button>
            </div>

            <!-- By Name mode -->
            <div id="checkout-mode-name">
              <div class="search-container">
                <input class="search-input" id="checkout-search-input" type="text"
                       placeholder="Search your inventory..." disabled>
              </div>
            </div>

            <!-- By List mode -->
            <div id="checkout-mode-list" class="hidden">
              <div class="checkout-list-load-row">
                <select class="option-select checkout-list-select" id="checkout-echo-list-select">
                  <option value="">Select a list...</option>
                </select>
                <button class="btn btn-sm" id="checkout-load-list-btn" disabled>Load List</button>
              </div>
            </div>

            <!-- Filters (multi-select dropdowns) -->
            <div class="checkout-search-filters">
              <div class="filter-multi" id="filter-version-wrap">
                <button class="filter-multi-btn" id="filter-version-btn">Version</button>
                <div class="filter-multi-menu hidden" id="filter-version-menu">
                  <label><input type="checkbox" value="regular"> Regular</label>
                  <label><input type="checkbox" value="foil"> Foil</label>
                  <label><input type="checkbox" value="Anime"> Anime</label>
                  <label><input type="checkbox" value="Borderless"> Borderless</label>
                  <label><input type="checkbox" value="Poster"> Poster</label>
                  <label><input type="checkbox" value="Etched"> Etched</label>
                  <label><input type="checkbox" value="Extended Art"> Extended Art</label>
                  <label><input type="checkbox" value="Galaxy Foil"> Galaxy Foil</label>
                  <label><input type="checkbox" value="Gilded Foil"> Gilded Foil</label>
                  <label><input type="checkbox" value="Retro Frame"> Retro</label>
                  <label><input type="checkbox" value="Showcase"> Showcase</label>
                  <label><input type="checkbox" value="Step-And-Compleat Foil"> Step-and-Compleat</label>
                </div>
              </div>
              <div class="filter-multi" id="filter-set-wrap">
                <button class="filter-multi-btn" id="filter-set-btn">Set</button>
                <div class="filter-multi-menu hidden" id="filter-set-menu"></div>
              </div>
              <div class="filter-multi" id="filter-lang-wrap">
                <button class="filter-multi-btn" id="filter-lang-btn">Language</button>
                <div class="filter-multi-menu hidden" id="filter-lang-menu">
                  <label><input type="checkbox" value="EN"> English</label>
                  <label><input type="checkbox" value="JA"> Japanese</label>
                  <label><input type="checkbox" value="PH"> Phyrexian</label>
                </div>
              </div>
            </div>

            <!-- Shared card results -->
            <div class="checkout-card-list" id="checkout-search-cards"></div>

            <!-- Location checkout -->
            <div class="checkout-location-row">
              <div class="checkout-location-select-row">
                <label>Location</label>
                <div class="location-combobox" id="checkout-location-combobox">
                  <input class="location-input" id="checkout-location-input" type="text"
                         placeholder="Type or select location..." autocomplete="off">
                  <div class="location-combobox-list hidden" id="checkout-location-list"></div>
                </div>
              </div>
              <div class="checkout-offset-row">
                <label>Starting offset</label>
                <input class="position-value" id="checkout-offset-input" type="number" min="1" value="1">
                <span class="checkout-offset-hint" id="checkout-offset-hint"></span>
              </div>
            </div>

            <!-- Move button -->
            <div class="checkout-actions">
              <button class="btn btn-primary btn-sm" id="checkout-search-btn" disabled>Move (0)</button>
            </div>
          </div>
        </div>

        <!-- === Retrieval Plans accordion === -->
        <div class="accordion-section disabled" id="acc-plans">
          <div class="accordion-header" id="acc-plans-hdr">
            <div class="accordion-header-left">
              <span class="accordion-chevron">▶</span>
              <span class="accordion-title">Retrieval Plans</span>
            </div>
            <span class="accordion-status" id="acc-plans-status"></span>
          </div>
          <div class="accordion-body" id="acc-plans-body">
            <!-- Plan list view -->
            <div id="plans-list-view">
              <div class="plans-list" id="plans-list"></div>
              <div class="plans-empty hidden" id="plans-empty">No retrieval plans.</div>
            </div>
            <!-- Plan detail view -->
            <div id="plans-detail-view" class="hidden">
              <div class="checkin-back-link" id="plans-back-btn">← Back to plans</div>
              <div class="plans-detail-header" id="plans-detail-header"></div>
              <div class="plans-detail-items" id="plans-detail-items"></div>
              <div class="plans-actions">
                <button class="btn btn-sm" id="plans-print-btn">Print</button>
                <button class="btn btn-sm btn-danger" id="plans-delete-btn">Delete Plan</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="status-bar">
        <span class="status-message info" id="status-msg">Ready</span>
        <span class="session-count">Session: <strong id="session-count">0</strong></span>
      </div>
    </div>
  `;
  shadow.appendChild(container);
}

buildUI();

// ---------------------------------------------------------------------------
// DOM refs (inside shadow)
// ---------------------------------------------------------------------------

const $ = (sel) => shadow.querySelector(sel);

const tab = $("#overlay-tab");
const panel = $("#overlay-panel");
const collapseBtn = $("#collapse-btn");

// Accordion sections
const accAccount = $("#acc-account");
const accAccountHdr = $("#acc-account-hdr");
const accAccountStatus = $("#acc-account-status");
const accCache = $("#acc-cache");
const accCacheHdr = $("#acc-cache-hdr");
const accCacheStatus = $("#acc-cache-status");
const accAddCards = $("#acc-add-cards");
const accAddCardsHdr = $("#acc-add-cards-hdr");
const accAddCardsStatus = $("#acc-add-cards-status");
const accCheckout = $("#acc-checkout");
const accCheckoutHdr = $("#acc-checkout-hdr");
const accCheckoutStatus = $("#acc-checkout-status");

// Login elements
const loginForm = $("#login-form");
const loginEmail = $("#login-email");
const loginPassword = $("#login-password");
const loginError = $("#login-error");
const loginBtn = $("#login-btn");
const loggedInInfo = $("#logged-in-info");
const loggedInUser = $("#logged-in-user");
const logoutBtn = $("#logout-btn");

// Cache elements
const setFilterInput = $("#set-filter-input");
const refreshSetsBtn = $("#refresh-sets-btn");
const setListEl = $("#set-list");
const cacheBtn = $("#cache-btn");
const cacheActions = $("#cache-actions");
const cacheCancelBtn = $("#cache-cancel-btn");
const cacheProgress = $("#cache-progress");
const cacheProgressLabel = $("#cache-progress-label");
const cacheProgressFill = $("#cache-progress-fill");
const cacheSummary = $("#cache-summary");
const cachedSetList = $("#cached-set-list");
const clearAllArea = $("#clear-all-area");
const clearAllBtn = $("#clear-all-btn");

// Inventory elements
const locInput = $("#loc-input");
const posInput = $("#pos-input");
const divInput = $("#div-input");
const foilSelect = $("#foil-select");
const langSelect = $("#lang-select");
const dividerAlert = $("#divider-alert");
const dividerAlertText = $("#divider-alert-text");
const searchInput = $("#search-input");
const resultsList = $("#results-list");
const statusMsg = $("#status-msg");
const sessionCountEl = $("#session-count");

// Checkout elements
const checkoutImportFile = $("#checkout-import-file");
const checkoutImportLabel = $("#checkout-import-label");
const checkoutImportStatus = $("#checkout-import-status");
const checkoutClearInvBtn = $("#checkout-clear-inv-btn");
const checkoutSyncNotesBtn = $("#checkout-sync-notes-btn");
const checkoutSearchInput = $("#checkout-search-input");
const checkoutSearchCards = $("#checkout-search-cards");
const checkoutSearchBtn = $("#checkout-search-btn");
const checkoutTabName = $("#checkout-tab-name");
const checkoutTabList = $("#checkout-tab-list");
const checkoutModeName = $("#checkout-mode-name");
const checkoutModeList = $("#checkout-mode-list");
const checkoutEchoListSelect = $("#checkout-echo-list-select");
const checkoutLoadListBtn = $("#checkout-load-list-btn");
const filterVersionBtn = $("#filter-version-btn");
const filterVersionMenu = $("#filter-version-menu");
const filterVersionWrap = $("#filter-version-wrap");
const filterSetBtn = $("#filter-set-btn");
const filterSetMenu = $("#filter-set-menu");
const filterSetWrap = $("#filter-set-wrap");
const filterLangBtn = $("#filter-lang-btn");
const filterLangMenu = $("#filter-lang-menu");
const filterLangWrap = $("#filter-lang-wrap");
const checkoutLocationInput = $("#checkout-location-input");
const checkoutLocationList = $("#checkout-location-list");
const checkoutOffsetInput = $("#checkout-offset-input");
const checkoutOffsetHint = $("#checkout-offset-hint");

// Plans elements
const accPlans = $("#acc-plans");
const accPlansHdr = $("#acc-plans-hdr");
const accPlansStatus = $("#acc-plans-status");
const plansListView = $("#plans-list-view");
const plansList = $("#plans-list");
const plansEmpty = $("#plans-empty");
const plansDetailView = $("#plans-detail-view");
const plansBackBtn = $("#plans-back-btn");
const plansDetailHeader = $("#plans-detail-header");
const plansDetailItems = $("#plans-detail-items");
const plansPrintBtn = $("#plans-print-btn");
const plansDeleteBtn = $("#plans-delete-btn");


// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let expanded = false;
let results = [];
let selectedIndex = -1;
let isAdding = false;
let sessionCount = 0;
let debounceTimer = null;
let hasAuth = false;
let hasCachedSets = false;
let checkoutMode = "name"; // "name" | "list"
let inventoryLocations = []; // cached { tag, maxPosition } array
let currentPlanId = null;
let defaultCondition = "NM";
let currentPhase = PHASE_LOGIN;
let echoUser = null;
let cachedSetsMap = new Map(); // code → { set_name, card_count, cached_at }
let cacheCancelled = false;

// ---------------------------------------------------------------------------
// Accordion helpers
// ---------------------------------------------------------------------------

function openAccordion(section) {
  section.classList.add("open");
}

function closeAccordion(section) {
  section.classList.remove("open");
}

function toggleAccordion(section) {
  section.classList.toggle("open");
}

function enableSection(section) {
  section.classList.remove("disabled");
}

function disableSection(section) {
  section.classList.add("disabled");
}

// Accordion header click handlers
accAccountHdr.addEventListener("click", () => {
  toggleAccordion(accAccount);
});

accCacheHdr.addEventListener("click", () => {
  if (!accCache.classList.contains("disabled")) {
    toggleAccordion(accCache);
  }
});

accAddCardsHdr.addEventListener("click", () => {
  if (!accAddCards.classList.contains("disabled")) {
    toggleAccordion(accAddCards);
  }
});

accCheckoutHdr.addEventListener("click", () => {
  if (!accCheckout.classList.contains("disabled")) {
    toggleAccordion(accCheckout);
    if (accCheckout.classList.contains("open")) {
      loadCheckoutData();
    }
  }
});


accPlansHdr.addEventListener("click", () => {
  if (!accPlans.classList.contains("disabled")) {
    toggleAccordion(accPlans);
    if (accPlans.classList.contains("open")) {
      loadRetrievalPlans();
    }
  }
});

// ---------------------------------------------------------------------------
// Flow state machine
// ---------------------------------------------------------------------------

function setPhase(phase) {
  currentPhase = phase;
  applyPhase();
}

function applyPhase() {
  switch (currentPhase) {
    case PHASE_LOGIN:
      openAccordion(accAccount);
      closeAccordion(accCache);
      disableSection(accCache);
      disableSection(accAddCards);
      disableSection(accCheckout);
      disableSection(accPlans);
      searchInput.disabled = true;
      accAccountStatus.textContent = "";
      accAccountStatus.className = "accordion-status";
      accCacheStatus.textContent = "";
      accCacheStatus.className = "accordion-status";
      break;

    case PHASE_CACHE:
      closeAccordion(accAccount);
      enableSection(accCache);
      openAccordion(accCache);
      disableSection(accAddCards);
      disableSection(accCheckout);
      disableSection(accPlans);
      searchInput.disabled = true;
      accAccountStatus.textContent = "✓ " + (echoUser || "Logged in");
      accAccountStatus.className = "accordion-status complete";
      updateCacheStatus();
      break;

    case PHASE_READY:
      closeAccordion(accAccount);
      closeAccordion(accCache);
      enableSection(accCache);
      enableSection(accAddCards);
      enableSection(accCheckout);
      enableSection(accPlans);
      openAccordion(accAddCards);
      searchInput.disabled = false;
      accAccountStatus.textContent = "✓ " + (echoUser || "Logged in");
      accAccountStatus.className = "accordion-status complete";
      updateCacheStatus();
      break;
  }
}

function updateCacheStatus() {
  const count = cachedSetsMap.size;
  if (count > 0) {
    const totalCards = Array.from(cachedSetsMap.values()).reduce((s, v) => s + (v.card_count || 0), 0);
    accCacheStatus.textContent = `✓ ${count} set${count !== 1 ? "s" : ""}, ${totalCards.toLocaleString()} cards`;
    accCacheStatus.className = "accordion-status complete";
  } else {
    accCacheStatus.textContent = "No sets cached";
    accCacheStatus.className = "accordion-status";
  }
}

function determinePhase() {
  if (!hasAuth) return PHASE_LOGIN;
  if (!hasCachedSets) return PHASE_CACHE;
  return PHASE_READY;
}

// ---------------------------------------------------------------------------
// Expand / Collapse
// ---------------------------------------------------------------------------

async function expand() {
  expanded = true;
  panel.classList.remove("hidden");
  tab.classList.add("hidden");
  await refreshState();
  if (currentPhase === PHASE_READY) {
    searchInput.focus();
  } else if (currentPhase === PHASE_LOGIN) {
    loginEmail.focus();
  }
}

function collapse() {
  expanded = false;
  panel.classList.add("hidden");
  tab.classList.remove("hidden");
}

function toggle() {
  expanded ? collapse() : expand();
}

tab.addEventListener("click", expand);
collapseBtn.addEventListener("click", collapse);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "E") {
    e.preventDefault();
    toggle();
  }
});

// ---------------------------------------------------------------------------
// Login logic
// ---------------------------------------------------------------------------

loginBtn.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";
  loginError.classList.add("hidden");

  const result = await chrome.runtime.sendMessage({
    type: "LOGIN",
    email,
    password,
  });

  loginBtn.disabled = false;
  loginBtn.textContent = "Login";

  if (result?.ok) {
    echoUser = result.user || email;
    await chrome.storage.local.set({ echoUser });
    hasAuth = true;
    showLoggedInUI();
    await refreshCachedSets();
    setPhase(hasCachedSets ? PHASE_READY : PHASE_CACHE);
    renderSetList();
    if (currentPhase === PHASE_READY) searchInput.focus();
  } else {
    loginError.textContent = result?.error || "Login failed";
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "LOGOUT" });
  await chrome.storage.local.remove("echoUser");
  hasAuth = false;
  echoUser = null;
  showLoggedOutUI();
  setPhase(PHASE_LOGIN);
  loginEmail.focus();
});

function showLoggedInUI() {
  loginForm.classList.add("hidden");
  loggedInInfo.classList.remove("hidden");
  loggedInUser.textContent = echoUser || "Authenticated";
}

function showLoggedOutUI() {
  loginForm.classList.remove("hidden");
  loggedInInfo.classList.add("hidden");
  loginEmail.value = "";
  loginPassword.value = "";
  loginError.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Set list rendering
// ---------------------------------------------------------------------------

function renderSetList(filter = "") {
  const lowerFilter = filter.toLowerCase();
  setListEl.innerHTML = "";

  for (const set of KNOWN_SETS) {
    if (
      lowerFilter &&
      !set.name.toLowerCase().includes(lowerFilter) &&
      !set.code.toLowerCase().includes(lowerFilter)
    ) {
      continue;
    }

    const cached = cachedSetsMap.get(set.code);
    const row = document.createElement("div");
    row.className = "set-row";
    row.innerHTML = `
      <input type="checkbox" data-code="${set.code}">
      <span class="set-name">${escapeHtml(set.name)}</span>
      <span class="set-code">${set.code}</span>
      ${
        cached
          ? `<span class="set-cached">${cached.card_count} cards</span>`
          : `<span class="set-not-cached">—</span>`
      }
    `;
    setListEl.appendChild(row);
  }

  updateCacheButton();
}

function getSelectedSetCodes() {
  return Array.from(setListEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.code);
}

function updateCacheButton() {
  const count = getSelectedSetCodes().length;
  cacheBtn.textContent = `Cache Selected (${count})`;
  cacheBtn.disabled = count === 0;
}

setListEl.addEventListener("change", updateCacheButton);

setFilterInput.addEventListener("input", () => {
  renderSetList(setFilterInput.value);
});

refreshSetsBtn.addEventListener("click", async () => {
  refreshSetsBtn.disabled = true;
  refreshSetsBtn.textContent = "...";
  statusMsg.textContent = "Refreshing set list...";
  statusMsg.className = "status-message pending";

  try {
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_KNOWN_SETS" });
    if (result?.ok && result.sets?.length > 0) {
      KNOWN_SETS = result.sets;
      renderSetList(setFilterInput.value);
      statusMsg.textContent = `Loaded ${result.sets.length} sets`;
      statusMsg.className = "status-message";
    } else {
      statusMsg.textContent = `Refresh failed: ${result?.error || "no sets returned"}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    statusMsg.textContent = `Refresh error: ${err.message}`;
    statusMsg.className = "status-message error";
  }

  refreshSetsBtn.disabled = false;
  refreshSetsBtn.textContent = "↻";
});

// ---------------------------------------------------------------------------
// Caching logic
// ---------------------------------------------------------------------------

cacheBtn.addEventListener("click", async () => {
  const codes = getSelectedSetCodes();
  if (codes.length === 0) return;

  cacheCancelled = false;
  cacheActions.classList.add("hidden");
  cacheProgress.classList.remove("hidden");
  cacheCancelBtn.classList.remove("hidden");

  const errors = [];
  for (let i = 0; i < codes.length; i++) {
    if (cacheCancelled) break;

    const code = codes[i];
    cacheProgressLabel.textContent = `Caching ${code}... (${i + 1}/${codes.length})`;
    cacheProgressFill.style.width = `${((i + 0.5) / codes.length) * 100}%`;

    try {
      const result = await chrome.runtime.sendMessage({ type: "CACHE_SETS", setCodes: [code] });
      if (result?.ok) {
        const setResult = result.results?.[0];
        if (setResult && !setResult.ok) {
          errors.push(`${code}: ${setResult.error}`);
        }
      } else {
        errors.push(`${code}: ${result?.error || "unknown error"}`);
      }
    } catch (err) {
      errors.push(`${code}: ${err.message}`);
    }

    cacheProgressFill.style.width = `${((i + 1) / codes.length) * 100}%`;
  }

  cacheProgress.classList.add("hidden");
  cacheActions.classList.remove("hidden");

  if (errors.length > 0) {
    cacheProgressLabel.textContent = `Errors: ${errors.join("; ")}`;
    cacheProgressLabel.style.color = "#ef5350";
    cacheProgress.classList.remove("hidden");
    cacheCancelBtn.classList.add("hidden");
    setTimeout(() => {
      cacheProgress.classList.add("hidden");
      cacheProgressLabel.style.color = "";
    }, 5000);
  }

  await refreshCachedSets();
  renderSetList(setFilterInput.value);
  updateCacheStatus();

  // Auto-advance to ready if we now have cached sets
  if (hasCachedSets && currentPhase === PHASE_CACHE) {
    setPhase(PHASE_READY);
    searchInput.focus();
  }
});

cacheCancelBtn.addEventListener("click", () => {
  cacheCancelled = true;
});

// ---------------------------------------------------------------------------
// Cached data display
// ---------------------------------------------------------------------------

async function refreshCachedSets() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_CACHED_SETS" });
    cachedSetsMap.clear();

    if (result?.ok && result.sets) {
      for (const set of result.sets) {
        cachedSetsMap.set(set.set_code, set);
      }
    }
  } catch (err) {
    console.warn("[overlay] refreshCachedSets error:", err);
  }

  hasCachedSets = cachedSetsMap.size > 0;
  renderCachedData();
}

function renderCachedData() {
  const sets = Array.from(cachedSetsMap.values());
  cachedSetList.innerHTML = "";

  if (sets.length === 0) {
    cacheSummary.textContent = "No sets cached";
    clearAllArea.classList.add("hidden");
    return;
  }

  const totalCards = sets.reduce((sum, s) => sum + (s.card_count || 0), 0);
  cacheSummary.innerHTML = `<strong>${sets.length}</strong> set${sets.length !== 1 ? "s" : ""} cached, <strong>${totalCards.toLocaleString()}</strong> cards total`;

  for (const set of sets) {
    const row = document.createElement("div");
    row.className = "cached-set-row";
    const isActive = set.active !== false; // Default to true
    row.innerHTML = `
      <div class="cached-set-info">
        <input type="checkbox" class="set-active-checkbox" 
               data-set-code="${set.set_code}" 
               ${isActive ? 'checked' : ''}>
        <span>${escapeHtml(set.set_name)}</span>
        <span class="set-code">${set.set_code}</span>
        <span class="card-count">${set.card_count}</span>
      </div>
      <button class="btn btn-danger btn-sm" data-clear-code="${set.set_code}">Clear</button>
    `;
    cachedSetList.appendChild(row);
  }

  clearAllArea.classList.remove("hidden");
}

cachedSetList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-clear-code]");
  if (btn) {
    const code = btn.dataset.clearCode;
    btn.disabled = true;
    btn.textContent = "...";
    await chrome.runtime.sendMessage({ type: "CLEAR_SET", setCode: code });
    await refreshCachedSets();
    renderSetList(setFilterInput.value);
    updateCacheStatus();

    // If all sets cleared, regress to cache phase
    if (!hasCachedSets && currentPhase === PHASE_READY) {
      setPhase(PHASE_CACHE);
    }
    return;
  }
});

cachedSetList.addEventListener("change", async (e) => {
  if (e.target.classList.contains("set-active-checkbox")) {
    const setCode = e.target.dataset.setCode;
    const isActive = e.target.checked;
    await chrome.runtime.sendMessage({ 
      type: "SET_SET_ACTIVE", 
      setCode, 
      active: isActive 
    });
    // Update the cached sets map to reflect the change
    const cachedSet = cachedSetsMap.get(setCode);
    if (cachedSet) {
      cachedSet.active = isActive;
    }
  }
});

clearAllBtn.addEventListener("click", async () => {
  clearAllBtn.disabled = true;
  clearAllBtn.textContent = "Clearing...";
  await chrome.runtime.sendMessage({ type: "CLEAR_ALL" });
  await refreshCachedSets();
  renderSetList(setFilterInput.value);
  updateCacheStatus();
  clearAllBtn.disabled = false;
  clearAllBtn.textContent = "Clear All";

  if (currentPhase === PHASE_READY) {
    setPhase(PHASE_CACHE);
  }
});

// ---------------------------------------------------------------------------
// Persist controls on change
// ---------------------------------------------------------------------------

locInput.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_STATE", key: "locationTag", value: locInput.value });
});
posInput.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_STATE", key: "position", value: Number(posInput.value) });
  checkDividerAlert();
});
divInput.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_STATE", key: "dividerEvery", value: Number(divInput.value) });
  checkDividerAlert();
});
foilSelect.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_STATE", key: "foil", value: Number(foilSelect.value) });
});
langSelect.addEventListener("change", () => {
  chrome.runtime.sendMessage({ type: "SET_STATE", key: "language", value: langSelect.value });
});

// ---------------------------------------------------------------------------
// Initialisation — load persisted state & determine phase
// ---------------------------------------------------------------------------

async function loadState() {
  try {
    // Check auth
    const { echoToken } = await chrome.storage.local.get("echoToken");
    hasAuth = !!echoToken;

    if (hasAuth) {
      const stored = await chrome.storage.local.get("echoUser");
      echoUser = stored.echoUser || "Authenticated";
      showLoggedInUI();
    }

    // Check cached sets
    await refreshCachedSets();

    // Load persisted state
    const stateResult = await chrome.runtime.sendMessage({
      type: "GET_STATE",
      keys: [
        "locationTag",
        "position",
        "dividerEvery",
        "foil",
        "language",
        "defaultCondition",
        "defaultLanguage",
      ],
    });

    if (stateResult?.ok && stateResult.values) {
      const v = stateResult.values;
      if (v.locationTag != null) locInput.value = v.locationTag;
      if (v.position != null) posInput.value = v.position;
      if (v.dividerEvery != null) divInput.value = v.dividerEvery;
      if (v.foil != null) foilSelect.value = String(v.foil);
      if (v.defaultCondition) defaultCondition = v.defaultCondition;
      const lang = v.language || v.defaultLanguage;
      if (lang) langSelect.value = lang;
    }
  } catch (err) {
    console.error("[overlay] Failed to load state:", err);
    statusMsg.textContent = "Failed to connect to extension";
    statusMsg.className = "status-message error";
  }

  // Load known sets via service worker
  try {
    const setsResult = await chrome.runtime.sendMessage({ type: "GET_KNOWN_SETS" });
    console.log("[overlay] GET_KNOWN_SETS result:", setsResult?.ok, "sets:", setsResult?.sets?.length);
    if (setsResult?.ok && setsResult.sets?.length > 0) {
      KNOWN_SETS = setsResult.sets;
    } else {
      console.warn("[overlay] No sets returned from service worker");
    }
  } catch (err) {
    console.warn("[overlay] Failed to load known sets:", err);
  }

  // Render set list for cache section
  renderSetList();

  // Show message if no sets available
  if (KNOWN_SETS.length === 0) {
    setListEl.innerHTML = '<div class="set-row" style="color: #999;">No sets available. Check service worker console for errors.</div>';
  }

  // Clean up expired retrieval plans
  try {
    await chrome.runtime.sendMessage({ type: "GET_RETRIEVAL_PLANS" });
  } catch (err) {
    // Ignore — cleanup happens server-side
  }

  // Set initial phase
  setPhase(determinePhase());
  checkDividerAlert();
}

// ---------------------------------------------------------------------------
// Refresh auth & cache status (called on every expand)
// ---------------------------------------------------------------------------

async function refreshState() {
  try {
    const { echoToken } = await chrome.storage.local.get("echoToken");
    hasAuth = !!echoToken;

    if (hasAuth) {
      const stored = await chrome.storage.local.get("echoUser");
      echoUser = stored.echoUser || "Authenticated";
      showLoggedInUI();
    } else {
      showLoggedOutUI();
    }

    await refreshCachedSets();
    renderSetList(setFilterInput.value);
  } catch (err) {
    console.warn("[overlay] refreshState error:", err);
  }

  setPhase(determinePhase());
}

// ---------------------------------------------------------------------------
// Divider alert
// ---------------------------------------------------------------------------

function checkDividerAlert() {
  const pos = Number(posInput.value) || 0;
  const divEvery = Number(divInput.value) || 0;

  if (divEvery > 0 && pos > 1 && (pos - 1) % divEvery === 0) {
    dividerAlertText.innerHTML =
      `<strong>Insert a divider</strong> — ${pos - 1} cards added (every ${divEvery})`;
    dividerAlert.classList.remove("hidden");
  } else {
    dividerAlert.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(query), 100);
});

async function doSearch(query) {
  try {
    // Get active sets before searching
    const activeSetsResult = await chrome.runtime.sendMessage({ 
      type: "GET_ACTIVE_SETS" 
    });
    
    const result = await chrome.runtime.sendMessage({
      type: "SEARCH_CARDS",
      query,
      activeSets: activeSetsResult?.ok ? activeSetsResult.activeSets : [],
    });

    if (result?.ok) {
      results = result.cards || [];
      selectedIndex = results.length > 0 ? 0 : -1;
      renderResults();
      if (results.length === 0) {
        statusMsg.textContent = "No matches";
        statusMsg.className = "status-message info";
      } else {
        statusMsg.textContent = `${results.length} result${results.length !== 1 ? "s" : ""}`;
        statusMsg.className = "status-message info";
      }
    } else {
      statusMsg.textContent = `Search error: ${result?.error || "unknown"}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    statusMsg.textContent = "Search failed — service worker not responding";
    statusMsg.className = "status-message error";
  }
}

function clearResults() {
  results = [];
  selectedIndex = -1;
  resultsList.innerHTML = "";
  resultsList.classList.add("hidden");
}

function renderResults() {
  if (results.length === 0) {
    resultsList.innerHTML = "";
    resultsList.classList.add("hidden");
    return;
  }

  resultsList.classList.remove("hidden");
  resultsList.innerHTML = results
    .map((card, i) => {
      const rarityCode = RARITY_CODES[card.rarity] || "";
      const badges = (card.variant_tags || [])
        .map((tag) => {
          const cls = card.is_foil_variant &&
            tag.toLowerCase().includes("foil")
            ? "badge badge-foil"
            : "badge badge-variant";
          return `<span class="${cls}">${escapeHtml(tag)}</span>`;
        })
        .join("");
      const selected = i === selectedIndex ? " selected" : "";

      return `
        <div class="result-item${selected}" data-index="${i}">
          <div class="result-thumb">
            ${card.image_cropped ? `<img src="${escapeHtml(card.image_cropped)}" alt="">` : ""}
          </div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(card.name)}</div>
            <div class="result-meta">
              ${badges}
              <span>${escapeHtml(card.set_code)} #${card.collectors_number}</span>
              ${rarityCode ? `<span class="rarity-${rarityCode}">${rarityCode}</span>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// Click to select and add
resultsList.addEventListener("click", (e) => {
  const item = e.target.closest(".result-item");
  if (!item || isAdding) return;
  const idx = Number(item.dataset.index);
  if (idx >= 0 && idx < results.length) {
    selectedIndex = idx;
    addSelectedCard();
  }
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

searchInput.addEventListener("keydown", (e) => {
  if (results.length === 0) {
    if (e.key === "Escape") {
      if (!searchInput.value) collapse();
      else { searchInput.value = ""; clearResults(); }
      e.preventDefault();
    }
    return;
  }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % results.length;
      renderResults();
      scrollSelectedIntoView();
      break;
    case "ArrowUp":
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      renderResults();
      scrollSelectedIntoView();
      break;
    case "Enter":
      e.preventDefault();
      if (selectedIndex >= 0) addSelectedCard();
      break;
    case "Escape":
      e.preventDefault();
      searchInput.value = "";
      clearResults();
      break;
  }
});

function scrollSelectedIntoView() {
  const el = resultsList.querySelector(".selected");
  if (el) el.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// Add card
// ---------------------------------------------------------------------------

async function addSelectedCard() {
  if (isAdding || selectedIndex < 0 || selectedIndex >= results.length) return;
  isAdding = true;

  const card = results[selectedIndex];

  const selectedEl = resultsList.querySelector(".selected");
  if (selectedEl) {
    selectedEl.classList.add("adding");
    const label = document.createElement("span");
    label.className = "adding-label";
    label.textContent = "Adding…";
    selectedEl.appendChild(label);
  }

  statusMsg.textContent = "Adding to inventory…";
  statusMsg.className = "status-message pending";
  searchInput.disabled = true;

  const result = await chrome.runtime.sendMessage({
    type: "ADD_CARD",
    emid: card.emid,
    foil: Number(foilSelect.value),
    condition: defaultCondition,
    language: langSelect.value,
    locationTag: locInput.value,
    position: Number(posInput.value),
  });

  isAdding = false;
  searchInput.disabled = false;

  if (result?.ok) {
    sessionCount++;
    sessionCountEl.textContent = sessionCount;

    const noteText = result.noteText || `${locInput.value}p${posInput.value}`;
    statusMsg.textContent = `✓ ${card.name} added → ${noteText}`;
    statusMsg.className = "status-message";

    posInput.value = result.newPosition;
    checkDividerAlert();

    searchInput.value = "";
    clearResults();
    searchInput.focus();
  } else {
    statusMsg.textContent = `✗ Failed to add — ${result?.error || "unknown error"}`;
    statusMsg.className = "status-message error";
    renderResults();
    searchInput.focus();
  }
}

// ---------------------------------------------------------------------------
// Check Out — CSV import, dual search, filters, location checkout
// ---------------------------------------------------------------------------

function updateCheckoutSearchCount() {
  const count = checkoutSearchCards.querySelectorAll('input[type="checkbox"]:checked').length;
  checkoutSearchBtn.textContent = `Move (${count})`;
  checkoutSearchBtn.disabled = count === 0;
}

checkoutSearchCards.addEventListener("change", updateCheckoutSearchCount);

// --- CSV parsing ---

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    records.push(row);
  }
  return records;
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function csvRowToInventoryRecord(row) {
  return {
    echo_inventory_id: Number(row["echo_inventory_id"]) || 0,
    emid: Number(row["echoid"]) || 0,
    name: row["Name"] || "",
    name_lower: (row["Name"] || "").toLowerCase(),
    set_code: (row["Set Code"] || "").toUpperCase(),
    set_name: row["Set"] || "",
    collectors_number: row["Collector Number"] || "",
    rarity: row["Rarity"] || "",
    condition: row["Condition"] || "NM",
    language: row["Language"] || "EN",
    foil: Number(row["Foil Qty"] || 0) > 0,
    note: row["note"] || "",
    acquired_price: parseFloat(row["Acquired"]) || 0,
    date_acquired: row["Date Acquired"] || "",
  };
}

// --- CSV file import ---

checkoutImportFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  checkoutImportStatus.textContent = "Importing...";
  checkoutSearchInput.disabled = true;

  try {
    const text = await file.text();
    const rows = parseCSV(text);
    const records = rows
      .map(csvRowToInventoryRecord)
      .filter((r) => r.echo_inventory_id > 0);

    const result = await chrome.runtime.sendMessage({
      type: "IMPORT_INVENTORY",
      records,
    });

    if (result?.ok) {
      checkoutImportStatus.textContent = `${result.count.toLocaleString()} cards loaded`;
      checkoutClearInvBtn.classList.remove("hidden");
      checkoutSyncNotesBtn.classList.remove("hidden");
      checkoutSearchInput.disabled = false;
      statusMsg.textContent = `Imported ${result.count.toLocaleString()} inventory cards`;
      statusMsg.className = "status-message";
      populateCheckoutFilters();
      populateCheckoutLocations();
    } else {
      checkoutImportStatus.textContent = `Import failed: ${result?.error}`;
      statusMsg.textContent = `Import failed: ${result?.error}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    checkoutImportStatus.textContent = "Import failed";
    statusMsg.textContent = `Import error: ${err.message}`;
    statusMsg.className = "status-message error";
  }

  // Reset file input so the same file can be re-selected
  checkoutImportFile.value = "";
});

checkoutClearInvBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_INVENTORY" });
  checkoutImportStatus.textContent = "No inventory loaded";
  checkoutClearInvBtn.classList.add("hidden");
  checkoutSyncNotesBtn.classList.add("hidden");
  checkoutSearchInput.disabled = true;
  checkoutSearchCards.innerHTML = "";
  updateCheckoutSearchCount();
});

checkoutSyncNotesBtn.addEventListener("click", async () => {
  checkoutSyncNotesBtn.disabled = true;
  checkoutSyncNotesBtn.textContent = "Syncing...";
  statusMsg.textContent = "Syncing note IDs from EchoMTG...";
  statusMsg.className = "status-message pending";

  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_NOTE_IDS" });
    if (result?.ok) {
      statusMsg.textContent = `Synced ${result.synced} note IDs (${result.remaining || 0} remaining)`;
      statusMsg.className = "status-message";
    } else {
      statusMsg.textContent = `Sync failed: ${result?.error || "unknown"}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    statusMsg.textContent = `Sync error: ${err.message}`;
    statusMsg.className = "status-message error";
  }

  checkoutSyncNotesBtn.disabled = false;
  checkoutSyncNotesBtn.textContent = "Sync Notes";
});

// --- Tab switching ---

checkoutTabName.addEventListener("click", () => {
  checkoutMode = "name";
  checkoutTabName.classList.add("active");
  checkoutTabList.classList.remove("active");
  checkoutModeName.classList.remove("hidden");
  checkoutModeList.classList.add("hidden");
  checkoutSearchCards.innerHTML = "";
  updateCheckoutSearchCount();
});

checkoutTabList.addEventListener("click", async () => {
  checkoutMode = "list";
  checkoutTabList.classList.add("active");
  checkoutTabName.classList.remove("active");
  checkoutModeList.classList.remove("hidden");
  checkoutModeName.classList.add("hidden");
  checkoutSearchCards.innerHTML = "";
  updateCheckoutSearchCount();

  // Populate list dropdown
  try {
    checkoutEchoListSelect.innerHTML = '<option value="">Loading lists...</option>';
    const result = await chrome.runtime.sendMessage({ type: "GET_ECHO_LISTS" });
    checkoutEchoListSelect.innerHTML = '<option value="">Select a list...</option>';
    if (result?.ok && result.lists.length > 0) {
      for (const list of result.lists) {
        const opt = document.createElement("option");
        opt.value = list.id;
        opt.textContent = list.name;
        checkoutEchoListSelect.appendChild(opt);
      }
    } else if (result?.error) {
      checkoutEchoListSelect.innerHTML = `<option value="">Error: ${result.error}</option>`;
    } else {
      checkoutEchoListSelect.innerHTML = '<option value="">No lists found</option>';
    }
  } catch (err) {
    console.warn("[overlay] Failed to load echo lists:", err);
    checkoutEchoListSelect.innerHTML = '<option value="">Failed to load lists</option>';
  }
});

checkoutEchoListSelect.addEventListener("change", () => {
  checkoutLoadListBtn.disabled = !checkoutEchoListSelect.value;
});

checkoutLoadListBtn.addEventListener("click", async () => {
  const listId = checkoutEchoListSelect.value;
  if (!listId) return;

  checkoutLoadListBtn.disabled = true;
  checkoutLoadListBtn.textContent = "Loading...";
  checkoutSearchCards.innerHTML = '<div class="checkout-card-item">Loading list...</div>';

  try {
    const listResult = await chrome.runtime.sendMessage({ type: "GET_ECHO_LIST", listId });
    if (listResult?.ok && listResult.emids.length > 0) {
      const filters = getCheckoutFilters();
      const result = await chrome.runtime.sendMessage({
        type: "SEARCH_INVENTORY_BY_EMIDS",
        emids: listResult.emids,
        filters,
      });
      if (result?.ok) {
        if (result.cards.length === 0) {
          checkoutSearchCards.innerHTML = '<div class="checkout-card-item">No matching inventory cards</div>';
        } else {
          renderCheckoutCards(checkoutSearchCards, result.cards);
        }
        updateCheckoutSearchCount();
      }
    } else {
      checkoutSearchCards.innerHTML = '<div class="checkout-card-item">No cards in list or list not found</div>';
    }
  } catch (err) {
    checkoutSearchCards.innerHTML = '<div class="checkout-card-item">Failed to load list</div>';
  }

  checkoutLoadListBtn.disabled = false;
  checkoutLoadListBtn.textContent = "Load List";
});

// --- Multi-select filter dropdowns ---

function setupFilterDropdown(btn, menu, wrap) {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Close other open menus
    shadow.querySelectorAll(".filter-multi-menu").forEach((m) => {
      if (m !== menu) m.classList.add("hidden");
    });
    menu.classList.toggle("hidden");
  });

  menu.addEventListener("change", () => {
    updateFilterBtnLabel(btn, menu, btn.dataset.label || btn.textContent);
    rerunCheckoutSearch();
  });

  // Prevent menu clicks from closing
  menu.addEventListener("click", (e) => e.stopPropagation());
}

function updateFilterBtnLabel(btn, menu, defaultLabel) {
  const checked = menu.querySelectorAll('input[type="checkbox"]:checked');
  if (checked.length === 0) {
    btn.textContent = defaultLabel;
    btn.classList.remove("filter-active");
  } else if (checked.length === 1) {
    btn.textContent = checked[0].parentElement.textContent.trim();
    btn.classList.add("filter-active");
  } else {
    btn.textContent = `${defaultLabel} (${checked.length})`;
    btn.classList.add("filter-active");
  }
}

// Store default labels
filterVersionBtn.dataset.label = "Version";
filterSetBtn.dataset.label = "Set";
filterLangBtn.dataset.label = "Language";

setupFilterDropdown(filterVersionBtn, filterVersionMenu, filterVersionWrap);
setupFilterDropdown(filterSetBtn, filterSetMenu, filterSetWrap);
setupFilterDropdown(filterLangBtn, filterLangMenu, filterLangWrap);

// Close all filter menus when clicking outside
shadow.addEventListener("click", () => {
  shadow.querySelectorAll(".filter-multi-menu").forEach((m) => m.classList.add("hidden"));
});

function getCheckedValues(menu) {
  return Array.from(menu.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
}

function getCheckoutFilters() {
  const filters = {};

  // Version filter: OR within selections
  const versions = getCheckedValues(filterVersionMenu);
  if (versions.length > 0) {
    filters.versions = versions; // array: ["regular", "foil", "Borderless", ...]
  }

  // Set filter: OR within selections
  const sets = getCheckedValues(filterSetMenu);
  if (sets.length > 0) {
    filters.set_codes = sets;
  }

  // Language filter: OR within selections
  const langs = getCheckedValues(filterLangMenu);
  if (langs.length > 0) {
    filters.languages = langs;
  }

  return filters;
}

async function populateCheckoutFilters() {
  try {
    // Populate set dropdown from inventory
    const setResult = await chrome.runtime.sendMessage({ type: "GET_INVENTORY_SETS" });
    if (setResult?.ok) {
      filterSetMenu.innerHTML = "";
      for (const s of setResult.sets) {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(s.set_code)}"> ${escapeHtml(s.set_name)} (${escapeHtml(s.set_code)})`;
        filterSetMenu.appendChild(label);
      }
    }
  } catch (err) {
    console.warn("[overlay] populateCheckoutFilters error:", err);
  }
}

function rerunCheckoutSearch() {
  if (checkoutMode === "name") {
    const query = checkoutSearchInput.value.trim();
    if (query) doCheckoutSearch(query);
  } else if (checkoutMode === "list") {
    const listId = checkoutEchoListSelect.value;
    if (listId) checkoutLoadListBtn.click();
  }
}

// --- Location combobox ---

async function populateCheckoutLocations() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_INVENTORY_LOCATIONS" });
    if (result?.ok) {
      inventoryLocations = result.locations;
      // Don't show the list yet - it will show on focus
      // If a location is already entered, refresh the offset to match latest data
      refreshLocationOffset();
    }
  } catch (err) {
    console.warn("[overlay] populateCheckoutLocations error:", err);
  }
}

/**
 * Recalculate the offset input and hint based on the current location input
 * and the latest inventoryLocations data.
 */
function refreshLocationOffset() {
  const current = checkoutLocationInput.value.trim();
  if (!current) return;
  const match = inventoryLocations.find(
    (loc) => loc.tag.toLowerCase() === current.toLowerCase()
  );
  if (match) {
    checkoutOffsetInput.value = match.maxPosition + 1;
    checkoutOffsetHint.textContent = `Next position after ${match.maxPosition} existing`;
  }
}

function renderLocationList(filter) {
  const q = filter.toLowerCase();
  const matching = inventoryLocations.filter((loc) =>
    !q || loc.tag.toLowerCase().includes(q)
  );

  if (matching.length === 0) {
    checkoutLocationList.innerHTML = "";
    checkoutLocationList.classList.add("hidden");
    return;
  }

  checkoutLocationList.innerHTML = matching
    .map(
      (loc) =>
        `<div class="location-combobox-item" data-tag="${escapeHtml(loc.tag)}" data-max="${loc.maxPosition}">${escapeHtml(loc.tag)} <span class="location-combobox-count">(${loc.maxPosition} cards)</span></div>`
    )
    .join("");
  checkoutLocationList.classList.remove("hidden");
}

checkoutLocationInput.addEventListener("focus", () => {
  renderLocationList(checkoutLocationInput.value);
});

checkoutLocationInput.addEventListener("blur", () => {
  // Delay hiding to allow click events on dropdown items to fire first
  setTimeout(() => {
    checkoutLocationList.classList.add("hidden");
  }, 150);
});

checkoutLocationInput.addEventListener("input", () => {
  renderLocationList(checkoutLocationInput.value);
  // If typed value exactly matches a location, set offset
  const match = inventoryLocations.find(
    (loc) => loc.tag.toLowerCase() === checkoutLocationInput.value.trim().toLowerCase()
  );
  if (match) {
    checkoutOffsetInput.value = match.maxPosition + 1;
    checkoutOffsetHint.textContent = `Next position after ${match.maxPosition} existing`;
  } else if (checkoutLocationInput.value.trim()) {
    checkoutOffsetInput.value = 1;
    checkoutOffsetHint.textContent = "New location starts at position 1";
  } else {
    checkoutOffsetHint.textContent = "";
  }
});

checkoutLocationList.addEventListener("click", (e) => {
  const item = e.target.closest(".location-combobox-item");
  if (!item) return;
  const tag = item.dataset.tag;
  const maxPos = Number(item.dataset.max) || 0;
  checkoutLocationInput.value = tag;
  checkoutOffsetInput.value = maxPos + 1;
  checkoutOffsetHint.textContent = `Next position after ${maxPos} existing`;
  checkoutLocationList.classList.add("hidden");
});

// Close combobox list when clicking elsewhere
shadow.addEventListener("click", (e) => {
  if (!e.target.closest("#checkout-location-combobox")) {
    checkoutLocationList.classList.add("hidden");
  }
});

// --- Load checkout data (inventory stats + checkout groups) ---

async function loadCheckoutData() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_INVENTORY_STATS" });
    if (result?.ok && result.count > 0) {
      checkoutImportStatus.textContent = `${result.count.toLocaleString()} cards loaded`;
      checkoutClearInvBtn.classList.remove("hidden");
      checkoutSyncNotesBtn.classList.remove("hidden");
      checkoutSearchInput.disabled = false;
      await populateCheckoutFilters();
      await populateCheckoutLocations();
    } else {
      checkoutImportStatus.textContent = "No inventory loaded";
      checkoutClearInvBtn.classList.add("hidden");
      checkoutSyncNotesBtn.classList.add("hidden");
      checkoutSearchInput.disabled = true;
    }

    // Update checkout status from local checkout records
    const groupResult = await chrome.runtime.sendMessage({ type: "GET_CHECKOUT_GROUPS" });
    if (groupResult?.ok) {
      const total = groupResult.groups.reduce((s, g) => s + g.count, 0);
      if (total > 0) {
        accCheckoutStatus.textContent = `${total} card${total !== 1 ? "s" : ""} out`;
        accCheckoutStatus.className = "accordion-status";
      } else {
        accCheckoutStatus.textContent = "";
      }
    }
  } catch (err) {
    console.warn("[overlay] loadCheckoutData error:", err);
  }
}

// --- Inventory search (filtered) ---

let checkoutSearchDebounce = null;
checkoutSearchInput.addEventListener("input", () => {
  clearTimeout(checkoutSearchDebounce);
  const query = checkoutSearchInput.value.trim();
  if (!query) {
    checkoutSearchCards.innerHTML = "";
    updateCheckoutSearchCount();
    return;
  }
  checkoutSearchDebounce = setTimeout(() => doCheckoutSearch(query), 300);
});

async function doCheckoutSearch(query) {
  const currentQuery = checkoutSearchInput.value.trim();
  if (currentQuery !== query) return;
  try {
    checkoutSearchCards.innerHTML = '<div class="checkout-card-item">Searching...</div>';
    const filters = getCheckoutFilters();
    const result = await chrome.runtime.sendMessage({
      type: "SEARCH_INVENTORY_FILTERED",
      query,
      filters,
    });
    if (result?.ok) {
      if (result.cards.length === 0) {
        checkoutSearchCards.innerHTML = '<div class="checkout-card-item">No results</div>';
      } else {
        renderCheckoutCards(checkoutSearchCards, result.cards);
      }
      updateCheckoutSearchCount();
    } else {
      checkoutSearchCards.innerHTML = `<div class="checkout-card-item">Error: ${result?.error || "unknown"}</div>`;
    }
  } catch (err) {
    console.warn("[overlay] checkoutSearch error:", err);
    checkoutSearchCards.innerHTML = '<div class="checkout-card-item">Search failed</div>';
  }
}

/**
 * Extract base card name without parentheticals for sorting.
 * e.g., "Lightning Bolt (Borderless)" → "Lightning Bolt"
 */
function getBaseName(name) {
  if (!name) return "";
  return name.replace(/\s*\([^)]*\)\s*/g, "").trim().toLowerCase();
}

/**
 * Basic lands in WUBRG order - these sort to the end.
 */
const BASIC_LAND_ORDER = ["plains", "island", "swamp", "mountain", "forest"];

/**
 * Sort cards for Move results:
 * - Non-basic lands first, alphabetically by base name, then set, then collector number
 * - Basic lands at the end in WUBRG order
 */
function sortMoveCards(cards) {
  return [...cards].sort((a, b) => {
    const aBase = getBaseName(a.name);
    const bBase = getBaseName(b.name);

    const aBasicIdx = BASIC_LAND_ORDER.indexOf(aBase);
    const bBasicIdx = BASIC_LAND_ORDER.indexOf(bBase);

    const aIsBasic = aBasicIdx !== -1;
    const bIsBasic = bBasicIdx !== -1;

    // Basic lands go to the end
    if (aIsBasic && !bIsBasic) return 1;
    if (!aIsBasic && bIsBasic) return -1;

    // Both are basic lands - sort by WUBRG order, then set, then number
    if (aIsBasic && bIsBasic) {
      if (aBasicIdx !== bBasicIdx) return aBasicIdx - bBasicIdx;
      // Same basic land type - sort by set, then collector number
      const setCompare = (a.set_code || "").localeCompare(b.set_code || "");
      if (setCompare !== 0) return setCompare;
      return compareCollectorNumbers(a.collectors_number, b.collectors_number);
    }

    // Neither is basic - sort by base name, then set, then collector number
    const nameCompare = aBase.localeCompare(bBase);
    if (nameCompare !== 0) return nameCompare;

    const setCompare = (a.set_code || "").localeCompare(b.set_code || "");
    if (setCompare !== 0) return setCompare;

    return compareCollectorNumbers(a.collectors_number, b.collectors_number);
  });
}

/**
 * Compare collector numbers, handling numeric and alphanumeric cases.
 * e.g., "1" < "2" < "10" < "10a" < "10b"
 */
function compareCollectorNumbers(a, b) {
  const aNum = parseInt(a, 10);
  const bNum = parseInt(b, 10);

  // Both are numeric - compare as numbers
  if (!isNaN(aNum) && !isNaN(bNum)) {
    if (aNum !== bNum) return aNum - bNum;
    // Same number prefix - compare full string for suffixes (10a vs 10b)
    return (a || "").localeCompare(b || "");
  }

  // Fallback to string comparison
  return (a || "").localeCompare(b || "");
}

function renderCheckoutCards(container, cards) {
  const sorted = sortMoveCards(cards);
  container.innerHTML = sorted
    .map(
      (card) => `
    <div class="checkout-card-item" data-inventory-id="${card.echo_inventory_id}" data-emid="${card.emid}">
      <input type="checkbox" class="checkout-cb">
      <div class="checkout-card-info">
        <div class="checkout-card-name">${escapeHtml(card.name)}${card.foil ? ' <span class="badge badge-foil">Foil</span>' : ""}</div>
        <div class="checkout-card-meta">${escapeHtml(card.set_code)} #${card.collectors_number}${card.language && card.language !== "EN" ? ` · ${escapeHtml(card.language)}` : ""}${card.note ? ` · ${escapeHtml(card.note)}` : ""}</div>
      </div>
    </div>
  `
    )
    .join("");
}

// --- Checkout button ---

checkoutSearchBtn.addEventListener("click", async () => {
  const checked = checkoutSearchCards.querySelectorAll('input[type="checkbox"]:checked');
  if (checked.length === 0) return;

  const inventoryIds = Array.from(checked).map(
    (cb) => Number(cb.closest(".checkout-card-item").dataset.inventoryId)
  );

  const targetLocation = checkoutLocationInput.value.trim();
  const targetOffset = Number(checkoutOffsetInput.value) || 1;

  if (!targetLocation) {
    statusMsg.textContent = "Please select or enter a location";
    statusMsg.className = "status-message error";
    return;
  }

  checkoutSearchBtn.disabled = true;
  checkoutSearchBtn.textContent = "Moving...";

  try {
    const result = await chrome.runtime.sendMessage({
      type: "CHECKOUT_CARDS",
      inventoryIds,
      targetLocation,
      targetOffset,
    });
    if (result?.ok) {
      statusMsg.textContent = `Moved ${inventoryIds.length} card${inventoryIds.length !== 1 ? "s" : ""}`;
      statusMsg.className = "status-message";
      checkoutSearchCards.innerHTML = "";
      checkoutSearchInput.value = "";
      updateCheckoutSearchCount();
      await loadCheckoutData();

      // Open the retrieval plan
      if (result.planId) {
        openAccordion(accPlans);
        showPlanDetail(result.planId);
      }
    } else {
      statusMsg.textContent = `Move failed: ${result?.error || "unknown"}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    statusMsg.textContent = "Move failed";
    statusMsg.className = "status-message error";
  }
  checkoutSearchBtn.disabled = false;
  updateCheckoutSearchCount();
});

// ---------------------------------------------------------------------------
// Retrieval Plans
// ---------------------------------------------------------------------------

async function loadRetrievalPlans() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_RETRIEVAL_PLANS" });
    if (!result?.ok) return;

    const plans = result.plans;
    if (plans.length === 0) {
      plansList.innerHTML = "";
      plansEmpty.classList.remove("hidden");
      accPlansStatus.textContent = "";
      return;
    }

    plansEmpty.classList.add("hidden");
    accPlansStatus.textContent = `${plans.length} plan${plans.length !== 1 ? "s" : ""}`;
    accPlansStatus.className = "accordion-status";

    plansList.innerHTML = plans
      .map((p) => {
        const total = p.items ? p.items.length : 0;
        const checked = p.items ? p.items.filter((i) => i.checked).length : 0;
        return `
        <div class="checkin-group-card" data-plan-id="${p.id}">
          <div class="checkin-group-info">
            <div class="checkin-group-name">${escapeHtml(p.title)}</div>
            <div class="checkin-group-meta">${total} card${total !== 1 ? "s" : ""} · ${checked} retrieved</div>
          </div>
          <button class="btn btn-sm checkin-view-btn">View</button>
          <button class="btn btn-sm btn-danger plan-delete-btn">Delete</button>
        </div>
      `;
      })
      .join("");
  } catch (err) {
    console.warn("[overlay] loadRetrievalPlans error:", err);
  }
}

plansList.addEventListener("click", async (e) => {
  const card = e.target.closest("[data-plan-id]");
  if (!card) return;
  const planId = Number(card.dataset.planId);

  // Handle view button
  if (e.target.closest(".checkin-view-btn")) {
    await showPlanDetail(planId);
    return;
  }

  // Handle delete button
  const deleteBtn = e.target.closest(".plan-delete-btn");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "...";
    try {
      const result = await chrome.runtime.sendMessage({ type: "DELETE_RETRIEVAL_PLAN", id: planId });
      if (result?.ok) {
        statusMsg.textContent = "Plan deleted";
        statusMsg.className = "status-message";
        loadRetrievalPlans();
      } else {
        statusMsg.textContent = `Delete failed: ${result?.error || "unknown"}`;
        statusMsg.className = "status-message error";
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
      }
    } catch (err) {
      statusMsg.textContent = `Delete error: ${err.message}`;
      statusMsg.className = "status-message error";
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
    }
  }
});

async function showPlanDetail(planId) {
  currentPlanId = planId;
  plansListView.classList.add("hidden");
  plansDetailView.classList.remove("hidden");

  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_RETRIEVAL_PLAN", id: planId });
    if (!result?.ok || !result.plan) {
      plansDetailHeader.textContent = "Plan not found";
      plansDetailItems.innerHTML = "";
      return;
    }

    const plan = result.plan;
    plansDetailHeader.innerHTML = `<strong>${escapeHtml(plan.title)}</strong>`;

    // Group items by source location
    const groups = new Map();
    (plan.items || []).forEach((item, idx) => {
      const loc = item.current_location || "Unknown location";
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc).push({ ...item, _index: idx });
    });

    let html = "";
    for (const [loc, items] of groups) {
      html += `<div class="plan-location-group">`;
      html += `<div class="plan-location-header">${escapeHtml(loc)}</div>`;
      for (const item of items) {
        const checkedClass = item.checked ? " plan-item-done" : "";
        html += `
          <div class="plan-item${checkedClass}" data-plan-id="${planId}" data-item-index="${item._index}">
            <input type="checkbox" class="plan-item-cb" ${item.checked ? "checked" : ""}>
            <span class="plan-item-text">p${item.current_position || "?"} — ${escapeHtml(item.card_name)} (${escapeHtml(item.set_code)} #${item.collectors_number || ""})</span>
          </div>
        `;
      }
      html += `</div>`;
    }

    plansDetailItems.innerHTML = html;
  } catch (err) {
    console.warn("[overlay] showPlanDetail error:", err);
    plansDetailHeader.textContent = "Error loading plan";
  }
}

plansDetailItems.addEventListener("change", async (e) => {
  const cb = e.target.closest(".plan-item-cb");
  if (!cb) return;
  const item = cb.closest(".plan-item");
  const planId = Number(item.dataset.planId);
  const itemIndex = Number(item.dataset.itemIndex);
  const checked = cb.checked;

  if (checked) {
    item.classList.add("plan-item-done");
  } else {
    item.classList.remove("plan-item-done");
  }

  try {
    await chrome.runtime.sendMessage({
      type: "UPDATE_PLAN_ITEM",
      planId,
      itemIndex,
      checked,
    });
  } catch (err) {
    console.warn("[overlay] updatePlanItem error:", err);
  }
});

plansBackBtn.addEventListener("click", () => {
  plansDetailView.classList.add("hidden");
  plansListView.classList.remove("hidden");
  currentPlanId = null;
  loadRetrievalPlans();
});

plansPrintBtn.addEventListener("click", async () => {
  if (!currentPlanId) return;

  try {
    const result = await chrome.runtime.sendMessage({ type: "GET_RETRIEVAL_PLAN", id: currentPlanId });
    if (!result?.ok || !result.plan) return;

    const plan = result.plan;

    // Group items by source location
    const groups = new Map();
    (plan.items || []).forEach((item) => {
      const loc = item.current_location || "Unknown";
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc).push(item);
    });

    let listHtml = "";
    for (const [loc, items] of groups) {
      listHtml += `<h3>${loc}</h3><ul>`;
      for (const item of items) {
        const check = item.checked ? "checked" : "";
        listHtml += `<li><input type="checkbox" ${check} disabled> p${item.current_position || "?"} — ${item.card_name} (${item.set_code} #${item.collectors_number || ""})</li>`;
      }
      listHtml += `</ul>`;
    }

    const printHtml = `<!DOCTYPE html>
<html><head><title>Retrieval Plan: ${plan.title}</title>
<style>
  body { font-family: sans-serif; max-width: 700px; margin: 20px auto; }
  h2 { border-bottom: 2px solid #333; padding-bottom: 4px; }
  h3 { color: #555; margin-top: 16px; margin-bottom: 4px; }
  ul { list-style: none; padding-left: 0; }
  li { padding: 4px 0; font-size: 14px; }
  input[type="checkbox"] { margin-right: 8px; }
  @media print { body { font-size: 12px; } }
</style></head>
<body>
  <h2>Retrieval Plan: ${plan.title}</h2>
  ${listHtml}
</body></html>`;

    const w = window.open("", "_blank");
    w.document.write(printHtml);
    w.document.close();
    w.print();
  } catch (err) {
    console.warn("[overlay] print plan error:", err);
  }
});

plansDeleteBtn.addEventListener("click", async () => {
  if (!currentPlanId) return;

  plansDeleteBtn.disabled = true;
  plansDeleteBtn.textContent = "Deleting...";

  try {
    const result = await chrome.runtime.sendMessage({ type: "DELETE_RETRIEVAL_PLAN", id: currentPlanId });
    if (result?.ok) {
      statusMsg.textContent = "Plan deleted";
      statusMsg.className = "status-message";
      // Go back to list view
      plansDetailView.classList.add("hidden");
      plansListView.classList.remove("hidden");
      currentPlanId = null;
      loadRetrievalPlans();
    } else {
      statusMsg.textContent = `Delete failed: ${result?.error || "unknown"}`;
      statusMsg.className = "status-message error";
    }
  } catch (err) {
    statusMsg.textContent = `Delete error: ${err.message}`;
    statusMsg.className = "status-message error";
  }

  plansDeleteBtn.disabled = false;
  plansDeleteBtn.textContent = "Delete Plan";
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

loadState();
