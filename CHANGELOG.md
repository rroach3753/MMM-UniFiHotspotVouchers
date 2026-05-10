# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

### Security
- Changed TLS behavior to secure-by-default: `verifySSL` now defaults to `true` and helper fallback validation also defaults to certificate verification enabled.
- Added instance-scoped frontend/backend socket payload routing (`instanceId`) to reduce cross-instance data bleed.
- Added response-size guard (1 MB cap) for UniFi HTTP response buffering.

### Changed
- Updated README security guidance to align with secure default TLS verification and self-signed fallback recommendations.

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
