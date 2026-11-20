// Windows only, and only when asked for (BATTERY_E2E_WINDOWS=1), because it
// relies on the helper installed by host\windows\install.bat (registry key
// in HKCU). Meant for the CI Windows job, where it proves that a real Firefox
// on real Windows can start the installed helper and understand it.
//
// NOT YET RUN ANYWHERE: there was no Windows machine when this was written.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { launch, findFirefox, sleep } = require("./harness.js");

const skip = process.platform !== "win32" ? "Windows only"
  : !process.env.BATTERY_E2E_WINDOWS ? "set BATTERY_E2E_WINDOWS=1 after running host\\windows\\install.bat"
  : !findFirefox() ? "no Firefox found (set FIREFOX_BIN)" : false;

test("Firefox on Windows starts the installed helper and gets a valid reading", { skip }, async () => {
  // helper: "none" = do not write a manifest; Firefox finds the installed one through the registry.
  const b = await launch({ helper: "none", env: { HOME: process.env.USERPROFILE } });
  try {
    let view = null;
    for (let i = 0; i < 60 && !(view && view.kind !== "no-host"); i++) {
      await sleep(500); // PowerShell takes a moment to start
      view = (await b.session()).view || null;
    }
    assert.ok(view, "the extension published a view");
    assert.ok(["battery", "no-battery"].includes(view.kind), `helper connected and spoke the protocol, got: ${JSON.stringify(view)}`);
    if (view.kind === "battery") {
      assert.ok(Number.isInteger(view.state.percentage));
      assert.strictEqual(view.state.v, 1);
    }
  } finally {
    await b.close();
  }
});
