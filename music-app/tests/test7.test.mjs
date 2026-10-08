// test7: audio-source setting (auto / saavn / youtube).
import test from "node:test";
import assert from "node:assert/strict";
import { cleanSettings, defaults } from "../src/v2/core.js";

test("default audio source is auto (JioSaavn first, YouTube rescue)", () => {
  assert.equal(defaults.audioSource, "auto");
});

test("cleanSettings keeps every valid audio source", () => {
  for (const mode of ["auto", "saavn", "youtube"])
    assert.equal(
      cleanSettings({ ...defaults, audioSource: mode }).audioSource,
      mode,
    );
});

test("cleanSettings rejects unknown audio sources", () => {
  assert.equal(
    cleanSettings({ ...defaults, audioSource: "spotify" }).audioSource,
    "auto",
  );
});

test("legacy settings without audioSource get the auto default", () => {
  const s = cleanSettings({ ...defaults, audioSource: undefined });
  assert.equal(s.audioSource, "auto");
});
