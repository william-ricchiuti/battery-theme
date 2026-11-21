// Minimal Marionette client: enough to drive a real Firefox from the tests
// without any npm dependency. Marionette is Firefox's built-in automation
// server (what geckodriver talks to). Messages are `<length>:<json>` over TCP;
// a command is [0, id, name, params] and the reply is [1, id, error, result].
"use strict";
const net = require("node:net");

class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.hello = new Promise((resolve) => (this.onHello = resolve));
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("Marionette connection closed"));
      this.pending.clear();
    });
    socket.on("error", () => {});
  }

  static async connect(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const socket = await new Promise((resolve, reject) => {
          const s = net.connect(port, "127.0.0.1");
          s.once("connect", () => resolve(s));
          s.once("error", reject);
        });
        const client = new Marionette(socket);
        await client.hello;
        return client;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const colon = this.buffer.indexOf(0x3a);
      if (colon < 0) return;
      const length = Number(this.buffer.subarray(0, colon).toString());
      if (this.buffer.length < colon + 1 + length) return;
      const body = this.buffer.subarray(colon + 1, colon + 1 + length).toString();
      this.buffer = this.buffer.subarray(colon + 1 + length);
      const msg = JSON.parse(body);
      if (!Array.isArray(msg)) {
        this.onHello(msg);
        continue;
      }
      const [, id, error, result] = msg;
      const waiter = this.pending.get(id);
      if (!waiter) continue;
      this.pending.delete(id);
      if (error) {
        const e = new Error(`${waiter.name}: ${error.error}: ${error.message}`);
        e.marionette = error;
        waiter.reject(e);
      } else waiter.resolve(result);
    }
  }

  send(name, params = {}) {
    const id = this.nextId++;
    const body = JSON.stringify([0, id, name, params]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, name });
      this.socket.write(`${Buffer.byteLength(body)}:${body}`);
    });
  }

  async newSession() {
    return this.send("WebDriver:NewSession", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  }

  setContext(value) {
    return this.send("Marionette:SetContext", { value });
  }

  // Runs `script` (a function body; use `return`) and gives back its value.
  async execute(script, args = [], { sandbox = "default", async = false } = {}) {
    const res = await this.send(async ? "WebDriver:ExecuteAsyncScript" : "WebDriver:ExecuteScript", {
      script,
      args,
      newSandbox: false,
      sandbox,
    });
    return res.value;
  }

  // Runs privileged code in the browser window itself.
  async chrome(script, args = [], opts = {}) {
    await this.setContext("chrome");
    try {
      return await this.execute(script, args, opts);
    } finally {
      await this.setContext("content");
    }
  }

  close() {
    this.socket.destroy();
  }
}

module.exports = { Marionette };
