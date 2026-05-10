const NodeHelper = require("node_helper");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

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

function normalizeString(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
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
    this.config = null;
    this.refreshTimer = null;
    this.sessionCookies = [];
    this.isInitializing = false;
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "UNIFI_HOTSPOT_CONFIG") {
      return;
    }

    if (this.isInitializing) {
      this.log("Already initializing, skipping duplicate config notification");
      return;
    }

    this.config = payload || {};
    this.initialize();
  },

  async initialize() {
    this.stopTimer();
    this.isInitializing = true;

    try {
      await this.refreshData();
      this.scheduleNextRefresh();
    } catch (error) {
      this.sendError(error.message);
    } finally {
      this.isInitializing = false;
    }
  },

  stopTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  scheduleNextRefresh() {
    const interval = normalizeNumber(this.config.refreshInterval, 300000);
    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshData();
      } catch (error) {
        this.sendError(error.message);
      }
      this.scheduleNextRefresh();
    }, Math.max(30000, interval));
  },

  log(message) {
    if (normalizeBoolean(this.config.debug, false)) {
      console.log(`[MMM-UniFiHotspotVouchers] ${message}`);
    }
  },

  sendError(message) {
    this.log(`Error: ${message}`);
    this.sendSocketNotification("UNIFI_HOTSPOT_ERROR", {
      error: message,
      instanceId: this.config && this.config.instanceId ? this.config.instanceId : null
    });
  },

  sendData(vouchers) {
    this.sendSocketNotification("UNIFI_HOTSPOT_DATA", {
      vouchers,
      fetchedAt: Date.now(),
      instanceId: this.config && this.config.instanceId ? this.config.instanceId : null
    });
  },

  async refreshData() {
    const vouchers = await this.fetchVouchers();
    this.sendData(vouchers);
  },

  async fetchVouchers() {
    const controllerUrl = normalizeString(this.config.controllerUrl, "https://unifi.local");
    const site = normalizeString(this.config.site, "default");

    const endpoints = [
      `/proxy/network/api/s/${encodeURIComponent(site)}/rest/hotspot/voucher`,
      `/proxy/network/api/s/${encodeURIComponent(site)}/stat/voucher`,
      `/api/s/${encodeURIComponent(site)}/rest/hotspot/voucher`,
      `/api/s/${encodeURIComponent(site)}/stat/voucher`
    ];

    const apiKey = normalizeString(this.config.apiKey, "");
    const authMode = normalizeString(this.config.authMode, "auto").toLowerCase();
    const username = normalizeString(this.config.username, "");
    const password = normalizeString(this.config.password, "");

    if (authMode === "apikey" && !apiKey) {
      throw new Error("Missing apiKey in MMM-UniFiHotspotVouchers config when authMode is set to apikey.");
    }

    if (authMode === "login" && (!username || !password)) {
      throw new Error("Missing username or password in MMM-UniFiHotspotVouchers config when authMode is set to login.");
    }

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      try {
        const vouchers = await this.fetchVoucherEndpoints(controllerUrl, endpoints, {
          apiKey,
          apiKeyHeader: normalizeString(this.config.apiKeyHeader, "X-API-Key")
        }, false);

        if (vouchers.length) {
          return vouchers;
        }
      } catch (error) {
        if (authMode === "apikey") {
          throw error;
        }
      }

      if (authMode === "apikey") {
        throw new Error("API key access did not return any vouchers.");
      }
    }

    if (!username || !password) {
      if (apiKey) {
        throw new Error("API key access did not return vouchers and username/password fallback is not configured.");
      }

      throw new Error("Missing username or password in MMM-UniFiHotspotVouchers config.");
    }

    await this.login(controllerUrl, username, password);

    return this.fetchVoucherEndpoints(controllerUrl, endpoints, {
      cookies: this.sessionCookies
    }, false);
  },

  async fetchVoucherEndpoints(controllerUrl, endpoints, authOptions, hasRetriedAuthFailure) {
    const shouldRetryAfterAuthFailure = this.shouldRetryAfterAuthFailure(authOptions) && !hasRetriedAuthFailure;
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        this.log(`Attempting endpoint: ${endpoint}`);
        const response = await this.requestJson("GET", controllerUrl, endpoint, null, null, authOptions);
        const records = this.extractVoucherRecords(response);
        if (records.length) {
          this.log(`Successfully retrieved ${records.length} voucher records from ${endpoint}`);
          return records.map((record) => this.normalizeVoucher(record)).filter(Boolean);
        }
      } catch (error) {
        this.log(`Endpoint ${endpoint} failed: ${error.message}`);
        if (shouldRetryAfterAuthFailure && this.isAuthFailure(error)) {
          this.log("Auth failure detected, attempting re-authentication");
          return this.retryVoucherFetchAfterReauth(controllerUrl, endpoints, authOptions);
        }

        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  },

  shouldRetryAfterAuthFailure(authOptions) {
    return Boolean(authOptions && authOptions.cookies && this.config.username && this.config.password);
  },

  isAuthFailure(error) {
    const statusCode = error && error.statusCode;
    return statusCode === 401 || statusCode === 403;
  },

  async retryVoucherFetchAfterReauth(controllerUrl, endpoints, authOptions) {
    this.sessionCookies = [];
    await this.login(controllerUrl, normalizeString(this.config.username, ""), normalizeString(this.config.password, ""));
    return this.fetchVoucherEndpoints(controllerUrl, endpoints, {
      cookies: this.sessionCookies,
      apiKey: authOptions && authOptions.apiKey,
      apiKeyHeader: authOptions && authOptions.apiKeyHeader
    }, true);
  },

  async login(controllerUrl, username, password) {
    const response = await this.requestJson("POST", controllerUrl, "/api/auth/login", {
      username,
      password
    }, {
      "Content-Type": "application/json"
    }, { cookies: true });

    const cookies = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [];
    this.sessionCookies = cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean);

    if (!this.sessionCookies.length) {
      throw new Error("UniFi login did not return a session cookie.");
    }

    this.log("Successfully authenticated with UniFi controller");
  },

  async requestJson(method, controllerUrl, path, body, extraHeaders, authOptions) {
    const url = new URL(path, controllerUrl);
    const transport = url.protocol === "http:" ? http : https;
    const requestBody = body ? JSON.stringify(body) : "";
    const headers = Object.assign({}, extraHeaders || {});

    const options = authOptions || {};

    if (options.cookies && this.sessionCookies.length) {
      headers.Cookie = this.sessionCookies.join("; ");
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
      const request = transport.request(url, {
        method,
        headers,
        rejectUnauthorized: normalizeBoolean(this.config.verifySSL, true)
      }, (response) => {
        const chunks = [];
        let bodyLength = 0;
        response.on("data", (chunk) => {
          chunks.push(chunk);
          bodyLength += chunk.length;

          if (bodyLength > 1048576) {
            request.destroy(new Error("Response body exceeded 1 MB limit"));
          }
        });

        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString();

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`HTTP ${response.statusCode}: ${raw.slice(0, 200)}`);
            error.statusCode = response.statusCode;
            error.responseBody = raw;
            reject(error);
            return;
          }

          if (!raw) {
            resolve({ headers: response.headers, json: {} });
            return;
          }

          try {
            resolve({ headers: response.headers, json: JSON.parse(raw) });
          } catch (error) {
            reject(new Error(`Failed to parse UniFi response: ${error.message}`));
          }
        });
      });

      const timeoutMs = normalizeNumber(this.config.requestTimeout, 10000);
      request.setTimeout(timeoutMs);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error(`HTTP request timeout after ${timeoutMs}ms`));
      });

      request.on("error", (error) => reject(error));

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
