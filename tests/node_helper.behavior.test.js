const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
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

function mockHttpsResponse(chunks, optionsSeen) {
  const originalRequest = https.request;

  https.request = (url, options, responseCallback) => {
    const request = new EventEmitter();
    optionsSeen.push(options);
    request.setTimeout = () => {};
    request.write = () => {};
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
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

test("controller requests verify TLS and parse bounded responses", async () => {
  const optionsSeen = [];
  const restore = mockHttpsResponse([Buffer.from('{"data":[]}')], optionsSeen);
  helper.config = { verifySSL: true, requestTimeout: 10000 };

  try {
    const response = await helper.requestJson("GET", "https://unifi.example", "/api/test");
    assert.deepEqual(response.data, []);
    assert.equal(optionsSeen[0].rejectUnauthorized, true);
  } finally {
    restore();
  }
});

test("controller responses reject bodies over 1 MB", async () => {
  const restore = mockHttpsResponse([Buffer.alloc(1048577, "x")], []);
  helper.config = { verifySSL: true, requestTimeout: 10000 };

  try {
    await assert.rejects(
      helper.requestJson("GET", "https://unifi.example", "/api/test"),
      /Response body exceeded 1 MB limit/
    );
  } finally {
    restore();
  }
});

test("server UniFi credentials take precedence over renderer config", () => {
  const previousUsername = process.env.UNIFI_HOTSPOT_USERNAME;
  const previousPassword = process.env.UNIFI_HOTSPOT_PASSWORD;
  const previousApiKey = process.env.UNIFI_HOTSPOT_API_KEY;
  process.env.UNIFI_HOTSPOT_USERNAME = "server-user";
  process.env.UNIFI_HOTSPOT_PASSWORD = "server-password";
  process.env.UNIFI_HOTSPOT_API_KEY = "server-key";

  try {
    const config = helper.applyServerSecrets({
      username: "renderer-user",
      password: "renderer-password",
      apiKey: "renderer-key"
    });
    assert.equal(config.username, "server-user");
    assert.equal(config.password, "server-password");
    assert.equal(config.apiKey, "server-key");
  } finally {
    const values = {
      UNIFI_HOTSPOT_USERNAME: previousUsername,
      UNIFI_HOTSPOT_PASSWORD: previousPassword,
      UNIFI_HOTSPOT_API_KEY: previousApiKey
    };
    Object.entries(values).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});