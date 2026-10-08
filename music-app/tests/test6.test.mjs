// test6: lyrics provider chain + player style setting + KuGou helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, defaults } from "../src/v2/core.js";

// findLyrics reaches decodeHtml, which uses a DOM textarea; give node the
// minimal shim (entity decoding is exercised by its own browser e2e tests).
global.document ??= {
  createElement: () => {
    let h = "";
    return {
      set innerHTML(v) {
        h = v;
      },
      get value() {
        return h.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      },
    };
  },
};
const { decodeBase64Utf8, kugouScore, PROVIDERS, artistCandidates, findLyrics } =
  await import("../src/v2/lyrics.js");

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

// --- regression: device bug "lyrics is not loading" (test6 field report) ---

// JioSaavn credits the composer first; LRCLIB/KuGou tag lyrics by singer.
const tumHiHo = {
  name: "Tum Hi Ho",
  duration: 262,
  album: { name: "Aashiqui 2" },
  artists: {
    primary: [{ name: "Mithoon" }, { name: "Arijit Singh" }],
    all: [
      { name: "Mithoon", role: "music" },
      { name: "Arijit Singh", role: "singer" },
      { name: "Mithoon", role: "lyricist" },
    ],
  },
};

test("artistCandidates puts the singer ahead of the composer", () => {
  assert.deepEqual(artistCandidates(tumHiHo), ["Arijit Singh", "Mithoon"]);
});

test("a junk instrumental-flagged LRCLIB row no longer ends the chain", async () => {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/get")) {
      // Composer-keyed junk row: right title/duration, flagged instrumental.
      if (u.includes("Mithoon"))
        return Response.json({
          trackName: "Tum Hi Ho",
          artistName: "Mithoon",
          duration: 262,
          instrumental: true,
        });
      return new Response("", { status: 404 });
    }
    if (u.includes("/api/search"))
      return Response.json([
        {
          trackName: "Tum Hi Ho",
          artistName: "Arijit Singh",
          duration: 261,
          syncedLyrics: "[00:10.00]Hum tere bin\n[00:14.00]Ab reh nahi sakte",
        },
      ]);
    throw Error("unexpected " + u);
  };
  try {
    const r = await findLyrics(tumHiHo, [
      "local",
      "lrclib-exact",
      "lrclib-search",
    ]);
    assert.equal(r.type, "synced");
    assert.equal(r.provider, "lrclib-search");
    assert.equal(r.lines.length, 2);
  } finally {
    global.fetch = realFetch;
  }
});

test("search hits are accepted when tagged with any credited artist", async () => {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/get")) return new Response("", { status: 404 });
    if (u.includes("/api/search")) {
      assert.ok(!u.includes("artist_name"), "search should recall by title");
      return Response.json([
        {
          trackName: "Tum Hi Ho",
          artistName: "Somebody Else",
          duration: 180,
          syncedLyrics: "[00:01.00]Wrong recording",
        },
        {
          trackName: "Tum Hi Ho",
          artistName: "Arijit Singh",
          duration: 262,
          plainLyrics: "Hum tere bin ab reh nahi sakte",
        },
      ]);
    }
    throw Error("unexpected " + u);
  };
  try {
    const r = await findLyrics(tumHiHo, ["lrclib-exact", "lrclib-search"]);
    assert.equal(r.type, "plain");
    assert.match(r.text, /reh nahi sakte/);
  } finally {
    global.fetch = realFetch;
  }
});

test("instrumental is still honored when nothing better exists anywhere", async () => {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/get"))
      return u.includes("Arijit")
        ? Response.json({
            trackName: "Tum Hi Ho",
            artistName: "Arijit Singh",
            duration: 262,
            instrumental: true,
          })
        : new Response("", { status: 404 });
    if (u.includes("/api/search")) return Response.json([]);
    throw Error("unexpected " + u);
  };
  try {
    const r = await findLyrics(tumHiHo, ["lrclib-exact", "lrclib-search"]);
    assert.equal(r.type, "instrumental");
    assert.equal(r.provider, "lrclib-exact");
  } finally {
    global.fetch = realFetch;
  }
});
