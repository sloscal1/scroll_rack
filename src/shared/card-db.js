/**
 * IndexedDB wrapper for the card cache and application state.
 *
 * Database: echomtg_fast_inventory
 *
 * Object stores
 * ─────────────
 *  cards  (keyPath: "emid")
 *    Indexes: by_first_letter, by_set_code, by_name
 *
 *  sets   (keyPath: "set_code")
 *    Cache metadata per set (card count, cached timestamp).
 *
 *  inventory (keyPath: "echo_inventory_id")
 *    Indexes: by_emid, by_name_lower, by_set_code
 *    User's full inventory imported from EchoMTG CSV export.
 *
 *  state  (keyPath: "key")
 *    Arbitrary key/value pairs for persisting location, position,
 *    dividerEvery, foil, language, etc.
 */

import { extractVariantTags, normalizeCardName } from "./card-name-utils.js";
import {
  detectSearchIntent,
  extractTokens,
  generateInitials,
  generateProgressiveInitials,
  matchesTokenPrefixes,
  normalizeForSearch,
  scoreMatch
} from "./search-utils.js";


const DB_NAME = "echomtg_fast_inventory";
const DB_VERSION = 5;

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * Open (or create) the database.  Returns the same instance on subsequent
 * calls within the same execution context.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        // Initial database creation (v1)
        const cards = db.createObjectStore("cards", { keyPath: "emid" });
        cards.createIndex("by_first_letter", "first_letter", { unique: false });
        cards.createIndex("by_set_code", "set_code", { unique: false });
        cards.createIndex("by_name", "name_lower", { unique: false });
      }

      if (!db.objectStoreNames.contains("sets")) {
        db.createObjectStore("sets", { keyPath: "set_code" });
      }

      if (!db.objectStoreNames.contains("state")) {
        db.createObjectStore("state", { keyPath: "key" });
      }

      // Upgrade to version 2 - add search indexes
      if (oldVersion >= 1 && oldVersion < 2) {
        try {
          const cards = req.transaction.objectStore("cards");

          if (!cards.indexNames.contains("by_initials")) {
            cards.createIndex("by_initials", "initials", { unique: false });
          }
          if (!cards.indexNames.contains("by_search_normalized")) {
            cards.createIndex("by_search_normalized", "search_normalized", { unique: false });
          }

          console.log("[db] Upgraded to version 2 - added search indexes");
        } catch (err) {
          console.warn("[db] Failed to add search indexes during upgrade:", err);
        }
      }

      // Upgrade to version 3 - add checkouts store
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains("checkouts")) {
          const checkouts = db.createObjectStore("checkouts", {
            keyPath: "id",
            autoIncrement: true,
          });
          checkouts.createIndex("by_list", "list_name", { unique: false });
          checkouts.createIndex("by_emid", "emid", { unique: false });
          checkouts.createIndex("by_status", "status", { unique: false });
          console.log("[db] Upgraded to version 3 - added checkouts store");
        }
      }

      // Upgrade to version 4 - add inventory store
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains("inventory")) {
          const inv = db.createObjectStore("inventory", {
            keyPath: "echo_inventory_id",
          });
          inv.createIndex("by_emid", "emid", { unique: false });
          inv.createIndex("by_name_lower", "name_lower", { unique: false });
          inv.createIndex("by_set_code", "set_code", { unique: false });
          console.log("[db] Upgraded to version 4 - added inventory store");
        }
      }

      // Upgrade to version 5 - add retrieval_plans store, by_location index on checkouts
      if (oldVersion < 5) {
        if (!db.objectStoreNames.contains("retrieval_plans")) {
          const plans = db.createObjectStore("retrieval_plans", {
            keyPath: "id",
            autoIncrement: true,
          });
          plans.createIndex("by_created_at", "created_at", { unique: false });
          plans.createIndex("by_location", "target_location", { unique: false });
          console.log("[db] Upgraded to version 5 - added retrieval_plans store");
        }

        // Add by_location index on checkouts
        if (db.objectStoreNames.contains("checkouts")) {
          const checkouts = req.transaction.objectStore("checkouts");
          if (!checkouts.indexNames.contains("by_location")) {
            checkouts.createIndex("by_location", "target_location", { unique: false });
            console.log("[db] Added by_location index on checkouts");
          }
        }
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wrap an IDBRequest in a Promise.
 * @param {IDBRequest} req
 * @returns {Promise<any>}
 */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Wrap an IDBTransaction's completion in a Promise.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Transaction aborted"));
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

// ---------------------------------------------------------------------------
// Card record helpers
// ---------------------------------------------------------------------------

/**
 * Transform a raw API card object into the shape stored in IndexedDB.
 *
 * @param {object} raw - Card object from EchoMTG API (see neo.json for shape).
 * @param {string} setCode - Normalised set code.
 * @param {string} setName - Human-readable set name.
 * @returns {object} Card record.
 */
export function toCardRecord(raw, setCode, setName) {
  const name = (raw.name || "").trim();
  const nameLower = name.toLowerCase();
  const nameNormalized = normalizeCardName(name).toLowerCase();
  const searchNormalized = normalizeForSearch(name);
  const { tags, isFoilVariant } = extractVariantTags(name);

  // Generate search indexes for advanced search
  const tokens = extractTokens(name);
  const initials = generateInitials(name);
  const progressiveInitials = generateProgressiveInitials(name);

  return {
    emid: raw.emid,
    name,
    name_lower: nameLower,
    name_normalized: nameNormalized,
    search_normalized: searchNormalized,
    first_letter: searchNormalized.charAt(0) || "",
    tokens,
    initials,
    progressive_initials: progressiveInitials,
    set_code: setCode,
    set_name: setName,
    collectors_number: raw.collectors_number,
    rarity: (raw.rarity || "").trim(),
    main_type: (raw.main_type || "").trim(),
    image: raw.image || "",
    image_cropped: raw.image_cropped || "",
    variant_tags: tags,
    is_foil_variant: isFoilVariant,
  };
}

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

/**
 * Parse a location note like "b5r1p3" into { tag: "b5r1", position: 3 }.
 * Returns { tag: null, position: null } for empty or non-matching notes.
 *
 * @param {string} note
 * @returns {{ tag: string|null, position: number|null }}
 */
export function parseNoteLocation(note) {
  if (!note || typeof note !== "string") return { tag: null, position: null };
  const match = note.trim().match(/^(.+?)p(\d+)$/);
  if (!match) return { tag: null, position: null };
  return { tag: match[1], position: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CardDB = {
  /**
   * Store an array of card records for a set, replacing any previous cache.
   *
   * @param {string} setCode
   * @param {string} setName
   * @param {object[]} rawCards - Raw card objects from the API.
   * @returns {Promise<number>} Number of cards stored.
   */
  async cacheSet(setCode, setName, rawCards) {
    const db = await openDB();
    const tx = db.transaction(["cards", "sets"], "readwrite");
    const cardStore = tx.objectStore("cards");
    const setStore = tx.objectStore("sets");

    for (const raw of rawCards) {
      const record = toCardRecord(raw, setCode, setName);
      cardStore.put(record);
    }

    setStore.put({
      set_code: setCode,
      set_name: setName,
      card_count: rawCards.length,
      cached_at: Date.now(),
      active: true, // Default to active when cached
    });

    await txComplete(tx);
    return rawCards.length;
  },

  /**
   * Remove all cached cards for a set.
   *
   * @param {string} setCode
   * @returns {Promise<void>}
   */
  async clearSet(setCode) {
    const db = await openDB();
    const tx = db.transaction(["cards", "sets"], "readwrite");
    const cardStore = tx.objectStore("cards");
    const setStore = tx.objectStore("sets");

    // Delete cards by set_code index
    const index = cardStore.index("by_set_code");
    const range = IDBKeyRange.only(setCode);
    let cursor = await promisify(index.openCursor(range));
    while (cursor) {
      cursor.delete();
      cursor = await promisify(cursor.continue());
    }

    setStore.delete(setCode);
    await txComplete(tx);
  },

  /**
   * Clear all cached data (cards and sets).
   * @returns {Promise<void>}
   */
  async clearAll() {
    const db = await openDB();
    const tx = db.transaction(["cards", "sets"], "readwrite");
    tx.objectStore("cards").clear();
    tx.objectStore("sets").clear();
    await txComplete(tx);
  },

  /**
   * Set a cached set as active or inactive for searching.
   * @param {string} setCode
   * @param {boolean} active
   * @returns {Promise<void>}
   */
  async setSetActive(setCode, active) {
    const db = await openDB();
    const tx = db.transaction("sets", "readwrite");
    const store = tx.objectStore("sets");
    const existing = await promisify(store.get(setCode));
    if (existing) {
      existing.active = active;
      store.put(existing);
    }
    await txComplete(tx);
  },

  /**
   * Get active set codes for searching.
   * @returns {Promise<string[]>}
   */
  async getActiveSets() {
    const db = await openDB();
    const tx = db.transaction("sets", "readonly");
    const store = tx.objectStore("sets");
    const sets = await promisify(store.getAll());
    return sets
      .filter(set => set.active !== false) // Default to true if not specified
      .map(set => set.set_code);
  },

  /**
   * Check if cards need migration to new search schema.
   * @returns {Promise<boolean>} True if migration is needed
   */
  async needsSearchMigration() {
    try {
      const db = await openDB();
      const tx = db.transaction("cards", "readonly");
      const store = tx.objectStore("cards");
      
      // Get a few cards to check if they have search fields
      const cards = await promisify(store.getAll(undefined, 5));
      return cards.length > 0 && cards.some(card => !card.tokens || !card.initials);
    } catch (err) {
      console.warn("[db] Migration check failed:", err);
      return false;
    }
  },

  /**
   * Migrate existing cards to new search schema.
   * @param {function} progressCallback - Optional callback for progress updates
   * @returns {Promise<number>} Number of cards migrated
   */
  async migrateSearchSchema(progressCallback) {
    try {
      const db = await openDB();
      const tx = db.transaction("cards", "readwrite");
      const store = tx.objectStore("cards");
      
      // Get all cards
      const cards = await promisify(store.getAll());
      let migrated = 0;
      
      for (const card of cards) {
        // Check if card needs migration
        if (!card.tokens || !card.initials) {
          // Regenerate card record with new search fields
          const updated = toCardRecord(
            {
              emid: card.emid,
              name: card.name,
              collectors_number: card.collectors_number,
              rarity: card.rarity,
              main_type: card.main_type,
              image: card.image,
              image_cropped: card.image_cropped
            },
            card.set_code,
            card.set_name
          );
          
          // Preserve existing fields
          updated.variant_tags = card.variant_tags;
          updated.is_foil_variant = card.is_foil_variant;
          
          store.put(updated);
          migrated++;
        }
      }
      
      await txComplete(tx);
      return migrated;
    } catch (err) {
      console.error("[db] Migration failed:", err);
      throw err;
    }
  },

  /**
   * List cached sets with metadata.
   * @returns {Promise<object[]>}
   */
  async getCachedSets() {
    const db = await openDB();
    const tx = db.transaction("sets", "readonly");
    return promisify(tx.objectStore("sets").getAll());
  },

  /**
   * Advanced multi-strategy card search.
   *
   * Implements multiple search strategies:
   * - Initials search ("SF" → "Stormfighter Falcon")
   * - Space-separated initials ("S F" → "Stormfighter Falcon") 
   * - Multi-token search ("storm fal" → "Stormfighter Falcon")
   * - Prefix search ("sto" → "Stormfighter")
   *
   * @param {string} query - User's search input.
   * @param {string[]} [activeSets] - If provided, only return cards from
   *   these set codes. Empty array means "all cached sets".
   * @param {number} [maxResults=20]
   * @returns {Promise<object[]>} Matching card records sorted by relevance.
   */
  async searchCards(query, activeSets, maxResults = 20) {
    if (!query || !query.trim()) return [];

    const intent = detectSearchIntent(query);
    const setFilter =
      activeSets && activeSets.length > 0
        ? new Set(activeSets.map((s) => s.toUpperCase()))
        : null;

    let candidates = [];

    try {
      switch (intent.strategy) {
        case "initials":
          candidates = await this.searchByInitials(intent.query, setFilter);
          break;
          
        case "space_initials":
          candidates = await this.searchByInitials(intent.query, setFilter);
          break;
          
        case "multi_token":
          candidates = await this.searchByMultiToken(intent.tokens, intent.firstToken, setFilter);
          break;
          
        case "prefix":
          candidates = await this.searchByPrefix(intent.query, setFilter);
          break;
          
        default:
          // Fallback to basic search
          candidates = await this.searchByBasic(query, setFilter);
          break;
      }

      // Score and sort results
      if (candidates.length > 0 && intent.strategy !== "prefix") {
        const scored = candidates.map(card => ({
          card,
          score: scoreMatch(intent, card)
        }));

        scored.sort((a, b) => a.score - b.score);
        candidates = scored.map(item => item.card);
      }

      return candidates.slice(0, maxResults);
    } catch (err) {
      console.warn("[db] Advanced search failed, falling back to basic search:", err);
      return this.searchByBasic(query, setFilter, maxResults);
    }
  },

  /**
   * Search by initials using initials index.
   */
  async searchByInitials(query, setFilter) {
    const db = await openDB();
    const tx = db.transaction("cards", "readonly");
    const index = tx.objectStore("cards").index("by_initials");

    const results = [];
    return new Promise((resolve, reject) => {
      const req = index.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        
        const card = cursor.value;
        // Handle migration: check if search fields exist, if not skip
        if (!card.initials || !card.progressive_initials) {
          cursor.continue();
          return;
        }
        
        if (
          (card.initials.startsWith(query) || card.progressive_initials.includes(query)) &&
          (!setFilter || setFilter.has(card.set_code))
        ) {
          results.push(card);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Search by multi-token prefix matching.
   */
  async searchByMultiToken(tokens, firstToken, setFilter) {
    if (!firstToken) return [];

    const db = await openDB();
    const tx = db.transaction("cards", "readonly");
    
    // Use first letter of first token for initial filtering
    const index = tx.objectStore("cards").index("by_first_letter");
    const range = IDBKeyRange.only(firstToken.charAt(0));

    const results = [];
    return new Promise((resolve, reject) => {
      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        
        const card = cursor.value;
        // Handle migration: check if search fields exist
        if (!card.tokens) {
          cursor.continue();
          return;
        }
        
        const cardTokens = card.tokens || [];
        
        if (
          matchesTokenPrefixes(tokens, cardTokens) &&
          (!setFilter || setFilter.has(card.set_code))
        ) {
          results.push(card);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Search by prefix using search_normalized index.
   */
  async searchByPrefix(query, setFilter) {
    if (!query) return [];

    const db = await openDB();
    const tx = db.transaction("cards", "readonly");
    
    // Try using new search index first, fall back to first letter
    try {
      const index = tx.objectStore("cards").index("by_search_normalized");
      const lowerBound = IDBKeyRange.lowerBound(query);
      const upperBound = IDBKeyRange.upperBound(query + '\uffff'); // Unicode max char

      const results = [];
      return new Promise((resolve, reject) => {
        const req = index.openCursor(lowerBound);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || !cursor.key.startsWith(query)) {
            resolve(results);
            return;
          }
          
          const card = cursor.value;
          if (!setFilter || setFilter.has(card.set_code)) {
            results.push(card);
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      // Fall back to basic search if index doesn't exist
      console.warn("[db] search_normalized index not available, using fallback");
      return this.searchByBasic(query, setFilter);
    }
  },

  /**
   * Fallback basic search using first letter approach.
   */
  async searchByBasic(query, setFilter, maxResults = 20) {
    if (!query) return [];

    const q = query.trim().toLowerCase();
    if (!q) return [];

    const firstLetter = q.charAt(0);
    const db = await openDB();
    const tx = db.transaction("cards", "readonly");
    const index = tx.objectStore("cards").index("by_first_letter");
    const range = IDBKeyRange.only(firstLetter);

    const results = [];
    return new Promise((resolve, reject) => {
      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || results.length >= maxResults) {
          resolve(results);
          return;
        }
        const card = cursor.value;
        if (
          card.name_normalized.includes(q) &&
          (!setFilter || setFilter.has(card.set_code))
        ) {
          results.push(card);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  // -----------------------------------------------------------------------
  // Checkout tracking
  // -----------------------------------------------------------------------

  /**
   * Check out cards — create checkout records with location data.
   *
   * @param {number[]} inventoryIds - Inventory echo_inventory_id values.
   * @param {string} targetLocation - Target location tag (e.g. "deck1").
   * @param {number} targetOffset - Starting position offset at target location.
   * @returns {Promise<object[]>} Created checkout records.
   */
  async checkoutCards(inventoryIds, targetLocation, targetOffset) {
    const db = await openDB();
    const tx = db.transaction(["checkouts", "inventory"], "readwrite");
    const checkoutStore = tx.objectStore("checkouts");
    const invStore = tx.objectStore("inventory");
    const now = Date.now();
    const records = [];

    for (let i = 0; i < inventoryIds.length; i++) {
      const invId = inventoryIds[i];
      const inv = await promisify(invStore.get(invId));
      const { tag: sourceTag, position: sourcePos } = parseNoteLocation(inv?.note || "");

      const newPosition = targetOffset + i;
      const rec = {
        echo_inventory_id: invId,
        emid: inv?.emid || 0,
        card_name: inv?.name || "",
        set_code: inv?.set_code || "",
        collectors_number: inv?.collectors_number || "",
        target_location: targetLocation,
        target_position: newPosition,
        source_location: sourceTag,
        source_position: sourcePos,
        status: "out",
        checked_out_at: now,
        checked_in_at: null,
      };
      checkoutStore.put(rec);
      records.push(rec);

      // Update the local inventory note to reflect the new location
      if (inv) {
        inv.note = `${targetLocation}p${newPosition}`;
        invStore.put(inv);
      }
    }

    await txComplete(tx);
    return records;
  },

  /**
   * Check in cards — mark checkout records as returned.
   *
   * @param {number[]} ids - Checkout record IDs.
   * @param {string} [locationTag] - Return location tag.
   * @param {number} [position] - Return position.
   * @returns {Promise<number>} Number of records updated.
   */
  async checkinCards(ids, locationTag, position) {
    const db = await openDB();
    const tx = db.transaction("checkouts", "readwrite");
    const store = tx.objectStore("checkouts");
    const now = Date.now();
    let updated = 0;

    for (const id of ids) {
      const record = await promisify(store.get(id));
      if (record && record.status === "out") {
        record.status = "in";
        record.checked_in_at = now;
        if (locationTag) record.return_location = locationTag;
        if (position) record.return_position = position;
        store.put(record);
        updated++;
      }
    }

    await txComplete(tx);
    return updated;
  },

  /**
   * Get checkout groups (locations with cards still out).
   *
   * @returns {Promise<object[]>} Array of { location, count, checkedOutAt }.
   */
  async getCheckoutGroups() {
    const db = await openDB();
    const tx = db.transaction("checkouts", "readonly");
    const index = tx.objectStore("checkouts").index("by_status");
    const range = IDBKeyRange.only("out");
    const records = await promisify(index.getAll(range));

    const groups = new Map();
    for (const r of records) {
      const loc = r.target_location || r.list_name || "Unknown";
      if (!groups.has(loc)) {
        groups.set(loc, {
          location: loc,
          count: 0,
          checkedOutAt: r.checked_out_at,
        });
      }
      const g = groups.get(loc);
      g.count++;
      if (r.checked_out_at < g.checkedOutAt) {
        g.checkedOutAt = r.checked_out_at;
      }
    }

    return Array.from(groups.values());
  },

  /**
   * Get checked-out cards for a specific location.
   *
   * @param {string} location - Target location tag.
   * @returns {Promise<object[]>} Checkout records still out.
   */
  async getCheckoutCards(location) {
    const db = await openDB();
    const tx = db.transaction("checkouts", "readonly");
    const store = tx.objectStore("checkouts");
    const records = await promisify(store.getAll());

    return records.filter((r) => {
      if (r.status !== "out") return false;
      const loc = r.target_location || r.list_name || "Unknown";
      return loc === location;
    });
  },

  /**
   * Get distinct list names from all checkouts (for the dropdown).
   *
   * @returns {Promise<string[]>} Unique list names.
   */
  async getCheckoutLists() {
    const db = await openDB();
    const tx = db.transaction("checkouts", "readonly");
    const store = tx.objectStore("checkouts");
    const records = await promisify(store.getAll());
    const names = new Set(records.map((r) => r.target_location || r.list_name || "Unknown"));
    return Array.from(names).sort();
  },

  // -----------------------------------------------------------------------
  // Inventory (CSV import)
  // -----------------------------------------------------------------------

  /**
   * Import inventory records from parsed CSV data.
   * Clears existing inventory and bulk-inserts all records.
   *
   * @param {object[]} records - Array of inventory record objects.
   * @returns {Promise<number>} Number of records imported.
   */
  async importInventory(records) {
    const db = await openDB();
    const tx = db.transaction("inventory", "readwrite");
    const store = tx.objectStore("inventory");
    store.clear();

    for (const rec of records) {
      store.put(rec);
    }

    await txComplete(tx);
    return records.length;
  },

  /**
   * Search inventory by card name (substring match).
   *
   * @param {string} query
   * @param {number} [maxResults=50]
   * @returns {Promise<object[]>} Matching inventory records.
   */
  async searchInventory(query, maxResults = 50) {
    if (!query || !query.trim()) return [];

    const q = query.trim().toLowerCase();
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");

    const results = [];
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || results.length >= maxResults) {
          resolve(results);
          return;
        }
        const rec = cursor.value;
        if (rec.name_lower.includes(q)) {
          results.push(rec);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get inventory record count.
   * @returns {Promise<number>}
   */
  async getInventoryStats() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const count = await promisify(tx.objectStore("inventory").count());
    return { count };
  },

  /**
   * Clear all inventory records.
   * @returns {Promise<void>}
   */
  async clearInventory() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readwrite");
    tx.objectStore("inventory").clear();
    await txComplete(tx);
  },

  /**
   * Get inventory items that are missing note_id.
   * @returns {Promise<object[]>} Inventory records without note_id.
   */
  async getInventoryMissingNoteIds() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");
    const all = await promisify(store.getAll());
    return all.filter((rec) => !rec.note_id);
  },

  /**
   * Update note_id for inventory records.
   * @param {Array<{echo_inventory_id: number, note_id: number}>} updates
   * @returns {Promise<number>} Number of records updated.
   */
  async updateInventoryNoteIds(updates) {
    if (!updates || updates.length === 0) return 0;

    const db = await openDB();
    const tx = db.transaction("inventory", "readwrite");
    const store = tx.objectStore("inventory");
    let updated = 0;

    for (const { echo_inventory_id, note_id } of updates) {
      const rec = await promisify(store.get(echo_inventory_id));
      if (rec) {
        rec.note_id = note_id;
        store.put(rec);
        updated++;
      }
    }

    await txComplete(tx);
    return updated;
  },

  /**
   * Get a single inventory record by ID.
   * @param {number} inventoryId
   * @returns {Promise<object|undefined>}
   */
  async getInventoryItem(inventoryId) {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    return promisify(tx.objectStore("inventory").get(inventoryId));
  },

  // -----------------------------------------------------------------------
  // Inventory queries (filtered search, locations, sets, languages, variants)
  // -----------------------------------------------------------------------

  /**
   * Get distinct locations from inventory notes and active checkout target locations.
   * @returns {Promise<Map<string, number>>} Map of locationTag → maxPosition
   */
  async getInventoryLocations() {
    const db = await openDB();
    const tx = db.transaction(["inventory", "checkouts"], "readonly");
    const invStore = tx.objectStore("inventory");
    const checkoutStore = tx.objectStore("checkouts");

    const locations = new Map();

    // Scan inventory notes
    const invAll = await promisify(invStore.getAll());
    for (const rec of invAll) {
      const { tag, position } = parseNoteLocation(rec.note);
      if (tag) {
        const current = locations.get(tag) || 0;
        if (position > current) locations.set(tag, position);
      }
    }

    // Also include active checkout target locations
    const checkouts = await promisify(checkoutStore.getAll());
    for (const co of checkouts) {
      if (co.status === "out" && co.target_location) {
        const pos = co.target_position || 0;
        const current = locations.get(co.target_location) || 0;
        if (pos > current) locations.set(co.target_location, pos);
      }
    }

    return locations;
  },

  /**
   * Get distinct set_code/set_name pairs from inventory.
   * @returns {Promise<object[]>} Array of { set_code, set_name }
   */
  async getInventorySets() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");
    const all = await promisify(store.getAll());

    const sets = new Map();
    for (const rec of all) {
      if (rec.set_code && !sets.has(rec.set_code)) {
        sets.set(rec.set_code, { set_code: rec.set_code, set_name: rec.set_name || rec.set_code });
      }
    }
    return Array.from(sets.values());
  },

  /**
   * Get distinct language values from inventory.
   * @returns {Promise<string[]>}
   */
  async getInventoryLanguages() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");
    const all = await promisify(store.getAll());

    const langs = new Set();
    for (const rec of all) {
      if (rec.language) langs.add(rec.language);
    }
    return Array.from(langs).sort();
  },

  /**
   * Get distinct variant tags from inventory card names.
   * @returns {Promise<string[]>}
   */
  async getInventoryVariants() {
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");
    const all = await promisify(store.getAll());

    const variants = new Set();
    for (const rec of all) {
      const { tags } = extractVariantTags(rec.name || "");
      for (const t of tags) variants.add(t);
    }
    return Array.from(variants).sort();
  },

  /**
   * Search inventory with filters.
   *
   * @param {string} query - Name substring search.
   * @param {object} filters - { foil, variant, set_code, language }
   * @param {number} [maxResults=50]
   * @returns {Promise<object[]>}
   */
  async searchInventoryFiltered(query, filters = {}, maxResults = 50) {
    if (!query || !query.trim()) return [];

    const q = query.trim().toLowerCase();
    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const store = tx.objectStore("inventory");

    const results = [];
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || results.length >= maxResults) {
          resolve(results);
          return;
        }
        const rec = cursor.value;
        if (rec.name_lower.includes(q) && this._matchesFilters(rec, filters)) {
          results.push(rec);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Search inventory by emid list with filters.
   *
   * @param {number[]} emids - EchoMTG emid values.
   * @param {object} filters - { foil, variant, set_code, language }
   * @param {number} [maxResults=200]
   * @returns {Promise<object[]>}
   */
  async searchInventoryByEmids(emids, filters = {}, maxResults = 200) {
    if (!emids || emids.length === 0) return [];

    const db = await openDB();
    const tx = db.transaction("inventory", "readonly");
    const index = tx.objectStore("inventory").index("by_emid");

    const results = [];
    const emidSet = new Set(emids.map(Number));

    for (const emid of emidSet) {
      if (results.length >= maxResults) break;
      const range = IDBKeyRange.only(emid);
      const matches = await promisify(index.getAll(range));
      for (const rec of matches) {
        if (results.length >= maxResults) break;
        if (this._matchesFilters(rec, filters)) {
          results.push(rec);
        }
      }
    }

    return results;
  },

  /**
   * Check if an inventory record matches the given filters.
   * Multi-select arrays use OR within each filter, AND between filters.
   * @private
   */
  _matchesFilters(rec, filters) {
    // Legacy single-value filters
    if (filters.foil !== undefined && filters.foil !== null) {
      if (filters.foil !== rec.foil) return false;
    }
    if (filters.variant) {
      if (!(rec.name || "").toLowerCase().includes(filters.variant.toLowerCase())) return false;
    }
    if (filters.set_code) {
      if (rec.set_code !== filters.set_code) return false;
    }
    if (filters.language) {
      if (rec.language !== filters.language) return false;
    }

    // Multi-select version filter (OR within)
    if (filters.versions && filters.versions.length > 0) {
      const nameLower = (rec.name || "").toLowerCase();
      const matchesAny = filters.versions.some((v) => {
        if (v === "regular") return !rec.foil;
        if (v === "foil") return !!rec.foil;
        // Variant tag match (case-insensitive substring)
        return nameLower.includes(v.toLowerCase());
      });
      if (!matchesAny) return false;
    }

    // Multi-select set filter (OR within)
    if (filters.set_codes && filters.set_codes.length > 0) {
      if (!filters.set_codes.includes(rec.set_code)) return false;
    }

    // Multi-select language filter (OR within)
    if (filters.languages && filters.languages.length > 0) {
      if (!filters.languages.includes(rec.language)) return false;
    }

    return true;
  },

  // -----------------------------------------------------------------------
  // Retrieval plans
  // -----------------------------------------------------------------------

  /**
   * Save a retrieval plan.
   * @param {object} plan - Plan object with title, target_location, items, etc.
   * @returns {Promise<number>} The auto-generated plan ID.
   */
  async saveRetrievalPlan(plan) {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readwrite");
    const store = tx.objectStore("retrieval_plans");

    plan.created_at = plan.created_at || Date.now();
    plan.expires_at = plan.expires_at || plan.created_at + 30 * 24 * 60 * 60 * 1000;
    plan.status = plan.status || "active";

    const id = await promisify(store.add(plan));
    await txComplete(tx);
    return id;
  },

  /**
   * Get a retrieval plan by ID.
   * @param {number} id
   * @returns {Promise<object|undefined>}
   */
  async getRetrievalPlan(id) {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readonly");
    return promisify(tx.objectStore("retrieval_plans").get(id));
  },

  /**
   * Get all non-expired retrieval plans.
   * @returns {Promise<object[]>}
   */
  async getRetrievalPlans() {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readonly");
    const all = await promisify(tx.objectStore("retrieval_plans").getAll());
    const now = Date.now();
    return all.filter((p) => p.expires_at > now);
  },

  /**
   * Toggle a checked flag on a retrieval plan item.
   * @param {number} planId
   * @param {number} itemIndex
   * @param {boolean} checked
   * @returns {Promise<void>}
   */
  async updateRetrievalPlanItem(planId, itemIndex, checked) {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readwrite");
    const store = tx.objectStore("retrieval_plans");
    const plan = await promisify(store.get(planId));
    if (plan && plan.items && plan.items[itemIndex] !== undefined) {
      plan.items[itemIndex].checked = checked;
      store.put(plan);
    }
    await txComplete(tx);
  },

  /**
   * Delete a retrieval plan by ID.
   * @param {number} id
   * @returns {Promise<void>}
   */
  async deleteRetrievalPlan(id) {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readwrite");
    tx.objectStore("retrieval_plans").delete(id);
    await txComplete(tx);
  },

  /**
   * Delete expired retrieval plans.
   * @returns {Promise<number>} Number of plans deleted.
   */
  async cleanExpiredPlans() {
    const db = await openDB();
    const tx = db.transaction("retrieval_plans", "readwrite");
    const store = tx.objectStore("retrieval_plans");
    const all = await promisify(store.getAll());
    const now = Date.now();
    let deleted = 0;

    for (const plan of all) {
      if (plan.expires_at <= now) {
        store.delete(plan.id);
        deleted++;
      }
    }

    await txComplete(tx);
    return deleted;
  },

  // -----------------------------------------------------------------------
  // State helpers
  // -----------------------------------------------------------------------

  /**
   * Read a value from the state store.
   * @param {string} key
   * @returns {Promise<any>} The stored value, or undefined.
   */
  async getState(key) {
    const db = await openDB();
    const tx = db.transaction("state", "readonly");
    const record = await promisify(tx.objectStore("state").get(key));
    return record?.value;
  },

  /**
   * Write a value to the state store.
   * @param {string} key
   * @param {any} value
   * @returns {Promise<void>}
   */
  async setState(key, value) {
    const db = await openDB();
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put({ key, value });
    await txComplete(tx);
  },

  /**
   * Read multiple state keys at once.
   * @param {string[]} keys
   * @returns {Promise<object>} Map of key → value.
   */
  async getStates(keys) {
    const db = await openDB();
    const tx = db.transaction("state", "readonly");
    const store = tx.objectStore("state");
    const result = {};
    for (const key of keys) {
      const record = await promisify(store.get(key));
      result[key] = record?.value;
    }
    return result;
  },
};

export default CardDB;
