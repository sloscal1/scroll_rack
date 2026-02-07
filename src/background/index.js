/**
 * Service worker (background script).
 *
 * Handles all EchoMTG API communication and IndexedDB operations.
 * The content script and popup communicate with this worker exclusively
 * via BrowserAPI.sendMessage / BrowserAPI.onMessage.
 */

import BrowserAPI from "../shared/browser-api.js";
import CardDB from "../shared/card-db.js";
import EchoAPI from "../shared/echo-api.js";
import setManager from "../shared/set-manager.js";

/** Cached token so we don't hit storage on every request. */
let token = null;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Reload token from storage on service worker activation (covers restarts).
 */
const _initDone = (async () => {
  token = await EchoAPI.getStoredToken();
  if (token) {
    console.log("[sw] Token restored from storage");
  }
})();

/**
 * Ensure the token is loaded from storage before using it.
 * Guards against race conditions where a message arrives before init finishes.
 */
async function ensureToken() {
  await _initDone;
  if (!token) {
    token = await EchoAPI.getStoredToken();
  }
  return token;
}

// ---------------------------------------------------------------------------
// Extension icon click → toggle overlay in active tab
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch {
    // Content script not injected on this page — ignore
  }
});

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

BrowserAPI.onMessage(async (message, sender) => {
  // Validate that messages come from our own extension
  if (sender.id !== chrome.runtime.id) {
    console.warn("[sw] Rejected message from unknown sender:", sender.id);
    return { error: "Unauthorized sender" };
  }

  const { type } = message;

  switch (type) {
    case "LOGIN":
      return handleLogin(message);
    case "LOGOUT":
      return handleLogout();
    case "CACHE_SETS":
      return handleCacheSets(message);
    case "SEARCH_CARDS":
      return handleSearchCards(message);
    case "ADD_CARD":
      return handleAddCard(message);
    case "GET_STATE":
      return handleGetState(message);
    case "SET_STATE":
      return handleSetState(message);
    case "GET_CACHED_SETS":
      return handleGetCachedSets();
    case "CLEAR_SET":
      return handleClearSet(message);
    case "CLEAR_ALL":
      return handleClearAll();
    case "GET_ACTIVE_SETS":
      return handleGetActiveSets();
    case "SET_SET_ACTIVE":
      return handleSetSetActive(message);
    case "GET_SEARCH_MIGRATION_STATUS":
      return handleGetSearchMigrationStatus();
    case "MIGRATE_SEARCH_SCHEMA":
      return handleMigrateSearchSchema(message);
    case "SEARCH_SETS":
      return handleSearchSets(message);
    case "CHECKOUT_CARDS":
      return handleCheckoutCards(message);
    case "CHECKIN_CARDS":
      return handleCheckinCards(message);
    case "GET_CHECKOUT_GROUPS":
      return handleGetCheckoutGroups();
    case "GET_CHECKOUT_CARDS":
      return handleGetCheckoutCards(message);
    case "GET_CHECKOUT_LISTS":
      return handleGetCheckoutLists();
    case "SEARCH_INVENTORY":
      return handleSearchInventory(message);
    case "SEARCH_INVENTORY_FILTERED":
      return handleSearchInventoryFiltered(message);
    case "SEARCH_INVENTORY_BY_EMIDS":
      return handleSearchInventoryByEmids(message);
    case "IMPORT_INVENTORY":
      return handleImportInventory(message);
    case "GET_INVENTORY_STATS":
      return handleGetInventoryStats();
    case "CLEAR_INVENTORY":
      return handleClearInventory();
    case "GET_INVENTORY_LOCATIONS":
      return handleGetInventoryLocations();
    case "GET_INVENTORY_SETS":
      return handleGetInventorySets();
    case "GET_INVENTORY_LANGUAGES":
      return handleGetInventoryLanguages();
    case "GET_INVENTORY_VARIANTS":
      return handleGetInventoryVariants();
    case "GET_ECHO_LISTS":
      return handleGetEchoLists();
    case "GET_ECHO_LIST":
      return handleGetEchoList(message);
    case "SAVE_RETRIEVAL_PLAN":
      return handleSaveRetrievalPlan(message);
    case "GET_RETRIEVAL_PLANS":
      return handleGetRetrievalPlans();
    case "GET_RETRIEVAL_PLAN":
      return handleGetRetrievalPlan(message);
    case "UPDATE_PLAN_ITEM":
      return handleUpdatePlanItem(message);
    case "DELETE_RETRIEVAL_PLAN":
      return handleDeleteRetrievalPlan(message);
    case "GET_KNOWN_SETS":
      return handleGetKnownSets(message);
    case "REFRESH_KNOWN_SETS":
      return handleRefreshKnownSets();
    case "SYNC_NOTE_IDS":
      return handleSyncNoteIds();
    default:
      return { error: `Unknown message type: ${type}` };
  }
});

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

