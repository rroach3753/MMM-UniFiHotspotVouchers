const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");
const https = require("node:https");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "node_helper") {
    return {
      create(definition) {
        return definition;
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const helper = require("../node_helper");
Module._load = originalLoad;

const ENV_NAMES = [
  "UNIFI_HOTSPOT_URL",
  "UNIFI_URL",
  "UNIFI_HOTSPOT_USERNAME",
  "UNIFI_USERNAME",
  "UNIFI_HOTSPOT_PASSWORD",
  "UNIFI_PASSWORD",
  "UNIFI_HOTSPOT_API_KEY",
  "UNIFI_API_KEY",
  "UNIFI_HOTSPOT_API_KEY_HEADER",
  "UNIFI_HOTSPOT_VERIFY_SSL",
  "UNIFI_HOTSPOT_SITE",
  "UNIFI_HOTSPOT_INSTANCE_SITES",
  "UNIFI_HOTSPOT_VOUCHER_CODE_POLICY"
];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  ENV_NAMES.forEach((name) => delete process.env[name]);
  Object.entries(values).forEach(([name, value]) => {
    process.env[name] = value;
  });

  try {
    return callback();
  } finally {
    Object.entries(previous).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
}

function createState(overrides = {}) {
  return {
    instanceId: overrides.instanceId || "module_1",
    config: {
      controllerUrl: "https://unifi.example",
      username: "",
      password: "",
      apiKey: "server-key",
      apiKeyHeader: "X-API-Key",
      authMode: "apikey",
      verifySSL: true,
      refreshInterval: 300000,
      requestTimeout: 10000,
      debug: false,
      site: "default",
      voucherCodePolicy: "hidden",
      ...(overrides.config || {})
    },
    refreshTimer: null,
    sessionCookies: overrides.sessionCookies || [],
    isInitializing: false
  };
}

test("socket payloads cannot throw or create unbounded polling instances", () => {
  const originalInitialize = helper.initialize;
  const originalSend = helper.sendSocketNotification;
  const sent = [];
  let initializations = 0;
  helper.start();
  helper.initialize = () => { initializations++; };
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
  try {
    withEnvironment({
      UNIFI_HOTSPOT_URL: "https://unifi.example",
      UNIFI_HOTSPOT_API_KEY: "server-key"
    }, () => {
      for (const payload of [
        [],
        { instanceId: { toString: null } },
        { instanceId: "valid", requestTimeout: { valueOf: null, toString: null } }
      ]) {
        assert.doesNotThrow(() => helper.socketNotificationReceived("UNIFI_HOTSPOT_CONFIG", payload));
        assert.equal(sent.at(-1).notification, "UNIFI_HOTSPOT_ERROR");
      }
      assert.equal(initializations, 0);
      for (let index = 0; index < 18; index++) {
        helper.socketNotificationReceived("UNIFI_HOTSPOT_CONFIG", { instanceId: `instance-${index}` });
      }
      assert.equal(helper.instances.size, 16);
      assert.equal(initializations, 16);
      helper.socketNotificationReceived("UNIFI_HOTSPOT_CONFIG", { instanceId: "instance-0", refreshInterval: 30000 });
      assert.equal(initializations, 16);
      assert.equal(helper.instances.get("instance-0").config.refreshInterval, 300000);
      helper.sendData(helper.instances.get("instance-0"), [{ code: "secret", note: "Lobby" }]);
      helper.socketNotificationReceived("UNIFI_HOTSPOT_CONFIG", { instanceId: "instance-0" });
      assert.equal(sent.at(-1).notification, "UNIFI_HOTSPOT_DATA");
      assert.equal(Object.hasOwn(sent.at(-1).payload.vouchers[0], "code"), false);
    });
  } finally {
    helper.initialize = originalInitialize;
    helper.sendSocketNotification = originalSend;
    helper.start();
  }
});

function mockHttpsResponse({
  chunks = [Buffer.from('{"data":[]}')],
  headers = {},
  statusCode = 200
} = {}, optionsSeen = []) {
  const originalRequest = https.request;

  https.request = (url, options, responseCallback) => {
    const request = new EventEmitter();
    optionsSeen.push({ url: url.toString(), options });
    request.setTimeout = () => {};
    request.write = () => {};
    request.destroy = (error) => {
      if (error) {
        request.emit("error", error);
      }
    };
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.headers = headers;
      responseCallback(response);
      chunks.forEach((chunk) => response.emit("data", chunk));
      response.emit("end");
    };
    return request;
  };

  return () => {
    https.request = originalRequest;
  };
}

function loadRendererDefinition() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, "..", "MMM-UniFiHotspotVouchers.js"), "utf8");
  vm.runInNewContext(source, {
    Module: {
      register(name, moduleDefinition) {
        assert.equal(name, "MMM-UniFiHotspotVouchers");
        definition = moduleDefinition;
      }
    },
    console,
    Date,
    document: {
      createElement() {
        return {
          children: [], textContent: "", classList: { add() {} },
          appendChild(child) { this.children.push(child); }
        };
      }
    }
  });
  return definition;
}

