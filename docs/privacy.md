# Privacy Policy for Scroll Rack

**Last Updated**: 2026-02-07

## Overview

Scroll Rack is a Chrome extension that helps you manage your Magic: The Gathering card collection by connecting your physical storage locations with your EchoMTG inventory.

This privacy policy explains what data the extension collects, how it's used, and how it's protected.

## Data Collection

### Data We Collect

1. **EchoMTG Credentials**
   - Your email and password are used only for authentication
   - Passwords are never stored; only the session token is retained

2. **Session Token**
   - Your EchoMTG API session token is stored locally to maintain login
   - Stored in Chrome's extension storage (encrypted by the browser)

3. **Card Cache Data**
   - Card names, images, set codes, and collector numbers from sets you choose to cache
   - This data comes from EchoMTG's public card database

4. **Inventory Data**
   - Card collection data you import from your EchoMTG CSV export
   - Includes card names, set codes, quantities, conditions, and location notes

5. **Application State**
   - Your preferences (default location, position counter, language settings)
   - Retrieval plan data (pick lists you generate)

### Data We Do NOT Collect

- We do not collect browsing history
- We do not track your activity outside of echomtg.com
- We do not collect analytics or usage statistics
- We do not collect any personally identifiable information beyond your EchoMTG login

## Data Storage

All data is stored locally on your device using:
- **IndexedDB**: Card cache, inventory, and retrieval plans
- **Chrome Storage API**: Session token and user preferences

No data is stored on external servers controlled by us.

## Data Sharing

We do not share your data with any third parties.

The only external communication is with EchoMTG's servers (api.echomtg.com) for:
- User authentication
- Fetching card data for sets you cache
- Adding cards to your inventory
- Reading and writing location notes

This communication uses your own EchoMTG account credentials.

## Data Security

- All API communication uses HTTPS encryption
- Session tokens are stored in Chrome's secure extension storage
- The extension uses Chrome Manifest V3 security features
- No sensitive data is logged or exposed

## Data Retention

- **Session token**: Retained until you log out or clear extension data
- **Card cache**: Retained until you manually clear sets
- **Inventory data**: Retained until you clear it or reimport
- **Retrieval plans**: Auto-expire after 30 days

## Your Rights

You can:
- **View your data**: All data is stored locally and visible in Chrome DevTools
- **Delete your data**: Use the extension's "Clear" buttons or uninstall the extension
- **Export your data**: Inventory can be re-exported from EchoMTG

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be noted by updating the "Last Updated" date above.

## Contact

For questions about this privacy policy or the extension, please open an issue at the project repository.

## Compliance

This extension is designed to comply with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR) principles
- California Consumer Privacy Act (CCPA) principles
