import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlayerReturnGate,
  watchBrowserReturns,
} from "../src/v2/player-return.js";
const active = {
  token: "launch",
  ready: true,
  visible: true,
  current: { id: "song" },
};
test("open current track once after an authoritative launch snapshot", () => {
  const gate = createPlayerReturnGate();
  assert.equal(gate.consume({ ...active, ready: false }), false);
  assert.equal(gate.consume(active), true);
  assert.equal(gate.consume(active), false);
});
test("an empty launch is consumed, so selecting the first song does not force open the player", () => {
  const gate = createPlayerReturnGate();
  assert.equal(gate.consume({ ...active, current: null }), false);
  assert.equal(gate.consume(active), false);
});
test("hidden return requests wait until visible, then route once", () => {
  const gate = createPlayerReturnGate();
  assert.equal(gate.consume({ ...active, visible: false }), false);
  assert.equal(gate.consume(active), true);
  assert.equal(gate.consume({ ...active, token: "return-2" }), true);
});
test("changing tracks or playback state is not a foreground return", () => {
  const gate = createPlayerReturnGate();
  gate.consume(active);
  assert.equal(
    gate.consume({ ...active, current: { id: "next" }, playing: true }),
    false,
  );
  assert.equal(
    gate.consume({ ...active, current: { id: "next" }, playing: false }),
    false,
  );
});
test("paused current song can be displayed without issuing transport commands", () => {
  const gate = createPlayerReturnGate();
  const snapshot = { ...active, playing: false, position: 50 };
  assert.equal(gate.consume(snapshot), true);
  assert.equal(snapshot.playing, false);
  assert.equal(snapshot.position, 50);
});
function env() {
  const doc = new EventTarget(),
    win = new EventTarget();
  doc.hidden = false;
  const timers = new Map();
  let next = 0;
  win.setTimeout = (fn) => {
    timers.set(++next, fn);
    return next;
  };
  win.clearTimeout = (id) => timers.delete(id);
  return {
    doc,
    win,
    timers,
    visibility(hidden) {
      doc.hidden = hidden;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    flush() {
      const fns = [...timers.values()];
      timers.clear();
      fns.forEach((f) => f());
    },
  };
}
test("browser returns are event-driven and repeated visible events do not reopen", () => {
  const e = env();
  let calls = 0;
  const stop = watchBrowserReturns(() => calls++, e.doc, e.win);
  e.visibility(false);
  assert.equal(calls, 0);
  e.visibility(true);
  e.visibility(false);
  assert.equal(calls, 1);
  e.visibility(false);
  assert.equal(calls, 1);
  stop();
  e.visibility(true);
  e.visibility(false);
  assert.equal(calls, 1);
  assert.equal(e.timers.size, 0);
});
test("file picker return is suppressed without suppressing the next real app return", () => {
  const e = env();
  let calls = 0;
  const stop = watchBrowserReturns(() => calls++, e.doc, e.win);
  const event = new Event("click");
  Object.defineProperty(event, "target", { value: { matches: () => true } });
  e.doc.dispatchEvent(event);
  e.visibility(true);
  e.visibility(false);
  assert.equal(calls, 0);
  e.flush();
  e.visibility(true);
  e.visibility(false);
  assert.equal(calls, 1);
  stop();
});

test("an unfinished dialog is preserved and its return is consumed rather than deferred", () => {
  const gate = createPlayerReturnGate();
  assert.equal(gate.consume({ ...active, blocked: true }), false);
  assert.equal(gate.consume(active), false);
  assert.equal(gate.consume({ ...active, token: "next-return" }), true);
});
