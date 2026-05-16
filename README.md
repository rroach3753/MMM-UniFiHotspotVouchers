# MMM-UniFiHotspotVouchers

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror)  module for displaying UniFi hotspot vouchers from a UniFi OS console running the Network application.

## Features

- Logs into UniFi OS with a local admin account
- Pulls hotspot vouchers from the Network application
- Tries the current UniFi OS proxy endpoints first, then falls back to legacy Network app paths
- Shows voucher code, note, usage, and status
- Supports optional compact mode, masking voucher codes, and inactive voucher display
- Refreshes update in place after the first render without flashing the module
- Refreshes on a configurable interval

## Screenshot

![MMM-UniFiHotspotVouchers screenshot](images/screenshot_1.png)

## Prerequisites

1. A working MagicMirror² installation.
2. A UniFi OS console such as a Cloud Key, UDM, or similar device.
3. A local UniFi OS username and password with permission to read Network data.

## Installation

MMPM is optional. You can use the standard Git method below without MMPM.

If you want to use MMPM commands, install MMPM first by following the official instructions:
https://github.com/Bee-Mar/mmpm

### Option 1: Standard Install (Git)

From your MagicMirror `modules` folder:

```bash
git clone https://github.com/rroach3753/MMM-UniFiHotspotVouchers.git
cd MMM-UniFiHotspotVouchers
npm install
```

If you copied this folder manually, place it at:

```text
MagicMirror/modules/MMM-UniFiHotspotVouchers
```

### Option 2: Install with MMPM (MagicMirror Package Manager)

If you use MMPM, install with:

```bash
mmpm install MMM-UniFiHotspotVouchers
```

## Updating

### Option 1: Standard Update (Git)

From your module folder:

```bash
cd MagicMirror/modules/MMM-UniFiHotspotVouchers
git pull
npm install
```

### Option 2: Update with MMPM

```bash
mmpm update MMM-UniFiHotspotVouchers
```

## Example Config

Add this to your `config/config.js` file:

```js
{
  module: "MMM-UniFiHotspotVouchers",
  position: "top_right",
  config: {
    title: "Hotspot Vouchers",
    controllerUrl: "https://unifi.local",
    username: "admin",
    password: "YOUR_PASSWORD",
    apiKey: "",
    apiKeyHeader: "X-API-Key",
    authMode: "auto",
    site: "default",
    verifySSL: true,
    refreshInterval: 300000,
    requestTimeout: 10000,
    showInactive: false,
    showSummary: true,
    showNotes: true,
    showCreatedAt: false,
    showVoucherCode: true,
    maskVoucherCode: false,
    sortBy: "created",
    maxRows: 12,
    compact: false,
    showBorders: true,
    showBackground: true,
    debug: false,
  },
},
```

## Configuration Options

You need either local username/password credentials or an API key path:

- `username` and `password` are required when using local login.
- `apiKey` is required when using API-key mode.

All other settings are optional and fall back to the defaults shown below.

| Option | Type | Required? | Default | What it does |
| --- | --- | --- | --- | --- |
| `title` | String | No | `UniFi Hotspot Vouchers` | Title shown above the voucher table. |
| `controllerUrl` | String | No | `https://unifi.local` | Base URL for the UniFi OS console. Use your Cloud Key IP or hostname. |
| `username` | String | No | `""` | UniFi OS username used for login. Required when `authMode` is `login` or when `authMode` is `auto` and API-key access is not available. |
| `password` | String | No | `""` | UniFi OS password used for login. Required when `authMode` is `login` or when `authMode` is `auto` and API-key access is not available. |
| `apiKey` | String | No | `""` | Optional API key used when the console exposes voucher endpoints through a UniFi API path. Required when `authMode` is `apikey`. |
| `apiKeyHeader` | String | No | `X-API-Key` | Header name used when sending the API key. |
| `authMode` | String | No | `auto` | Authentication mode: `auto`, `apikey`, or `login`. Auto tries API key first when present, then falls back to login if credentials are configured. |
| `site` | String | No | `default` | Network application site name. Most single-site deployments use `default`. |
| `verifySSL` | Boolean | No | `true` | Enforces TLS certificate validation by default. Set `false` only for trusted local self-signed environments. |
| `refreshInterval` | Number | No | `300000` | How often the module refreshes voucher data, in milliseconds. |
| `showInactive` | Boolean | No | `false` | Shows inactive, disabled, and used vouchers instead of only active ones. |
| `showSummary` | Boolean | No | `true` | Shows the summary chips for active and total vouchers. |
| `showNotes` | Boolean | No | `true` | Shows the voucher note/label column. |
| `showCreatedAt` | Boolean | No | `false` | Shows the voucher creation timestamp column. |
| `showVoucherCode` | Boolean | No | `true` | Shows the voucher code column. |
| `maskVoucherCode` | Boolean | No | `false` | Masks voucher codes in the table instead of showing the full code. |
| `sortBy` | String | No | `created` | Sort order for vouchers. Use `created` or `code`. |
| `maxRows` | Number | No | `12` | Maximum number of voucher rows shown. |
| `compact` | Boolean | No | `false` | Uses tighter spacing and smaller table padding. |
| `showBorders` | Boolean | No | `true` | Shows or hides the border and shadow around the voucher card. |
| `showBackground` | Boolean | No | `true` | Shows or hides the translucent card background behind the voucher table. |
| `requestTimeout` | Number | No | `10000` | HTTP request timeout in milliseconds. Prevents hangs if controller is unreachable. |
| `debug` | Boolean | No | `false` | Enable debug logging to browser console and server logs for troubleshooting. |
| `emptyMessage` | String | No | `No hotspot vouchers found.` | Message shown when no vouchers match the current filter. |
| `loadingMessage` | String | No | `Loading UniFi vouchers...` | Message shown while the first fetch is in progress. |

