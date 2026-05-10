/* global Module */

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

Module.register("MMM-UniFiHotspotVouchers", {
  defaults: {
    title: "UniFi Hotspot Vouchers",
    controllerUrl: "https://unifi.local",
    username: "",
    password: "",
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
    emptyMessage: "No hotspot vouchers found.",
    loadingMessage: "Loading UniFi vouchers..."
  },

  start() {
    this.instanceId = this.identifier || this.name;
    this.dataState = {
      vouchers: [],
      fetchedAt: null,
      error: null,
      loading: true
    };

    this.sendSocketNotification("UNIFI_HOTSPOT_CONFIG", {
      ...this.config,
      instanceId: this.instanceId
    });
  },

  getStyles() {
    return ["MMM-UniFiHotspotVouchers.css"];
  },

  socketNotificationReceived(notification, payload) {
    const data = payload || {};

    if (data.instanceId && data.instanceId !== this.instanceId) {
      return;
    }

    if (notification === "UNIFI_HOTSPOT_DATA") {
      if (normalizeBoolean(this.config.debug, false)) {
        console.log("[MMM-UniFiHotspotVouchers] Received data notification with", (data.vouchers || []).length, "vouchers");
      }
      this.dataState = {
        vouchers: data.vouchers || [],
        fetchedAt: data.fetchedAt || Date.now(),
        error: null,
        loading: false
      };
      this.updateDom(this.config.animationSpeed || 1000);
      return;
    }

    if (notification === "UNIFI_HOTSPOT_ERROR") {
      if (normalizeBoolean(this.config.debug, false)) {
        console.log("[MMM-UniFiHotspotVouchers] Received error notification:", data);
      }
      this.dataState = {
        vouchers: [],
        fetchedAt: Date.now(),
        error: data.error || "Unable to load UniFi hotspot vouchers.",
        loading: false
      };
      this.updateDom(this.config.animationSpeed || 1000);
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    const showBorders = normalizeBoolean(this.config.showBorders, true);
    const showBackground = normalizeBoolean(this.config.showBackground, true);

    wrapper.className = [
      "unifi-hotspot",
      normalizeBoolean(this.config.compact, false) ? "unifi-hotspot--compact" : "",
      showBorders ? "" : "unifi-hotspot--noBorders",
      showBackground ? "" : "unifi-hotspot--noBackground"
    ].filter(Boolean).join(" ");

    if (this.dataState.loading) {
      wrapper.classList.add("dimmed", "small");
      wrapper.textContent = normalizeString(this.config.loadingMessage, "Loading UniFi vouchers...");
      return wrapper;
    }

    if (this.dataState.error) {
      wrapper.classList.add("bright", "small", "unifi-hotspot__error");
      wrapper.textContent = this.dataState.error;
      return wrapper;
    }

    const vouchers = this.getVisibleVouchers();

    if (!vouchers.length) {
      wrapper.classList.add("dimmed", "small");
      wrapper.textContent = normalizeString(this.config.emptyMessage, "No hotspot vouchers found.");
      return wrapper;
    }

    if (normalizeBoolean(this.config.showSummary, true)) {
      wrapper.appendChild(this.buildSummary(vouchers));
    }

    const table = document.createElement("table");
    table.className = "small unifi-hotspot__table";

    const header = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const columns = [];
    if (normalizeBoolean(this.config.showVoucherCode, true)) {
      columns.push("Voucher");
    }
    if (normalizeBoolean(this.config.showNotes, true)) {
      columns.push("Note");
    }
    columns.push("Uses");
    if (normalizeBoolean(this.config.showCreatedAt, false)) {
      columns.push("Created");
    }
    columns.push("Status");

    columns.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    });

    header.appendChild(headerRow);
    table.appendChild(header);

    const body = document.createElement("tbody");
    vouchers.slice(0, normalizeNumber(this.config.maxRows, 12)).forEach((voucher) => {
      body.appendChild(this.buildVoucherRow(voucher));
    });
    table.appendChild(body);
    wrapper.appendChild(table);

    if (this.dataState.fetchedAt) {
      const updated = document.createElement("div");
      updated.className = "unifi-hotspot__updated xsmall dimmed";
      updated.textContent = `Updated ${this.relativeTime(this.dataState.fetchedAt)}`;
      wrapper.appendChild(updated);
    }

    return wrapper;
  },

  buildSummary(vouchers) {
    const summary = document.createElement("div");
    summary.className = "unifi-hotspot__summary";

    const activeCount = vouchers.filter((voucher) => voucher.status === "active").length;

    [
      { label: "Active", value: activeCount },
      { label: "Total", value: vouchers.length }
    ].forEach((item) => {
      const chip = document.createElement("div");
      chip.className = "unifi-hotspot__chip";
      const label = document.createElement("span");
      label.className = "unifi-hotspot__chipLabel";
      label.textContent = item.label;
      const value = document.createElement("span");
      value.className = "unifi-hotspot__chipValue";
      value.textContent = String(item.value);
      chip.appendChild(label);
      chip.appendChild(value);
      summary.appendChild(chip);
    });

    return summary;
  },

  buildVoucherRow(voucher) {
    const row = document.createElement("tr");
    row.className = `unifi-hotspot__row unifi-hotspot__row--${voucher.status}`;

    if (normalizeBoolean(this.config.showVoucherCode, true)) {
      const codeCell = document.createElement("td");
      codeCell.className = "unifi-hotspot__code";
      codeCell.textContent = this.formatVoucherCode(voucher.code);
      row.appendChild(codeCell);
    }

    if (normalizeBoolean(this.config.showNotes, true)) {
      const noteCell = document.createElement("td");
      noteCell.className = "unifi-hotspot__note dimmed";
      noteCell.textContent = voucher.note || "-";
      row.appendChild(noteCell);
    }

    const usesCell = document.createElement("td");
    usesCell.className = "unifi-hotspot__uses";
    usesCell.textContent = voucher.usesText;
    row.appendChild(usesCell);

    if (normalizeBoolean(this.config.showCreatedAt, false)) {
      const createdCell = document.createElement("td");
      createdCell.className = "unifi-hotspot__created dimmed";
      createdCell.textContent = voucher.createdText;
      row.appendChild(createdCell);
    }

    const statusCell = document.createElement("td");
    statusCell.className = `unifi-hotspot__status unifi-hotspot__status--${voucher.status}`;
    statusCell.textContent = voucher.statusLabel;
    row.appendChild(statusCell);

    return row;
  },

  formatVoucherCode(code) {
    const raw = String(code || "").trim();
    if (!raw) {
      return "-";
    }

    if (!normalizeBoolean(this.config.maskVoucherCode, false)) {
      return raw;
    }

    const suffix = raw.slice(-4);
    return raw.length > 4 ? `${"•".repeat(Math.max(0, raw.length - 4))}${suffix}` : suffix;
  },

  getVisibleVouchers() {
    const vouchers = (this.dataState.vouchers || []).slice(0);
    const showInactive = normalizeBoolean(this.config.showInactive, false);
    const sortBy = String(this.config.sortBy || "created").toLowerCase();

    const filtered = showInactive ? vouchers : vouchers.filter((voucher) => voucher.status === "active");

    return filtered.sort((left, right) => {
      if (sortBy === "created") {
        const leftTime = left.createdAt ?? Infinity;
        const rightTime = right.createdAt ?? Infinity;
        return leftTime - rightTime;
      }

      if (sortBy === "code") {
        return String(left.code || "").localeCompare(String(right.code || ""));
      }

      const leftTime = left.createdAt ?? Infinity;
      const rightTime = right.createdAt ?? Infinity;
      return leftTime - rightTime;
    });
  },

  relativeTime(timestamp) {
    const delta = timestamp - Date.now();
    const future = delta > 0;
    const seconds = Math.abs(Math.round(delta / 1000));
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 60) {
      return future ? `in ${seconds}s` : `${seconds}s ago`;
    }

    if (minutes < 60) {
      return future ? `in ${minutes}m` : `${minutes}m ago`;
    }

    if (hours < 24) {
      return future ? `in ${hours}h` : `${hours}h ago`;
    }

    return future ? `in ${days}d` : `${days}d ago`;
  }
});