function renderedText(element) {
  return `${element.textContent || ""}${(element.children || []).map(renderedText).join("")}`;
}

test.beforeEach(() => {
  helper.start();
});

test("cached voucher replay preserves the original successful fetch timestamp", () => {
  const originalNow = Date.now;
  const originalSend = helper.sendSocketNotification;
  const sent = [];
  const state = createState();
  state.ssid = "Guest Network";
  helper.instances.set(state.instanceId, state);
  helper.sendSocketNotification = (_notification, payload) => sent.push(payload);
  try {
    Date.now = () => 1000;
    helper.sendData(state, []);
    Date.now = () => 9000;
    helper.socketNotificationReceived("UNIFI_HOTSPOT_CONFIG", { instanceId: state.instanceId });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].fetchedAt, 1000);
    assert.equal(sent[1].fetchedAt, 1000);
    assert.equal(sent[1].ssid, "Guest Network");
  } finally {
    Date.now = originalNow;
    helper.sendSocketNotification = originalSend;
  }
});

test("renderer preserves voucher sorting, filtering, masking and empty states", () => {
  const definition = loadRendererDefinition();
  const vouchers = [
    { code: "B123456", status: "active", createdAt: 2000, note: "Lobby" },
    { code: "A123456", status: "disabled", createdAt: 1000, note: "Office" },
    { code: "C123456", status: "active", createdAt: null, note: "Guest" }
  ];
  const renderer = {
    ...definition, config: { ...definition.defaults },
    dataState: { vouchers, voucherCodePolicy: "full", loading: false }
  };
  const codes = () => Array.from(renderer.getVisibleVouchers(), (voucher) => voucher.code);
  assert.deepEqual(codes(), ["B123456", "C123456"]);
  renderer.config.showInactive = true;
  assert.deepEqual(codes(), ["A123456", "B123456", "C123456"]);
  renderer.config.sortBy = "code";
  assert.deepEqual(codes(), ["A123456", "B123456", "C123456"]);
  renderer.config.sortBy = "unknown";
  assert.deepEqual(codes(), ["A123456", "B123456", "C123456"]);
  assert.equal(vouchers[0].code, "B123456");
  renderer.config.maskVoucherCode = true;
  assert.equal(renderer.formatVoucherCode("B123456"), "\u2022\u2022\u20223456");
  renderer.dataState.voucherCodePolicy = "hidden";
  assert.equal(renderer.shouldShowVoucherCode(), false);
  renderer.dataState.vouchers = [];
  assert.match(renderedText(renderer.getDom()), /No hotspot vouchers found\./);
});

test("renderer uses the discovered guest network name unless a title override is configured", () => {
  const definition = loadRendererDefinition();
  const renderer = {
    ...definition,
    config: { ...definition.defaults },
    dataState: {
      vouchers: [],
      ssid: "Guest Network",
      voucherCodePolicy: "hidden",
      loading: false
    }
  };

  assert.equal(renderer.getDom().children[0].textContent, "Network: Guest Network");
  renderer.config.title = "Visitor Access";
  assert.equal(renderer.getDom().children[0].textContent, "Visitor Access");
  renderer.config.title = "";
  renderer.dataState.ssid = null;
  assert.equal(renderer.getDom().children[0].textContent, "UniFi Hotspot Vouchers");
});

test("helper selects a guest WLAN name without exposing controller credentials", async () => {
  const originalRequest = helper.requestJson;
  const state = createState({
    config: {
      site: "default",
      apiKey: "server-key",
      apiKeyHeader: "X-API-Key"
    }
  });
  let requestOptions;
  helper.requestJson = async (_state, method, _controllerUrl, endpoint, _body, _headers, authOptions) => {
    requestOptions = { method, endpoint, authOptions };
    return {
      data: [
        { name: "Private Network", type: "corporate" },
        { name: "Visitor WiFi", type: "hotspot", hotspot_enabled: true }
      ]
    };
  };

  try {
    const ssid = await helper.fetchGuestNetworkName(state);
    assert.equal(ssid, "Visitor WiFi");
    assert.equal(requestOptions.method, "GET");
    assert.equal(requestOptions.endpoint, "/proxy/network/integration/v1/sites/default/wlan");
    assert.deepEqual(requestOptions.authOptions, {
      apiKey: "server-key",
      apiKeyHeader: "X-API-Key"
    });
  } finally {
    helper.requestJson = originalRequest;
  }
});

