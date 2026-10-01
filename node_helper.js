const NodeHelper = require("node_helper");
const https = require("node:https");
const { URL } = require("node:url");

const MAX_TIMER_DELAY = 2147483647;
const MIN_REFRESH_INTERVAL = 30000;
const DEFAULT_REFRESH_INTERVAL = 300000;
const MIN_REQUEST_TIMEOUT = 1000;
const DEFAULT_REQUEST_TIMEOUT = 10000;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }

  return Boolean(value);
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeString(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function normalizeServerOrigin(value, variableName) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error(`${variableName} must be a valid HTTPS origin.`), { code: "CONFIGURATION_ERROR" });
  }

  if (parsed.protocol !== "https:" ||
      parsed.username || parsed.password ||
      (parsed.pathname && parsed.pathname !== "/") ||
      parsed.search || parsed.hash) {
    throw Object.assign(
      new Error(`${variableName} must be an HTTPS origin without a path, query, or credentials.`),
      { code: "CONFIGURATION_ERROR" }
    );
  }

  return parsed.origin;
}

function configurationError(message) {
  return Object.assign(new Error(message), { code: "CONFIGURATION_ERROR" });
}

function authenticationError(message, statusCode) {
  return Object.assign(new Error(message), { code: "AUTHENTICATION_ERROR", statusCode });
}

function controllerError(message, details) {
  return Object.assign(new Error(message), { code: "CONTROLLER_ERROR", ...(details || {}) });
}

