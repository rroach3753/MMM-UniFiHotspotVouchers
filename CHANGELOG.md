# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

## [2.0.2] - 2026-10-24

### Added

- Display the discovered guest/hotspot network name as the module header by
  default, with support for a custom title override.
- Fall back to the generic voucher title if WLAN discovery is unavailable;
  voucher display remains available independently of network-name discovery.

## [2.0.1] - 2026-10-18

### Changed

- Preserve the original fetch timestamp when replaying cached vouchers.
- Simplify frontend sorting without changing ordering or filtering behavior.
- Enable recommended environment-aware ESLint checks and run lint/tests in CI
  on Node.js 20, 22, and 24; add timestamp and frontend regression coverage.
- Updated ESLint to 10.12.0

### Security

- Validate socket configuration before coercion, bound retained instances,
  and replay cached results for duplicate configuration messages instead of
  starting additional polling requests.
- Clamp request timeouts to 1000-30000 milliseconds.

## [2.0.0] - 2026-10-04

### Security

- Enforced server-owned site and voucher-code disclosure policies. Renderer
  payloads can no longer select a site or cause raw voucher codes to be
  broadcast unless `UNIFI_HOTSPOT_VOUCHER_CODE_POLICY=full` is explicitly set.
- Changed the voucher-code transport default to `hidden`; added a server-side
  masked mode and optional strict instance-to-site mapping.
- Changed TLS behavior to secure-by-default: `verifySSL` now defaults to `true` and helper fallback validation also defaults to certificate verification enabled.
- Added instance-scoped frontend/backend socket payload routing (`instanceId`) to reduce cross-instance data bleed.
- Added response-size guard (1 MB cap) for UniFi HTTP response buffering.
- Updated the `brace-expansion` override to 5.0.9 to address a denial-of-service vulnerability.
- Updated the `smol-toml` override to 1.8.0 to address a development-tool denial-of-service vulnerability.
- Added server-only environment variable support for UniFi credentials and API keys.
- Added behavior tests for TLS verification, response-size limits, and credential precedence.

### Changed

- Updated README security guidance to align with secure default TLS verification and self-signed fallback recommendations.
- Updated the README quick-start configuration to be directly pasteable into the MagicMirror modules array.
- Updated ESLint to 10.10.0.
- Updated CI workflows to use `actions/checkout@v7` and `actions/setup-node@v7`.

## [1.0.1] - 2026-05-10

### Added

- `requestTimeout` configuration option (default 10000ms) to prevent hangs when controller is unreachable.
- `debug` configuration option for optional console and server logging to aid troubleshooting.
- Comprehensive security documentation in README covering SSL/TLS, credentials management, and best practices.
- Enhanced logging for API endpoint attempts and authentication events.
- Race condition prevention: initialization state tracking to avoid overlapping config notifications.

### Changed

- HTTP response buffering now uses `Buffer.concat()` instead of string concatenation for improved performance.
- Voucher sorting now properly handles `null` creation timestamps using nullish coalescing operator.

### Fixed

- HTTP request timeout handling: requests now properly timeout and reject if controller is unresponsive.
- Session authentication re-authentication now properly clears session state before retrying.
- Removed unused `sessionHeaders` state variable that was never populated or used.
- Removed unused CSS classes for `expired` status that was never set by the module.

### Security

- Added documentation for file permission protection of `config.js` containing credentials.
- Clarified SSL verification default behavior and when to enable/disable it.
- Added recommended practices for API key usage and credential management.

## [1.0.0] - 2026-04-29

### Added

- Initial release of MMM-UniFiHotspotVouchers module.
- Support for UniFi OS console authentication via local username/password or API key.
- Hotspot voucher display with code, note, usage, and status information.
- Optional compact mode for narrow mirror layouts.
- Configuration option to mask voucher codes for privacy.
- Support for displaying inactive vouchers.
- Configurable refresh interval.
- Sorting by creation date or code.
- Optional summary display showing active and total voucher counts.
- Multiple display options: borders, background, and individual column visibility.