## Security Considerations

This module communicates with your UniFi OS console, which requires proper security practices:

### SSL/TLS Certificate Verification

- **Default Behavior:** `verifySSL: true` (TLS certificate verification enabled by default)
- **Recommended:** Keep `verifySSL: true` whenever possible to prevent man-in-the-middle attacks.
- **Self-Signed Certificates:** In trusted local-only environments, you can set `verifySSL: false` if cert trust cannot be configured.
- **Production / Untrusted Networks:** Use trusted certificates and keep `verifySSL: true`.

### Credentials Management

The module stores UniFi credentials in your `config/config.js` file. **Keep this file secure:**

1. **File Permissions:** Restrict read access to your config file:
   ```bash
   chmod 600 config/config.js
   ```

2. **Backup Security:** Ensure backups of your `config.js` are stored securely and not shared

3. **Environment Variables (Recommended):** Consider using environment variables instead of plaintext:
   ```bash
   export UNIFI_USERNAME="your_username"
   export UNIFI_PASSWORD="your_password"
   ```
   Then reference them in your config (requires custom module modification)

4. **API Key Alternative:** If available, use API keys instead of username/password:
   - API keys provide more granular permission control
   - Easier to rotate without changing user accounts
   - Set `authMode: "apikey"` in your config

### Network Security

- The module connects to your UniFi OS console over HTTPS (default)
- HTTP connections are possible but not recommended (use HTTPS)
- Keep your UniFi controller and MagicMirror on a secure, private network
- Do not expose your UniFi controller to the public internet without proper VPN/firewall protection

### Sensitive Data Display

- Set `maskVoucherCode: true` if you want to hide full voucher codes on the physical mirror display
- The module only displays what you configure—no credentials are displayed on screen
- Browser console and server logs may contain debugging information if `debug: true`; disable in production

## Notes

- The module first tries UniFi OS proxy endpoints such as `/proxy/network/api/s/default/rest/hotspot/voucher`.
- If that fails, it falls back to the older Network app endpoints such as `/api/s/default/stat/voucher`.
- If you provide `apiKey`, the module will try API-key auth first when `authMode` is `auto` or `apikey`.
- If your Cloud Key uses a self-signed certificate and trust cannot be configured in Node.js, set `verifySSL: false` as a local-network fallback.
- If you want to display expired vouchers for audit purposes, set `showInactive: true`.
- If you want to avoid exposing full voucher codes on the mirror, set `maskVoucherCode: true`.
- If you want a cleaner mirror look, set `showBorders: false`, `showBackground: false`, or both.
- Legacy keys such as `showExpiryColumn` and `warningHours` are ignored and can be removed from existing configs.

## Behavior Tips

- `sortBy: "created"` is usually the most useful view for voucher inventory monitoring.
- `showSummary: true` is good when you want a quick count of active and total vouchers.
- `compact: true` is a better fit for narrow mirror layouts.

## Troubleshooting

- **Authentication errors:** Confirm the username and password can log into the UniFi OS console directly.
- **API key issues:** Confirm the key belongs to an account that can read the Network application and that `authMode` is set correctly.
- **Intermittent 403 Forbidden errors:** The module should now re-authenticate once automatically; if it persists, verify the UniFi user or API key still has permission to read voucher data.
- **No vouchers displayed:** Confirm the Network application site name and that hotspot vouchers exist for that site.
- **Certificate/SSL errors:** Prefer fixing the certificate chain and keeping `verifySSL: true`; use `verifySSL: false` only for trusted local self-signed setups.
- **Module shows "Loading" indefinitely or hangs:** 
  - The module will timeout after `requestTimeout` milliseconds (default 10000ms). If the controller is slow, increase this value.
  - Check that the `controllerUrl` is correct and the controller is reachable on the network.
  - Enable `debug: true` in config to see detailed logging in the browser console (F12) and server logs to identify where it's getting stuck.
- **Need to troubleshoot authentication or API calls:**
  - Enable `debug: true` in your config to log detailed information about endpoint attempts, authentication success/failure, and number of vouchers retrieved.
  - Open the browser console (F12) to see real-time debug messages.
  - Check the MagicMirror server logs for additional backend debugging output.
  - Verify the UniFi controller is responding with `curl -k https://your-controller-url/api/s/default/stat/voucher` (replace with your actual URL and site).