async function handleLogin({ email, password }) {
  try {
    const result = await EchoAPI.login(email, password);
    token = result.token;
    return { ok: true, user: result.user };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleLogout() {
  token = null;
  await EchoAPI.logout();
  return { ok: true };
}

/**
 * Cache one or more sets.
 *
 * Sends progress updates back to the caller via a streaming pattern:
 * since chrome.runtime.sendMessage only supports a single response, we
 * do all work before responding with the final result.
 *
 * @param {object} message - { setCodes: string[] }
 * @returns {{ ok: boolean, results: object[], error?: string }}
 */
async function handleCacheSets({ setCodes }) {
  if (!token) return { ok: false, error: "Not authenticated" };
  if (!setCodes || setCodes.length === 0) {
    return { ok: false, error: "No set codes provided" };
  }

  const results = [];

  for (const setCode of setCodes) {
    try {
      const rawCards = await EchoAPI.getSetAll(setCode, token);
      if (rawCards.length === 0) {
        results.push({ setCode, ok: false, error: "No cards returned" });
        continue;
      }

      // Derive set name from the first card's "set" field
      const setName = rawCards[0]?.set || setCode;
      const count = await CardDB.cacheSet(setCode, setName, rawCards);
      results.push({ setCode, ok: true, cardCount: count });
    } catch (err) {
      results.push({ setCode, ok: false, error: err.message });
    }
  }

  return { ok: true, results };
}

async function handleSearchCards({ query, activeSets }) {
  try {
    const cards = await CardDB.searchCards(query, activeSets);
    return { ok: true, cards };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Add a card to inventory, then attach a location note.
 *
 * @param {object} message
 * @param {number} message.emid
 * @param {number} message.foil - 0 = regular, 1 = foil
 * @param {string} message.condition - e.g. "NM"
 * @param {string} message.language - e.g. "EN"
 * @param {string} message.locationTag - e.g. "b5r1"
 * @param {number} message.position - current position counter
 */
async function handleAddCard({
  emid,
  foil,
  condition,
  language,
  locationTag,
  position,
}) {
  if (!token) return { ok: false, error: "Not authenticated" };

  try {
    // Step 1: add to inventory
    const addResult = await EchoAPI.addInventoryBatch(
      [{ emid, quantity: 1, foil: foil || 0, condition: condition || "NM", language: language || "EN" }],
      token
    );

    // Step 2: extract the inventory ID from the response
    // The response shape is not fully documented; try common paths.
    const inventoryId =
      addResult?.items?.[0]?.echo_inventory_id ||
      addResult?.items?.[0]?.id ||
      addResult?.inventory_id ||
      addResult?.id ||
      null;

    // Step 3: attach location note if we got an ID
    const noteText = `${locationTag}p${position}`;
    let noteOk = false;

    if (inventoryId) {
      try {
        await EchoAPI.createNote(inventoryId, "inventory", noteText, token);
        noteOk = true;
      } catch (noteErr) {
        console.warn("[sw] Note creation failed:", noteErr.message);
        // Card was added but note failed — still report partial success
      }
    } else {
      console.warn(
        "[sw] Could not extract inventory ID from add response:",
        JSON.stringify(addResult)
      );
    }

    // Step 4: increment position and persist
    const newPosition = position + 1;
    await CardDB.setState("position", newPosition);

    return {
      ok: true,
      inventoryId,
      noteOk,
      noteText,
      newPosition,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetState({ keys }) {
  try {
    if (Array.isArray(keys)) {
      const values = await CardDB.getStates(keys);
      return { ok: true, values };
    }
    const value = await CardDB.getState(keys);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSetState({ key, value }) {
  try {
    await CardDB.setState(key, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetCachedSets() {
  try {
    const sets = await CardDB.getCachedSets();
    return { ok: true, sets };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleClearSet({ setCode }) {
  try {
    await CardDB.clearSet(setCode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleClearAll() {
  try {
    await CardDB.clearAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetActiveSets() {
  try {
    const activeSets = await CardDB.getActiveSets();
    return { ok: true, activeSets };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSetSetActive({ setCode, active }) {
  try {
    await CardDB.setSetActive(setCode, active);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetSearchMigrationStatus() {
  try {
    const needsMigration = await CardDB.needsSearchMigration();
    return { ok: true, needsMigration };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleMigrateSearchSchema() {
  try {
    const migrated = await CardDB.migrateSearchSchema((progress) => {
      // Could send progress updates via different channel if needed
      console.log(`Migration progress: ${progress.current}/${progress.total} (${progress.migrated} migrated)`);
    });
    return { ok: true, migrated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSearchSets({ query }) {
  if (!token) {
    return { ok: false, error: "Not authenticated" };
  }

  try {
    // Search for sets by name or code using EchoMTG API
    const searchResults = await EchoAPI.searchSets(query, token);

    // Transform to our internal format
    const sets = searchResults.map(set => ({
      set_code: set.code,
      set_name: set.name,
      // We don't know card count until we cache it
    }));

    return { ok: true, sets };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Check Out / Check In handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCards({ inventoryIds, targetLocation, targetOffset }) {
  try {
    const loc = targetLocation || "Unknown";
    const offset = targetOffset || 1;

    const records = await CardDB.checkoutCards(inventoryIds, loc, offset);

    // Update notes on EchoMTG for each checked-out card
    const t = await ensureToken();
    if (t) {
      for (const rec of records) {
        if (rec.echo_inventory_id) {
          const noteText = `${loc}p${rec.target_position}`;
          try {
            // Get local inventory record to check for stored note_id
            const invItem = await CardDB.getInventoryItem(rec.echo_inventory_id);
            const storedNoteId = invItem?.note_id;

            if (storedNoteId) {
              // Edit existing note using stored note_id
              console.log(`[sw] Editing note ${storedNoteId} for inventory ${rec.echo_inventory_id}: ${noteText}`);
              await EchoAPI.editNote(storedNoteId, noteText, t);
            } else {
              // No note_id stored, create new note
              console.log(`[sw] No note_id stored, creating for inventory ${rec.echo_inventory_id}: ${noteText}`);
              const createResult = await EchoAPI.createNote(rec.echo_inventory_id, "inventory", noteText, t);

              // Try to extract and store the new note_id from the response
              const newNoteId = createResult?.id || createResult?.note_id || createResult?.note?.id;
              if (newNoteId) {
                console.log(`[sw] Storing new note_id ${newNoteId} for inventory ${rec.echo_inventory_id}`);
                await CardDB.updateInventoryNoteIds([{ echo_inventory_id: rec.echo_inventory_id, note_id: Number(newNoteId) }]);
              }
            }
          } catch (noteErr) {
            console.warn(`[sw] Note update failed for ${rec.echo_inventory_id}:`, noteErr.message);
          }
        }
      }
    }

    // Build and save retrieval plan
    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10);
    const plan = {
      title: `${dateStr} ${loc}`,
      target_location: loc,
      target_offset: offset,
      created_at: now,
      expires_at: now + 30 * 24 * 60 * 60 * 1000,
      status: "active",
      items: records.map((r) => ({
        emid: r.emid,
        echo_inventory_id: r.echo_inventory_id,
        card_name: r.card_name,
        set_code: r.set_code,
        collectors_number: r.collectors_number,
        current_location: r.source_location,
        current_position: r.source_position,
        checked: false,
      })),
    };

    const planId = await CardDB.saveRetrievalPlan(plan);

    return { ok: true, count: records.length, planId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleCheckinCards({ ids, locationTag, position }) {
  try {
    const count = await CardDB.checkinCards(ids, locationTag, position);
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetCheckoutGroups() {
  try {
    const groups = await CardDB.getCheckoutGroups();
    return { ok: true, groups };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetCheckoutCards({ location }) {
  try {
    const records = await CardDB.getCheckoutCards(location);
    const cards = records.map((r) => ({
      id: r.id,
      emid: r.emid,
      echoInventoryId: r.echo_inventory_id,
      cardName: r.card_name,
      setCode: r.set_code,
      collectorsNumber: r.collectors_number,
      targetLocation: r.target_location,
      targetPosition: r.target_position,
      sourceLocation: r.source_location,
      sourcePosition: r.source_position,
      checkedOutAt: r.checked_out_at,
    }));
    return { ok: true, cards };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetCheckoutLists() {
  try {
    const stats = await CardDB.getInventoryStats();
    return { ok: true, hasInventory: stats.count > 0, count: stats.count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSearchInventory({ query }) {
  try {
    const cards = await CardDB.searchInventory(query);
    return { ok: true, cards };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleImportInventory({ records }) {
  try {
    const count = await CardDB.importInventory(records);
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetInventoryStats() {
  try {
    const stats = await CardDB.getInventoryStats();
    return { ok: true, ...stats };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleClearInventory() {
  try {
    await CardDB.clearInventory();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSearchInventoryFiltered({ query, filters }) {
  try {
    const cards = await CardDB.searchInventoryFiltered(query, filters || {});
    return { ok: true, cards };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSearchInventoryByEmids({ emids, filters }) {
  try {
    const cards = await CardDB.searchInventoryByEmids(emids, filters || {});
    return { ok: true, cards };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetInventoryLocations() {
  try {
    const locMap = await CardDB.getInventoryLocations();
    // Convert Map to array of { tag, maxPosition } for serialization
    const locations = Array.from(locMap.entries()).map(([tag, maxPosition]) => ({
      tag,
      maxPosition,
    }));
    return { ok: true, locations };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetInventorySets() {
  try {
    const sets = await CardDB.getInventorySets();
    return { ok: true, sets };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetInventoryLanguages() {
  try {
    const languages = await CardDB.getInventoryLanguages();
    return { ok: true, languages };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetInventoryVariants() {
  try {
    const variants = await CardDB.getInventoryVariants();
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetEchoLists() {
  const t = await ensureToken();
  if (!t) return { ok: false, error: "Not authenticated" };
  try {
    const data = await EchoAPI.getLists(t);
    // EchoMTG returns { status, message, lists: { "145": {...}, "825": {...} } }
    let lists = [];
    if (Array.isArray(data)) {
      lists = data;
    } else if (data?.lists) {
      if (Array.isArray(data.lists)) {
        lists = data.lists;
      } else if (typeof data.lists === "object") {
        // Object with numeric ID keys — the actual EchoMTG format
        lists = Object.values(data.lists);
      }
    }
    // Normalize field names
    const normalized = lists
      .filter((l) => l && typeof l === "object")
      .map((l) => ({
        id: l.id || l.list_id || "",
        name: l.name || l.list_name || `List ${l.id || l.list_id || ""}`,
      }));
    return { ok: true, lists: normalized };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetEchoList({ listId }) {
  const t = await ensureToken();
  if (!t) return { ok: false, error: "Not authenticated" };
  try {
    const data = await EchoAPI.getList(listId, t);
    // Extract items from various response shapes
    let items = [];
    if (data?.items && Array.isArray(data.items)) {
      items = data.items;
    } else if (data?.list?.items && Array.isArray(data.list.items)) {
      items = data.list.items;
    } else {
      // Try to extract items from object with numeric keys
      for (const key of Object.keys(data || {})) {
        const val = data[key];
        if (val && typeof val === "object" && (val.emid || val.echo_id)) {
          items.push(val);
        }
      }
    }
    const emids = items.map((i) => Number(i.emid || i.echo_id || i.id || 0)).filter((n) => n > 0);
    const listName = data?.name || data?.list?.name || data?.list_name || `List ${listId}`;
    return { ok: true, emids, listName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleSaveRetrievalPlan({ plan }) {
  try {
    const id = await CardDB.saveRetrievalPlan(plan);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetRetrievalPlans() {
  try {
    const plans = await CardDB.getRetrievalPlans();
    return { ok: true, plans };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetRetrievalPlan({ id }) {
  try {
    const plan = await CardDB.getRetrievalPlan(id);
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleUpdatePlanItem({ planId, itemIndex, checked }) {
  try {
    await CardDB.updateRetrievalPlanItem(planId, itemIndex, checked);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleDeleteRetrievalPlan({ id }) {
  try {
    await CardDB.deleteRetrievalPlan(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleGetKnownSets({ forceRefresh } = {}) {
  try {
    console.log("[sw] Loading known sets...", forceRefresh ? "(force refresh)" : "");
    const sets = await setManager.loadSets(forceRefresh);
    console.log(`[sw] Loaded ${sets?.length || 0} sets`);
    return { ok: true, sets: sets || [] };
  } catch (err) {
    console.error("[sw] handleGetKnownSets error:", err);
    return { ok: false, error: err.message, sets: [] };
  }
}

async function handleRefreshKnownSets() {
  try {
    console.log("[sw] Force refreshing known sets...");
    // Clear the cache first
    await chrome.storage.local.remove(["known_sets", "known_sets_timestamp"]);
    const sets = await setManager.loadSets(true);
    console.log(`[sw] Refreshed ${sets?.length || 0} sets`);
    return { ok: true, sets: sets || [] };
  } catch (err) {
    console.error("[sw] handleRefreshKnownSets error:", err);
    return { ok: false, error: err.message, sets: [] };
  }
}

/**
 * Sync note_ids from EchoMTG's inventory search API.
 * Fetches inventory in batches and extracts note_id for each item.
 */
async function handleSyncNoteIds() {
  const t = await ensureToken();
  if (!t) return { ok: false, error: "Not authenticated" };

  try {
    // Get local inventory items missing note_ids
    const missing = await CardDB.getInventoryMissingNoteIds();
    if (missing.length === 0) {
      return { ok: true, synced: 0, message: "All items have note_ids" };
    }

    console.log(`[sw] Syncing note_ids for ${missing.length} inventory items`);

    // Build a map of echo_inventory_id -> local record for quick lookup
    const localMap = new Map(missing.map((r) => [r.echo_inventory_id, r]));
    const updates = [];
    let start = 0;
    const pageSize = 100;
    let totalFetched = 0;

    // Paginate through EchoMTG inventory using /inventory/view/
    while (true) {
      console.log(`[sw] Fetching inventory page start=${start}`);

      const data = await EchoAPI.getInventory(t, start, pageSize);
      console.log(`[sw] Inventory response: ${data.message}`);

      // Extract items from response
      const items = data?.items || [];

      console.log(`[sw] Found ${items.length} items in page`);
      if (items.length === 0) break;

      totalFetched += items.length;

      // Match items to local inventory and extract note_id
      for (const item of items) {
        const invId = Number(item.inventory_id);
        if (localMap.has(invId)) {
          // note_id is 0 when no note exists, only store if > 0
          const noteId = Number(item.note_id);
          if (noteId > 0) {
            updates.push({ echo_inventory_id: invId, note_id: noteId });
          }
          localMap.delete(invId); // Remove from pending (whether or not it had a note)
        }
      }

      // If we've found all missing items or reached end of data, stop
      if (localMap.size === 0 || items.length < pageSize) break;
      start += pageSize;

      // Safety limit to avoid infinite loops
      if (start > 50000) {
        console.warn("[sw] Hit safety limit on inventory sync");
        break;
      }
    }

    // Apply updates to local DB
    const synced = await CardDB.updateInventoryNoteIds(updates);
    console.log(`[sw] Synced ${synced} note_ids (fetched ${totalFetched} items from API)`);

    return {
      ok: true,
      synced,
      total: missing.length,
      remaining: missing.length - synced,
    };
  } catch (err) {
    console.error("[sw] Sync note_ids failed:", err);
    return { ok: false, error: err.message };
  }
}