test("renderer helper payload excludes connection and authentication fields", () => {
  const definition = loadRendererDefinition();
  let sent;
  const instance = {
    ...definition,
    identifier: "module_1",
    name: "MMM-UniFiHotspotVouchers",
    config: {
      ...definition.defaults,
      controllerUrl: "https://attacker.example",
      username: "renderer-user",
      password: "renderer-password",
      apiKey: "renderer-key",
      authMode: "login",
      apiKeyHeader: "Authorization"
    },
    sendSocketNotification(notification, payload) {
      sent = { notification, payload };
    }
  };

  instance.start();

  assert.equal(sent.notification, "UNIFI_HOTSPOT_CONFIG");
  assert.deepEqual(
    Object.keys(sent.payload).sort(),
    ["debug", "instanceId", "refreshInterval", "requestTimeout"]
  );
  assert.equal(JSON.stringify(sent.payload).includes("renderer-"), false);
});

test("server configuration ignores renderer targets and credentials", () => {
  withEnvironment({
    UNIFI_HOTSPOT_URL: "https://TRUSTED.example:443",
    UNIFI_HOTSPOT_API_KEY: "server-key",
    UNIFI_HOTSPOT_SITE: "trusted-site",
    UNIFI_HOTSPOT_VOUCHER_CODE_POLICY: "masked"
  }, () => {
    const config = helper.buildServerConfig({
      instanceId: "module_1",
      controllerUrl: "https://169.254.169.254",
      site: "attacker-site",
      username: "renderer-user",
      password: "renderer-password",
      apiKey: "renderer-key",
      showVoucherCode: true,
      maskVoucherCode: false,
      voucherCodePolicy: "full"
    });

    assert.equal(config.controllerUrl, "https://trusted.example");
    assert.equal(config.site, "trusted-site");
    assert.equal(config.voucherCodePolicy, "masked");
    assert.equal(config.username, "");
    assert.equal(config.password, "");
    assert.equal(config.apiKey, "server-key");
  });
});

test("server instance policy selects sites and rejects renderer-created instances", () => {
  withEnvironment({
    UNIFI_HOTSPOT_URL: "https://unifi.example",
    UNIFI_HOTSPOT_API_KEY: "server-key",
    UNIFI_HOTSPOT_SITE: "fallback-site",
    UNIFI_HOTSPOT_INSTANCE_SITES: JSON.stringify({
      module_1: "lobby",
      module_2: "guest"
    })
  }, () => {
    const permitted = helper.buildServerConfig({
      instanceId: "module_1",
      site: "guest"
    });
    assert.equal(permitted.site, "lobby");

    assert.throws(
      () => helper.buildServerConfig({ instanceId: "attacker", site: "lobby" }),
      /not permitted by the server-side site policy/
    );
  });
});

test("invalid server disclosure policy fails closed", () => {
  withEnvironment({
    UNIFI_HOTSPOT_URL: "https://unifi.example",
    UNIFI_HOTSPOT_API_KEY: "server-key",
    UNIFI_HOTSPOT_VOUCHER_CODE_POLICY: "renderer"
  }, () => {
    assert.throws(
      () => helper.buildServerConfig({ instanceId: "module_1" }),
      /must be hidden, masked, or full/
    );
  });
});

test("server configuration requires a trusted HTTPS URL and server credentials", () => {
  withEnvironment({
    UNIFI_HOTSPOT_URL: "http://unifi.example",
    UNIFI_HOTSPOT_API_KEY: "server-key"
  }, () => {
    assert.throws(
      () => helper.buildServerConfig({ instanceId: "module_1" }),
      /must be an HTTPS origin/
    );
  });

  withEnvironment({
    UNIFI_HOTSPOT_URL: "https://unifi.example"
  }, () => {
    assert.throws(
      () => helper.buildServerConfig({ instanceId: "module_1" }),
      /Server-side UniFi credentials are required/
    );
  });
});

