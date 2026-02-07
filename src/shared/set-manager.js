/**
 * Set manager for handling dynamic Magic sets with caching and change detection.
 * 
 * This module handles:
 * - Fetching sets from EchoMTG website via web scraping
 * - Caching sets in IndexedDB for offline access
 * - Detecting changes between cached and current sets
 * - Providing sets in the format expected by the content script
 */

import { fetchAllSets } from './set-scraper.js';

const SETS_CACHE_KEY = 'known_sets';
const SETS_CACHE_TIMESTAMP_KEY = 'known_sets_timestamp';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Set Manager class for handling dynamic set loading
 */
export class SetManager {
  constructor() {
    this._cachedSets = null;
    this._lastFetch = null;
  }

  /**
   * Load sets from cache, checking for updates if needed
   * @param {boolean} forceRefresh - Force refresh from API even if cache is fresh
   * @returns {Promise<Array<{code: string, name: string}>>}
   */
  async loadSets(forceRefresh = false) {
    // Always ensure we have fallback sets as a safety net
    const fallback = this.getFallbackSets();

    try {
      // Try to load from cache first
      let cachedSets = null;
      try {
        cachedSets = await this.loadCachedSets();
      } catch (cacheErr) {
        console.warn('[set-manager] Cache load failed:', cacheErr);
      }

      if (!forceRefresh && cachedSets?.sets?.length > 0 && this.isCacheFresh(cachedSets.timestamp)) {
        console.log('[set-manager] Using fresh cached sets:', cachedSets.sets.length);
        this._cachedSets = cachedSets.sets;
        this._lastFetch = cachedSets.timestamp;
        return cachedSets.sets;
      }

      // Try to fetch fresh sets from website
      let freshSets = [];
      try {
        console.log('[set-manager] Fetching fresh sets from website');
        freshSets = await fetchAllSets();
        console.log(`[set-manager] Fetch returned ${freshSets?.length || 0} sets`);
      } catch (fetchErr) {
        console.warn('[set-manager] Fetch failed:', fetchErr.message);
      }

      if (freshSets.length > 0) {
        // Check if sets have changed
        const hasChanges = !this.setsEqual(cachedSets?.sets || [], freshSets);

        if (hasChanges || forceRefresh) {
          console.log(`[set-manager] Sets changed (${freshSets.length} sets), updating cache`);
          await this.cacheSets(freshSets);
        }

        this._cachedSets = freshSets;
        this._lastFetch = Date.now();
        return freshSets;
      }

      // Fallback to cached sets if available
      if (cachedSets?.sets?.length > 0) {
        console.warn('[set-manager] Using stale cached sets');
        this._cachedSets = cachedSets.sets;
        this._lastFetch = cachedSets.timestamp;
        return cachedSets.sets;
      }

      // Final fallback to minimal static sets
      console.warn('[set-manager] Using fallback static sets');
      this._cachedSets = fallback;
      return fallback;
    } catch (error) {
      console.error('[set-manager] Unexpected error in loadSets:', error);
      this._cachedSets = fallback;
      return fallback;
    }
  }

  /**
   * Get the currently loaded sets (from memory cache)
   * @returns {Array<{code: string, name: string}>}
   */
  getKnownSets() {
    return this._cachedSets || this.getFallbackSets();
  }

  /**
   * Force refresh sets from the website
   * @returns {Promise<Array<{code: string, name: string}>>}
   */
  async refreshSets() {
    return this.loadSets(true);
  }

  /**
   * Load sets from IndexedDB cache
   * @returns {Promise<{sets: Array, timestamp: number}|null>}
   */
  async loadCachedSets() {
    try {
      const result = await chrome.storage.local.get([
        SETS_CACHE_KEY,
        SETS_CACHE_TIMESTAMP_KEY
      ]);
      
      if (result[SETS_CACHE_KEY] && result[SETS_CACHE_TIMESTAMP_KEY]) {
        return {
          sets: result[SETS_CACHE_KEY],
          timestamp: result[SETS_CACHE_TIMESTAMP_KEY]
        };
      }
      
      return null;
    } catch (error) {
      console.error('[set-manager] Failed to load cached sets:', error);
      return null;
    }
  }

  /**
   * Cache sets in IndexedDB
   * @param {Array<{code: string, name: string}>} sets
   */
  async cacheSets(sets) {
    try {
      const timestamp = Date.now();
      await chrome.storage.local.set({
        [SETS_CACHE_KEY]: sets,
        [SETS_CACHE_TIMESTAMP_KEY]: timestamp
      });
      console.log(`[set-manager] Cached ${sets.length} sets`);
    } catch (error) {
      console.error('[set-manager] Failed to cache sets:', error);
    }
  }

  /**
   * Check if cached sets are still fresh
   * @param {number} timestamp - Cache timestamp
   * @returns {boolean}
   */
  isCacheFresh(timestamp) {
    if (!timestamp) return false;
    return (Date.now() - timestamp) < CACHE_DURATION_MS;
  }

  /**
   * Compare two sets arrays for equality
   * @param {Array<{code: string, name: string}>} oldSets
   * @param {Array<{code: string, name: string}>} newSets
   * @returns {boolean}
   */
  setsEqual(oldSets, newSets) {
    if (oldSets.length !== newSets.length) return false;
    
    const oldMap = new Map(oldSets.map(set => [set.code, set.name]));
    const newMap = new Map(newSets.map(set => [set.code, set.name]));
    
    if (oldMap.size !== newMap.size) return false;
    
    for (const [code, name] of oldMap) {
      if (newMap.get(code) !== name) return false;
    }
    
    return true;
  }

  /**
   * Get fallback static sets for offline scenarios
   * @returns {Array<{code: string, name: string}>}
   */
  getFallbackSets() {
    return [
      { code: "FDN", name: "Foundations" },
      { code: "DSK", name: "Duskmourn: House of Horror" },
      { code: "BLB", name: "Bloomburrow" },
      { code: "MH3", name: "Modern Horizons 3" },
      { code: "OTJ", name: "Outlaws of Thunder Junction" },
      { code: "MKM", name: "Murders at Karlov Manor" },
      { code: "LCI", name: "The Lost Caverns of Ixalan" },
      { code: "WOE", name: "Wilds of Eldraine" },
      { code: "LTR", name: "The Lord of the Rings" },
      { code: "MOM", name: "March of the Machine" },
    ];
  }

  /**
   * Get statistics about the current set cache
   * @returns {Promise<{totalSets: number, cacheAge: number, lastRefresh: number|null}>}
   */
  async getCacheStats() {
    const cachedSets = await this.loadCachedSets();
    const cacheAge = cachedSets?.timestamp ? Date.now() - cachedSets.timestamp : null;
    
    return {
      totalSets: this._cachedSets?.length || 0,
      cacheAge,
      lastRefresh: cachedSets?.timestamp || null
    };
  }
}

// Export singleton instance
export const setManager = new SetManager();
export default setManager;