function parseFlexibleDate(value) {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const millis = value < 1e12 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    const millis = text.length <= 10 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = NodeHelper.create({
  start() {
    this.instances = new Map();
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "UNIFI_HOTSPOT_CONFIG") {
      return;
    }

    const instanceId = normalizeString(payload && payload.instanceId, "");
    if (!INSTANCE_ID_PATTERN.test(instanceId)) {
      return;
    }

    const existingState = this.instances.get(instanceId);
    if (existingState && existingState.isInitializing) {
      this.log(existingState, "Already initializing, skipping duplicate config notification");
      return;
    }

    let config;
    try {
      config = this.buildServerConfig(payload || {});
    } catch (error) {
      this.logInternalError({ config: { debug: false }, instanceId }, error);
      this.sendPublicError(instanceId, "CONFIGURATION_ERROR");
      return;
    }

    if (existingState) {
      this.stopTimer(existingState);
    }

    const state = {
      instanceId,
      config,
      refreshTimer: null,
      sessionCookies: [],
      isInitializing: false
    };
    this.instances.set(instanceId, state);
    this.initialize(state);
  },

  buildServerConfig(rendererConfig) {
    const instanceId = normalizeString(rendererConfig.instanceId, "");
    if (!INSTANCE_ID_PATTERN.test(instanceId)) {
      throw configurationError("Invalid module instanceId.");
    }

    const serverUrl = normalizeString(process.env.UNIFI_HOTSPOT_URL || process.env.UNIFI_URL, "");
    const serverUsername = normalizeString(process.env.UNIFI_HOTSPOT_USERNAME || process.env.UNIFI_USERNAME, "");
    const serverPassword = normalizeString(process.env.UNIFI_HOTSPOT_PASSWORD || process.env.UNIFI_PASSWORD, "");
    const serverApiKey = normalizeString(process.env.UNIFI_HOTSPOT_API_KEY || process.env.UNIFI_API_KEY, "");
    if (!serverUrl) {
      throw configurationError("UNIFI_HOTSPOT_URL or UNIFI_URL is required.");
    }

    if (Boolean(serverUsername) !== Boolean(serverPassword)) {
      throw configurationError("Both server-side username and password are required for login authentication.");
    }

    if (!serverApiKey && !serverUsername) {
      throw configurationError("Server-side UniFi credentials are required.");
    }

    const apiKeyHeader = normalizeString(process.env.UNIFI_HOTSPOT_API_KEY_HEADER, "X-API-Key");
    if (!HEADER_NAME_PATTERN.test(apiKeyHeader)) {
      throw configurationError("UNIFI_HOTSPOT_API_KEY_HEADER must be a valid HTTP header name.");
    }

    return {
      instanceId,
      controllerUrl: normalizeServerOrigin(serverUrl, "UNIFI_HOTSPOT_URL"),
      site: normalizeString(rendererConfig.site, "default"),
      username: serverUsername,
      password: serverPassword,
      apiKey: serverApiKey,
      apiKeyHeader,
      authMode: serverApiKey && serverUsername ? "auto" : (serverApiKey ? "apikey" : "login"),
      verifySSL: normalizeBoolean(process.env.UNIFI_HOTSPOT_VERIFY_SSL, true),
      refreshInterval: normalizeBoundedInteger(
        rendererConfig.refreshInterval,
        DEFAULT_REFRESH_INTERVAL,
        MIN_REFRESH_INTERVAL,
        MAX_TIMER_DELAY
      ),
      requestTimeout: normalizeBoundedInteger(
        rendererConfig.requestTimeout,
        DEFAULT_REQUEST_TIMEOUT,
        MIN_REQUEST_TIMEOUT,
        MAX_TIMER_DELAY
      ),
      debug: normalizeBoolean(rendererConfig.debug, false)
    };
  },

  async initialize(state) {
    state.isInitializing = true;

    try {
      await this.refreshData(state);
      if (this.isCurrentState(state)) {
        this.scheduleNextRefresh(state);
      }
    } catch (error) {
      this.sendError(state, error);
    } finally {
      state.isInitializing = false;
    }
  },

  stopTimer(state) {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  },

  scheduleNextRefresh(state) {
    const interval = normalizeBoundedInteger(
      state.config.refreshInterval,
      DEFAULT_REFRESH_INTERVAL,
      MIN_REFRESH_INTERVAL,
      MAX_TIMER_DELAY
    );
    state.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshData(state);
      } catch (error) {
        this.sendError(state, error);
      }
      if (this.isCurrentState(state)) {
        this.scheduleNextRefresh(state);
      }
    }, interval);
  },

  isCurrentState(state) {
    return this.instances.get(state.instanceId) === state;
  },

  log(state, message) {
    if (normalizeBoolean(state.config.debug, false)) {
      console.log(`[MMM-UniFiHotspotVouchers:${state.instanceId}] ${message}`);
    }
  },

  logInternalError(state, error) {
    const status = error && Number.isInteger(error.statusCode) ? ` HTTP ${error.statusCode}` : "";
    const code = error && error.code ? error.code : "CONTROLLER_ERROR";
    this.log(state, `${code}${status}`);
  },

  sendPublicError(instanceId, code) {
    this.sendSocketNotification("UNIFI_HOTSPOT_ERROR", {
      code: ["CONFIGURATION_ERROR", "AUTHENTICATION_ERROR"].includes(code) ? code : "CONTROLLER_ERROR",
      instanceId
    });
  },

  sendError(state, error) {
    if (!this.isCurrentState(state)) {
      return;
    }

    this.logInternalError(state, error);
    this.sendPublicError(state.instanceId, error && error.code);
  },

  sendData(state, vouchers) {
    this.sendSocketNotification("UNIFI_HOTSPOT_DATA", {
      vouchers,
      fetchedAt: Date.now(),
      instanceId: state.instanceId
    });
  },

  async refreshData(state) {
    const vouchers = await this.fetchVouchers(state);
    if (this.isCurrentState(state)) {
      this.sendData(state, vouchers);
    }
  },

  async fetchVouchers(state) {
    const controllerUrl = state.config.controllerUrl;
    const site = normalizeString(state.config.site, "default");

    const endpoints = [
      `/proxy/network/api/s/${encodeURIComponent(site)}/rest/hotspot/voucher`,
      `/proxy/network/api/s/${encodeURIComponent(site)}/stat/voucher`,
      `/api/s/${encodeURIComponent(site)}/rest/hotspot/voucher`,
      `/api/s/${encodeURIComponent(site)}/stat/voucher`
    ];

    const apiKey = normalizeString(state.config.apiKey, "");
    const authMode = state.config.authMode;
    const username = normalizeString(state.config.username, "");
    const password = normalizeString(state.config.password, "");

    if (authMode === "apikey" && !apiKey) {
      throw configurationError("Missing server-side API key.");
    }

    if (authMode === "login" && (!username || !password)) {
      throw configurationError("Missing server-side username or password.");
    }

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      try {
        return await this.fetchVoucherEndpoints(state, controllerUrl, endpoints, {
          apiKey,
          apiKeyHeader: state.config.apiKeyHeader
        }, false);
      } catch (error) {
        if (authMode === "apikey") {
          throw error;
        }
      }
    }

    if (!username || !password) {
      throw authenticationError("No usable server-side authentication method.");
    }

    await this.login(state, controllerUrl, username, password);

    return this.fetchVoucherEndpoints(state, controllerUrl, endpoints, {
      cookies: true
    }, false);
  },

  async fetchVoucherEndpoints(state, controllerUrl, endpoints, authOptions, hasRetriedAuthFailure) {
    const shouldRetryAfterAuthFailure = this.shouldRetryAfterAuthFailure(state, authOptions) && !hasRetriedAuthFailure;
    let lastError = null;
    let hadSuccessfulResponse = false;

    for (const endpoint of endpoints) {
      try {
        this.log(state, `Attempting endpoint: ${endpoint}`);
        const response = await this.requestJson(state, "GET", controllerUrl, endpoint, null, null, authOptions);
        hadSuccessfulResponse = true;
        const records = this.extractVoucherRecords(response);
        if (records.length) {
          this.log(state, `Successfully retrieved ${records.length} voucher records from ${endpoint}`);
          return records.map((record) => this.normalizeVoucher(record)).filter(Boolean);
        }
      } catch (error) {
        this.logInternalError(state, error);
        if (shouldRetryAfterAuthFailure && this.isAuthFailure(error)) {
          this.log(state, "Auth failure detected, attempting re-authentication");
          return this.retryVoucherFetchAfterReauth(state, controllerUrl, endpoints, authOptions);
        }

        lastError = error;
      }
    }

    if (hadSuccessfulResponse) {
      return [];
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  },

  shouldRetryAfterAuthFailure(state, authOptions) {
    return Boolean(authOptions && authOptions.cookies && state.config.username && state.config.password);
  },

  isAuthFailure(error) {
    const statusCode = error && error.statusCode;
    return statusCode === 401 || statusCode === 403;
  },

  async retryVoucherFetchAfterReauth(state, controllerUrl, endpoints, authOptions) {
    state.sessionCookies = [];
    await this.login(
      state,
      controllerUrl,
      normalizeString(state.config.username, ""),
      normalizeString(state.config.password, "")
    );
    return this.fetchVoucherEndpoints(state, controllerUrl, endpoints, {
      cookies: true,
      apiKey: authOptions && authOptions.apiKey,
      apiKeyHeader: authOptions && authOptions.apiKeyHeader
    }, true);
  },

  async login(state, controllerUrl, username, password) {
    const response = await this.requestJson(state, "POST", controllerUrl, "/api/auth/login", {
      username,
      password
    }, {
      "Content-Type": "application/json"
    }, { cookies: true });

    const cookies = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [];
    state.sessionCookies = cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean);

    if (!state.sessionCookies.length) {
      throw authenticationError("UniFi login did not return a session cookie.");
    }

    this.log(state, "Successfully authenticated with UniFi controller");
  },

  async requestJson(state, method, controllerUrl, path, body, extraHeaders, authOptions) {
    const url = new URL(path, controllerUrl);
    const requestBody = body ? JSON.stringify(body) : "";
    const headers = Object.assign({}, extraHeaders || {});

    const options = authOptions || {};
    const hasSecrets = Boolean(requestBody || options.cookies || options.apiKey);
    if (hasSecrets && url.protocol !== "https:") {
      throw configurationError("Authenticated UniFi requests require HTTPS.");
    }

    if (options.cookies && state.sessionCookies.length) {
      headers.Cookie = state.sessionCookies.join("; ");
    }

    if (options.apiKey) {
      headers[options.apiKeyHeader || "X-API-Key"] = options.apiKey;
    }

    if (requestBody && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    if (requestBody) {
      headers["Content-Length"] = Buffer.byteLength(requestBody);
    }

    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method,
        headers,
        rejectUnauthorized: normalizeBoolean(state.config.verifySSL, true)
      }, (response) => {
        const chunks = [];
        let bodyLength = 0;
        let limitExceeded = false;
        response.on("data", (chunk) => {
          bodyLength += chunk.length;

          if (bodyLength > 1048576) {
            limitExceeded = true;
            request.destroy(new Error("Response body exceeded 1 MB limit"));
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          if (limitExceeded) {
            return;
          }

          const raw = Buffer.concat(chunks).toString();

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const statusCode = response.statusCode;
            reject(
              statusCode === 401 || statusCode === 403
                ? authenticationError("UniFi authentication was rejected.", statusCode)
                : controllerError("UniFi controller returned an unsuccessful response.", { statusCode })
            );
            return;
          }

          if (!raw) {
            resolve({ headers: response.headers, json: {} });
            return;
          }

          try {
            resolve({ headers: response.headers, json: JSON.parse(raw) });
          } catch {
            reject(controllerError("UniFi controller returned invalid JSON."));
          }
        });
      });

      const timeoutMs = normalizeBoundedInteger(
        state.config.requestTimeout,
        DEFAULT_REQUEST_TIMEOUT,
        MIN_REQUEST_TIMEOUT,
        MAX_TIMER_DELAY
      );
      request.setTimeout(timeoutMs);
      request.on("timeout", () => {
        request.destroy();
        reject(controllerError("UniFi controller request timed out."));
      });

      request.on("error", () => reject(controllerError("UniFi controller request failed.")));

      if (requestBody) {
        request.write(requestBody);
      }

      request.end();
    }).then((result) => ({
      headers: result.headers,
      ...result.json
    }));
  },

  extractVoucherRecords(response) {
    const candidates = [
      response,
      response && response.data,
      response && response.data && response.data.data,
      response && response.result,
      response && response.vouchers,
      response && response.voucher,
      response && response.records
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }

      if (candidate && Array.isArray(candidate.data)) {
        return candidate.data;
      }
    }

    return [];
  },

  normalizeVoucher(record) {
    const code = record.code || record.voucher || record.voucher_code || record.voucherCode || record.name || record._id;
    if (!code) {
      return null;
    }

    const createdAt = parseFlexibleDate(record.create_time || record.created_at || record.createdAt || record.createTime);
    const duration = normalizeNumber(record.duration || record.minutes || record.validity, null);
    const quota = normalizeNumber(record.quota || record.uses || record.usage || record.limit, null);
    const used = normalizeNumber(record.used || record.used_count || record.usedCount, 0);
    const active = normalizeBoolean(record.enabled, true) && normalizeBoolean(record.status !== "disabled", true);

    let status = active ? "active" : "disabled";
    if (quota != null && used >= quota && quota > 0) {
      status = "used";
    }

    return {
      code: String(code).trim(),
      note: String(record.note || record.memo || record.description || "").trim(),
      createdAt: createdAt ? createdAt.getTime() : null,
      durationMinutes: duration,
      quota,
      used,
      remainingUses: quota != null ? Math.max(0, quota - used) : null,
      status,
      statusLabel: this.statusLabel(status),
      createdText: createdAt ? this.formatDate(createdAt) : "-",
      usesText: this.formatUses(quota, used)
    };
  },

  statusLabel(status) {
    switch (status) {
      case "active":
        return "Active";
      case "used":
        return "Used";
      case "disabled":
        return "Disabled";
      default:
        return "Unknown";
    }
  },

  formatUses(quota, used) {
    if (quota == null) {
      return "Unlimited";
    }

    return `${used}/${quota}`;
  },

  formatDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }
});
