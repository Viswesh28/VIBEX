// test6: lyrics provider chain + player style setting + KuGou helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, defaults } from "../src/v2/core.js";
import { decodeBase64Utf8, kugouScore, PROVIDERS } from "../src/v2/lyrics.js";

test("defaults include the KuGou provider and classic player style", () => {
  assert.ok(defaults.lyricsProviders.includes("kugou"));
  assert.equal(defaults.playerStyle, "classic");
});

test("cleanSettings keeps kugou and drops unknown providers", () => {
  const s = cleanSettings({
    ...defaults,
    lyricsProviders: ["kugou", "lrclib-exact", "bogus", "local"],
  });
  assert.deepEqual(s.lyricsProviders, ["kugou", "lrclib-exact", "local"]);
});

test("cleanSettings validates playerStyle", () => {
  assert.equal(
    cleanSettings({ ...defaults, playerStyle: "aurora" }).playerStyle,
    "aurora",
  );
  assert.equal(
    cleanSettings({ ...defaults, playerStyle: "neon" }).playerStyle,
    "classic",
  );
});

test("legacy settings without playerStyle get the classic default", () => {
  const s = cleanSettings({ ...defaults, playerStyle: undefined });
  assert.equal(s.playerStyle, "classic");
});

test("decodeBase64Utf8 survives non-ASCII lyrics", () => {
  const text = "நான் பாடுவேன் [00:01.00] வணக்கம் 你好";
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  assert.equal(decodeBase64Utf8(b64), text);
});

test("kugouScore prefers the matching recording", () => {
  const query = { title: "Tum Hi Ho", artist: "Arijit Singh", duration: 262 };
  const good = kugouScore(
    { song: "Tum Hi Ho", singer: "Arijit Singh", duration: 261000 },
    query,
  );
  const wrong = kugouScore(
    { song: "Tum Hi Ho Remix DJ", singer: "Somebody", duration: 190000 },
    query,
  );
  assert.ok(good >= 0.6, `good=${good}`);
  assert.ok(good > wrong, `good=${good} wrong=${wrong}`);
});

test("provider registry exposes exactly the login-free online providers", () => {
  assert.deepEqual(
    Object.keys(PROVIDERS).sort(),
    ["kugou", "lrclib-exact", "lrclib-search"].sort(),
  );
});
