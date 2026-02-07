# Changelog

All notable changes to Scroll Rack will be documented in this file.

## [0.1.0] - 2026-02-07

### Added
- Initial release
- Fast card entry with location tracking
- EchoMTG authentication and API integration
- Set caching with card search
- Inventory CSV import from EchoMTG
- Move feature with filtered search (by name, set, version, language)
- EchoMTG list integration for selecting cards to move
- Retrieval plan generation with source location grouping
- Print/download retrieval plans
- Note sync with EchoMTG inventory
- Location autocomplete with position tracking

### Security
- Message sender validation in service worker
- Shadow DOM isolation for UI
- Narrow host permissions (echomtg.com only)
- No embedded secrets or API keys