test("secret-bearing HTTP requests are rejected before network activity", async () => {
  const state = createState({ config: { controllerUrl: "http://unifi.example" } });
  let requestCalled = false;
  const originalRequest = https.request;
  https.request = () => {
    requestCalled = true;
  };

  try {
    await assert.rejects(
      helper.requestJson(state, "GET", "http://unifi.example", "/api/test", null, null, { apiKey: "secret" }),
      /require HTTPS/
    );
    await assert.rejects(
      helper.requestJson(state, "GET", "http://unifi.example", "/api/test", null, null, { cookies: true }),
      /require HTTPS/
    );
    await assert.rejects(
      helper.requestJson(state, "POST", "http://unifi.example", "/api/auth/login", { password: "secret" }),
      /require HTTPS/
    );
    assert.equal(requestCalled, false);
  } finally {
    https.request = originalRequest;
  }
});

test("controller requests verify TLS and keep cookies isolated by instance", async () => {
  const optionsSeen = [];
  const restore = mockHttpsResponse({}, optionsSeen);
  const first = createState({ instanceId: "module_1", sessionCookies: ["TOKEN=one"] });
  const second = createState({ instanceId: "module_2", sessionCookies: ["TOKEN=two"] });

  try {
    await helper.requestJson(first, "GET", first.config.controllerUrl, "/api/test", null, null, { cookies: true });
    await helper.requestJson(second, "GET", second.config.controllerUrl, "/api/test", null, null, { cookies: true });
    assert.equal(optionsSeen[0].options.rejectUnauthorized, true);
    assert.equal(optionsSeen[0].options.headers.Cookie, "TOKEN=one");
    assert.equal(optionsSeen[1].options.headers.Cookie, "TOKEN=two");
  } finally {
    restore();
  }
});

test("successful empty API-key response does not fall back to login", async () => {
  const state = createState({
    config: {
      username: "server-user",
      password: "server-password",
      authMode: "auto"
    }
  });
  let loginCalls = 0;
  const originalFetch = helper.fetchVoucherEndpoints;
  const originalLogin = helper.login;
  helper.fetchVoucherEndpoints = async () => [];
  helper.login = async () => {
    loginCalls += 1;
  };

  try {
    assert.deepEqual(await helper.fetchVouchers(state), []);
    assert.equal(loginCalls, 0);
  } finally {
    helper.fetchVoucherEndpoints = originalFetch;
    helper.login = originalLogin;
  }
});

test("empty endpoint success takes precedence over other endpoint failures", async () => {
  const state = createState();
  const originalRequestJson = helper.requestJson;
  let calls = 0;
  helper.requestJson = async () => {
    calls += 1;
    if (calls === 2) {
      return { data: [] };
    }
    throw Object.assign(new Error("failed"), { code: "CONTROLLER_ERROR", statusCode: 500 });
  };

  try {
    assert.deepEqual(
      await helper.fetchVoucherEndpoints(state, state.config.controllerUrl, ["/one", "/two", "/three"], {
        apiKey: "server-key"
      }, false),
      []
    );
  } finally {
    helper.requestJson = originalRequestJson;
  }
});

test("instance state, routing, and timers remain independent", () => {
  const first = createState({
    instanceId: "module_1",
    config: { voucherCodePolicy: "full" }
  });
  const second = createState({ instanceId: "module_2" });
  helper.instances.set(first.instanceId, first);
  helper.instances.set(second.instanceId, second);
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });

  helper.sendData(first, [{ code: "first" }]);
  helper.sendError(second, Object.assign(new Error("secret detail"), { code: "AUTHENTICATION_ERROR" }));

  assert.equal(helper.instances.get("module_1").sessionCookies === helper.instances.get("module_2").sessionCookies, false);
  assert.equal(sent[0].payload.instanceId, "module_1");
  assert.equal(sent[1].payload.instanceId, "module_2");
  assert.deepEqual(sent[1].payload, {
    code: "AUTHENTICATION_ERROR",
    instanceId: "module_2"
  });
});

test("helper response omits voucher codes when server policy is hidden", () => {
  const state = createState({ config: { voucherCodePolicy: "hidden" } });
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });

  helper.sendData(state, [{
    code: "1234567890",
    note: "Lobby",
    status: "active"
  }]);

  assert.equal(sent[0].notification, "UNIFI_HOTSPOT_DATA");
  assert.equal(sent[0].payload.voucherCodePolicy, "hidden");
  assert.equal(Object.hasOwn(sent[0].payload.vouchers[0], "code"), false);
  assert.equal(JSON.stringify(sent[0].payload).includes("1234567890"), false);
});

