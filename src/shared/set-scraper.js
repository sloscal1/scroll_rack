/**
 * Set scraping utilities for fetching Magic set data from EchoMTG website.
 * 
 * Since there's no API endpoint for just the set names/codes, we need to
 * parse the HTML from https://www.echomtg.com/mtg/sets/full-listing/
 */

/**
 * Fetch and parse the EchoMTG sets page to extract all Magic sets
 * @returns {Promise<Array<{code: string, name: string}>>}
 */
export async function fetchAllSets() {
  try {
    console.log('[set-scraper] Fetching from https://www.echomtg.com/mtg/sets/full-listing/');
    const response = await fetch('https://www.echomtg.com/mtg/sets/full-listing/');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`[set-scraper] Received ${html.length} bytes of HTML`);
    const parsedSets = parseSetsHTML(html);
    console.log(`[set-scraper] Parsed ${parsedSets.length} sets`);
    
    // Update global KNOWN_SETS in content script
    if (typeof window !== 'undefined' && window.KNOWN_SETS) {
      window.KNOWN_SETS = parsedSets;
      console.log(`[set-scraper] Updated KNOWN_SETS with ${parsedSets.length} sets`);
    }
    
    return parsedSets;
  } catch (error) {
    console.error('[set-scraper] Failed to fetch sets:', error);
    throw error;
  }
}

/**
 * Parse HTML content to extract set information
 * @param {string} html - HTML content from the sets page
 * @returns {Array<{code: string, name: string}>}
 */
export function parseSetsHTML(html) {
  let sets = [];

  // Check if DOMParser is available (not in service workers)
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Common patterns for set listings:
    const possibleSelectors = [
      'a[href*="/mtg/sets/"]',           // Links to set pages
    ];

    for (const selector of possibleSelectors) {
      const elements = doc.querySelectorAll(selector);

      if (elements.length > 0) {
        console.log(`[set-scraper] Trying selector: ${selector}, found ${elements.length} elements`);

        for (const element of elements) {
          const set = extractSetFromElement(element);
          if (set) {
            sets.push(set);
          }
        }

        if (sets.length > 10) { // If we found a reasonable number of sets, this is likely the right selector
          console.log(`[set-scraper] Successfully parsed ${sets.length} sets using selector: ${selector}`);
          break;
        } else {
          sets.length = 0; // Clear and try next selector
        }
      }
    }
  }

  // Fallback: use regex pattern matching (works in service workers)
  if (sets.length === 0) {
    console.log('[set-scraper] Using regex pattern matching for set extraction');
    sets = extractSetsFromText(html);
  }

  // Remove duplicates, preserving original parse order (newest sets first)
  const uniqueSets = Array.from(
    new Map(sets.map(set => [set.code, set])).values()
  );

  console.log(`[set-scraper] Extracted ${uniqueSets.length} unique sets`);
  return uniqueSets;
}

/**
 * Extract set information from a DOM element
 * @param {Element} element - DOM element containing set information
 * @returns {{code: string, name: string}|null}
 */
function extractSetFromElement(element) {
  // Try different methods to extract set name and code
  
  // Method 1: Check for data attributes
  const setCode = element.dataset.setCode || element.dataset.code;
  const setName = element.dataset.setName || element.dataset.name;
  
  // Method 2: Parse from link href and text content
  if (element.tagName === 'A' && element.href) {
    const hrefMatch = element.href.match(/\/mtg\/sets\/([a-z0-9]{2,5})/i);
    if (hrefMatch) {
      const code = hrefMatch[1].toUpperCase();
      const name = element.textContent.trim();
      if (name && name.length > 2) {
        return { code, name };
      }
    }
  }
  
  return null;
}

/**
 * Fallback method to extract sets from raw text using pattern matching
 * @param {string} html - Raw HTML content
 * @returns {Array<{code: string, name: string}>}
 */
function extractSetsFromText(html) {
  const sets = [];

  // Try to find links to set pages: /mtg/sets/CODE/
  const linkPattern = /\/mtg\/sets\/([a-z0-9]{2,5})\/[^"]*"[^>]*>([^<]+)</gi;
  let match;
  let displayOrder = 0;

  while ((match = linkPattern.exec(html)) !== null) {
    const code = match[1].toUpperCase();
    const name = match[2].trim();
    if (name.length > 2 && !name.toLowerCase().includes('javascript')) {
      sets.push({ code, name, displayOrder: displayOrder++ });
    }
  }

  console.log(`[set-scraper] Link pattern found ${sets.length} sets`);
  if (sets.length > 20) {
    return sets;
  }

  // Fallback: try the [CODE]Name format
  sets.length = 0;
  displayOrder = 0;
  const echoPattern = /\[([A-Z]{2,5})\]([A-Za-z][^<\n]{5,80})/g;

  while ((match = echoPattern.exec(html)) !== null) {
    const code = match[1].toUpperCase();
    const name = match[2].trim();
    
    // Filter out common false positives, but keep promo sets and tokens
    if (name.length > 3 && 
        !name.toLowerCase().includes('javascript') &&
        (!name.toLowerCase().includes('promo') ||
         name.toLowerCase().includes('promo pack') || // Keep promo packs
         code.startsWith('P') || // Keep promo codes
         name.toLowerCase().includes('tokens')) // Keep tokens
       ) {
      sets.push({ 
        code, 
        name,
        displayOrder: displayOrder++ // Preserve EchoMTG chronological order
      });
    }
  }
  console.log(`[set-scraper] Echo pattern found ${sets.length} sets`);
  return sets;
}