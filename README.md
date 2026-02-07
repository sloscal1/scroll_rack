# Scroll Rack

A Chrome extension that connects your physical MTG card storage locations with your EchoMTG inventory. Quickly add cards to your collection, track where they're stored, and generate retrieval plans when building decks.

## Features

- **Fast Card Entry**: Search and add cards to your EchoMTG inventory with automatic location tracking
- **Location Management**: Track physical storage locations (binders, boxes, rows) with position numbers
- **Inventory Search**: Search your imported inventory by name, set, language, or card version
- **Retrieval Plans**: Generate pick lists when you need to gather cards from storage
- **EchoMTG Integration**: Syncs card locations as notes in your EchoMTG inventory

## Installation

### From Source (Development)

1. Clone the repository
2. `nvm use` (or ensure Node 20+)
3. `npm install && npm run build`
4. Open Chrome and navigate to `chrome://extensions`
5. Enable "Developer mode" (toggle in top right)
6. Click "Load unpacked" and select the `dist/extension` directory

### Required Setup

1. Log in with your EchoMTG credentials
2. Cache one or more sets you want to search
3. (Optional) Import your inventory CSV from EchoMTG for the Move feature

## Usage

### Adding Cards

1. Open the overlay on any echomtg.com page (click the extension icon on the bottom right or press `Ctrl+Shift+E`)
2. Set your location tag (e.g., "b5r1" for binder 5, row 1)
3. Search for a card name - all caps will match first letters of multi-word names, like `SG` will match `Sliver Gravemother`
4. Use arrow keys to select, Enter to add
5. The extension automatically tracks position numbers as notes

### Moving Cards

1. Import your inventory CSV from EchoMTG
2. Search for cards or load an EchoMTG list you've previously used
3. Filter by version, set, or language
4. Select a target location
5. Click "Move" to generate a retrieval plan

### Retrieval Plans

Retrieval plans group cards by their current storage location so you can efficiently gather them. Each plan shows:
- Cards organized by source location
- Position numbers for quick finding
- Checkbox tracking for retrieved cards
- Print option for offline use

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
nvm use          # Use Node 20+
npm install
```

### Scripts

```bash
npm run build       # Production build → dist/extension/
npm run dev         # Watch mode (rebuilds on changes)
npm test            # Run unit tests
npm run test:watch  # Tests in watch mode
npm run pack        # Zip dist/ for Chrome Web Store upload
```

### Project Structure

```
scroll-rack/
  src/
    background/         # Service worker (MV3 background script)
      index.js
    content-scripts/    # Content script (in-page overlay UI)
      main.js           # Shadow DOM UI and event handlers
      content.css       # Overlay styles
    shared/             # Shared libraries
      browser-api.js    # Cross-browser API wrapper
      card-db.js        # IndexedDB operations
      echo-api.js       # EchoMTG API client with rate limiting
      search-utils.js   # Card search strategies
      card-name-utils.js # Card name normalization
      rate-limiter.js   # Promise-queue rate limiter
      set-manager.js    # Set caching logic
      set-scraper.js    # Set list scraping
    manifest/
      manifest.base.json  # Source-of-truth manifest
    assets/icons/        # Extension icons
  tests/
    unit/               # Unit tests (vitest)
    mocks/              # Test mocks (Chrome API)
  scripts/              # Build & packaging scripts
  docs/                 # Privacy policy, store listing
  dist/extension/       # Built output (load this in Chrome)
```

### Architecture

- **Content Script**: Runs on echomtg.com pages, renders overlay in Shadow DOM
- **Service Worker**: Handles all API calls and IndexedDB operations
- **Message Passing**: Content script communicates with service worker via `chrome.runtime.sendMessage`

### Security

The extension follows Chrome Manifest V3 security best practices:
- Minimal permissions (only `storage`)
- Narrow host permissions (echomtg.com domains only)
- No inline scripts or eval
- Shadow DOM isolation from host page
- Message sender validation

## Privacy

See [docs/privacy.md](./docs/privacy.md) for the privacy policy.

### Data Stored

- **EchoMTG Auth Token**: Stored in chrome.storage.local, used for API calls
- **Cached Card Data**: Card names, images, set info from cached sets
- **Inventory Data**: Imported from your EchoMTG CSV (card names, locations)
- **Retrieval Plans**: Generated locally, auto-expire after 30 days

No data is sent to third parties. All data synced to EchoMTG uses your own account.

## Permissions Explained

| Permission | Reason |
|------------|--------|
| `storage` | Store auth token, cached cards, and local state |
| `echomtg.com/*` | Inject overlay on EchoMTG pages |
| `api.echomtg.com/*` | Make API calls for login, card data, and notes |

## License

MIT