test("helper response masks voucher codes before broadcast", () => {
  const state = createState({ config: { voucherCodePolicy: "masked" } });
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });

  helper.sendData(state, [{
    code: "1234567890",
    note: "Lobby",
    status: "active"
  }]);

  assert.equal(sent[0].payload.voucherCodePolicy, "masked");
  assert.equal(sent[0].payload.vouchers[0].code, "••••••7890");
  assert.equal(JSON.stringify(sent[0].payload).includes("1234567890"), false);
});

test("helper broadcasts full voucher codes only with explicit server policy", () => {
  const state = createState({ config: { voucherCodePolicy: "full" } });
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });

  helper.sendData(state, [{ code: "1234567890" }]);

  assert.equal(sent[0].payload.voucherCodePolicy, "full");
  assert.equal(sent[0].payload.vouchers[0].code, "1234567890");
});

test("stale in-flight instance work cannot publish or reschedule", async () => {
  const stale = createState({ instanceId: "module_1" });
  const current = createState({ instanceId: "module_1" });
  helper.instances.set(current.instanceId, current);
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
  const originalFetchVouchers = helper.fetchVouchers;
  helper.fetchVouchers = async () => [{ code: "stale" }];

  try {
    await helper.refreshData(stale);
    helper.sendError(stale, Object.assign(new Error("stale failure"), { code: "AUTHENTICATION_ERROR" }));
    assert.deepEqual(sent, []);
  } finally {
    helper.fetchVouchers = originalFetchVouchers;
  }
});

test("refresh and request timers clamp finite integer delays safely", () => {
  withEnvironment({
    UNIFI_HOTSPOT_URL: "https://unifi.example",
    UNIFI_HOTSPOT_API_KEY: "server-key"
  }, () => {
    const maximum = helper.buildServerConfig({
      instanceId: "module_1",
      refreshInterval: Number.MAX_VALUE,
      requestTimeout: Infinity
    });
    const minimum = helper.buildServerConfig({
      instanceId: "module_2",
      refreshInterval: "1.9",
      requestTimeout: -5
    });

    assert.equal(maximum.refreshInterval, 2147483647);
    assert.equal(maximum.requestTimeout, 10000);
    assert.equal(helper.buildServerConfig({
      instanceId: "module_3", requestTimeout: Number.MAX_VALUE
    }).requestTimeout, 30000);
    assert.equal(minimum.refreshInterval, 30000);
    assert.equal(minimum.requestTimeout, 1000);
  });

  const state = createState({ config: { refreshInterval: 999999999999 } });
  const originalSetTimeout = global.setTimeout;
  let delay;
  global.setTimeout = (callback, timeout) => {
    delay = timeout;
    return { callback };
  };

  try {
    helper.scheduleNextRefresh(state);
    assert.equal(delay, 2147483647);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("controller failures never disclose response bodies to renderer", async () => {
  const secretBody = "password=hunter2 token=abc123 http://10.0.0.5/internal";
  const restore = mockHttpsResponse({
    chunks: [Buffer.from(secretBody)],
    statusCode: 500
  });
  const state = createState();
  helper.instances.set(state.instanceId, state);
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });

  try {
    let caught;
    try {
      await helper.requestJson(state, "GET", state.config.controllerUrl, "/api/test", null, null, {
        apiKey: "server-key"
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.message.includes(secretBody), false);
    assert.equal(Object.hasOwn(caught, "responseBody"), false);

    helper.sendError(state, caught);
    assert.deepEqual(sent[0].payload, {
      code: "CONTROLLER_ERROR",
      instanceId: "module_1"
    });
    assert.equal(JSON.stringify(sent).includes("hunter2"), false);
  } finally {
    restore();
  }
});

test("renderer maps only allowlisted public error codes", () => {
  const definition = loadRendererDefinition();
  const instance = {
    ...definition,
    instanceId: "module_1",
    hasRenderedData: false,
    config: { debug: false, animationSpeed: 0 },
    dataState: {},
    updateDom() {}
  };

  instance.socketNotificationReceived("UNIFI_HOTSPOT_ERROR", {
    instanceId: "module_1",
    code: "UNKNOWN",
    error: "password=hunter2"
  });

  assert.equal(instance.dataState.error, "Unable to load UniFi hotspot vouchers.");
  assert.equal(JSON.stringify(instance.dataState).includes("hunter2"), false);
});

test("controller responses reject bodies over 1 MB with a sanitized error", async () => {
  const restore = mockHttpsResponse({ chunks: [Buffer.alloc(1048577, "x")] });
  const state = createState();

  try {
    await assert.rejects(
      helper.requestJson(state, "GET", state.config.controllerUrl, "/api/test", null, null, {
        apiKey: "server-key"
      }),
      /UniFi controller request failed/
    );
  } finally {
    restore();
  }
});
