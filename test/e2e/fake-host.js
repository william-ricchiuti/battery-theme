#!/usr/bin/env node
// A scriptable stand-in for the battery helper, used by the end-to-end tests.
// Firefox starts it through a native-messaging manifest; the test steers it
// through files in a control directory (argv[2]):
//
//   state.json  the message to send; re-sent whenever its content changes
//   mode        how to behave (read once at start):
//                 normal       send state.json and follow it (default)
//                 silent       start, never send anything
//                 die-early    send one reading, then exit with an error
//                 garbage      send bytes that are not a valid message
//                 exit         exit at once without sending
//   log         one line per start / exit, so tests can count launches
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const read = (name) => {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
};
const log = (line) => fs.appendFileSync(path.join(dir, "log"), `${line} ${process.pid} ${Date.now()}\n`);

function send(text) {
  const body = Buffer.from(text, "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
}

const mode = (read("mode") || "normal").trim();
log(`start ${mode}`);

process.stdin.on("end", () => {
  log("stdin-closed");
  process.exit(0);
});
process.stdin.resume();

if (mode === "exit") process.exit(1);
if (mode === "garbage") {
  process.stdout.write(Buffer.from([5, 0, 0, 0, 0x6e, 0x6f, 0x74, 0x6a, 0x73]));
} else if (mode !== "silent") {
  let last = null;
  const tick = () => {
    const text = read("state.json");
    if (text === null || text === last) return;
    try {
      JSON.parse(text); // the test may be half-way through writing it
    } catch {
      return;
    }
    last = text;
    send(text.trim());
    if (mode === "die-early") setTimeout(() => process.exit(1), 150);
  };
  tick();
  setInterval(tick, 40);
}
