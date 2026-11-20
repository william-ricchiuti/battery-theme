// End-to-end tests for the long haul: sleep and wake, a flapping charger,
// and many hours of battery cycles squeezed into a minute.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { launch, findFirefox, sleep } = require("./harness.js");
const C = require("../../extension/theme-colors.js");

const skip = findFirefox() ? false : "no Firefox found (set FIREFOX_BIN)";
const frameFor = (state) => C.css(C.buildTheme({ dark: true, on_ac: false, ...state }, {}).raw.frame);

test("sleep and wake: a frozen browser and helper catch up to the new reading", { skip: skip || (process.platform === "win32" && "needs POSIX signals") }, async () => {
  const b = await launch();
  try {
    b.setState({ percentage: 80 });
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 80 }), "80%");
    const helperPid = Number(b.helperLog()[0].split(" ")[2]);
    // "Sleep": everything stops; the battery drains meanwhile.
    process.kill(b.child.pid, "SIGSTOP");
    process.kill(helperPid, "SIGSTOP");
    b.setState({ percentage: 31 });
    await sleep(4000);
    process.kill(helperPid, "SIGCONT");
    process.kill(b.child.pid, "SIGCONT");
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 31 }), "31% after waking", 10000);
    assert.strictEqual(b.helperStarts(), 1, "the helper connection survived the freeze");
  } finally {
    try { process.kill(b.child.pid, "SIGCONT"); } catch {}
    await b.close();
  }
});

test("plugging and unplugging quickly ends on the right state without a storm of repaints", { skip }, async () => {
  const b = await launch();
  try {
    b.setState({ percentage: 55 });
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 55 }), "55%");
    await sleep(5000);
    await b.startRepaintCounter();
    for (let i = 0; i < 30; i++) {
      b.setState({ percentage: 55, on_ac: i % 2 === 0, charging: i % 2 === 0 });
      await sleep(60);
    }
    b.setState({ percentage: 55, on_ac: true, charging: true });
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 55, on_ac: true, charging: true }), "ends charging");
    await sleep(500);
    const repaints = await b.repaints();
    assert.ok(repaints <= 31, `at most one repaint per real change, saw ${repaints}`);
    b.setState({ percentage: 55 });
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 55 }), "and back on battery");
  } finally {
    await b.close();
  }
});

test("three full discharge/charge cycles: one helper, bounded repaints, correct at the end", { skip }, async () => {
  const b = await launch();
  try {
    b.setState({ percentage: 100 });
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 100 }), "100%");
    await sleep(5000);
    await b.startRepaintCounter();
    let sent = 0;
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let p = 100; p >= 0; p--) { b.setState({ percentage: p, minutes_remaining: p * 5 }); sent++; await sleep(45); }
      for (let p = 0; p <= 100; p++) { b.setState({ percentage: p, on_ac: true, charging: true }); sent++; await sleep(45); }
    }
    const end = b.setState({ percentage: 100, on_ac: true, charged: true });
    await b.waitForTheme((t) => t.frame === frameFor(end) && t.gauge.level === 100, "full and plugged in at the end");
    await sleep(1500);
    const repaints = await b.repaints();
    // Per cycle: 51 gauge steps down + 51 up + the charger change + two flashes (two extra paints each).
    const ceiling = 3 * (51 + 51 + 2 + 4) + 4;
    console.log(`# ${sent} readings in 3 cycles -> ${repaints} theme repaints (${(repaints / 3).toFixed(0)} per full cycle)`);
    assert.ok(repaints <= ceiling, `repaints ${repaints} within the expected ${ceiling}`);
    assert.strictEqual(b.helperStarts(), 1, "never reconnected");
    const session = await b.session();
    assert.ok(JSON.stringify(session).length < 2000, "stored state stays small");
    assert.strictEqual(session.view.state.percentage, 100);
  } finally {
    await b.close();
  }
});
