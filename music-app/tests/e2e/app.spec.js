import { test, expect } from "@playwright/test";
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#bea5df"/></svg>',
  );
const songs = Array.from({ length: 8 }, (_, i) => ({
  id: `track${i}`,
  name: `Test Song ${i}`,
  duration: 120,
  album: { id: "album", name: "Test Album" },
  artists: { primary: [{ id: "artist", name: "Test Artist" }] },
  image: [{ url: image }],
  downloadUrl: [{ quality: "320kbps", url: "http://127.0.0.1:8000/test.wav" }],
}));
function wav() {
  const frames = 8000 * 15,
    b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * 2, 40);
  return b;
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (r) => {
    const u = new URL(r.request().url());
    let data = u.pathname.includes("/songs/")
      ? [songs.find((s) => s.id === u.pathname.split("/").at(-1)) || songs[0]]
      : u.pathname.includes("search/albums")
        ? {
            results: [
              { id: "album", name: "Test Album", image: [{ url: image }] },
            ],
          }
        : u.pathname.includes("/albums")
          ? { id: "album", name: "Test Album", image: [{ url: image }], songs }
          : { results: songs };
    return r.fulfill({ json: { success: true, data } });
  });
  await page.route("**/test.wav", (r) =>
    r.fulfill({
      body: wav(),
      contentType: "audio/wav",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("https://lrclib.net/**", (r) =>
    r.fulfill({
      json: {
        trackName: "Test Song 0",
        artistName: "Test Artist",
        duration: 120,
        syncedLyrics: "[00:00.00]First line\n[00:05.00]Second line",
      },
    }),
  );
});
test("mobile layout, navigation and offline explanation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(6);
  for (const width of [320, 360, 393, 412, 851]) {
    await page.setViewportSize({ width, height: width === 851 ? 393 : 851 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 393, height: 851 });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Downloads" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your offline world" }),
  ).toBeVisible();
  await expect(
    page.getByText("Managed downloads run in the Android app", {
      exact: false,
    }),
  ).toBeVisible();
});
test("like, playlist creation, duplicate validation and persistence", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".track")
    .first()
    .getByRole("button", { name: "Like track", exact: true })
    .click();
  await page
    .locator(".track")
    .first()
    .getByRole("button", { name: "More options", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Add to playlist", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "New playlist name" })
    .fill("Evening drive");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Evening drive 1 tracks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New playlist", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New playlist name" })
    .fill("Evening drive");
  await page
    .getByRole("button", { name: "Create playlist", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "A playlist with that name already exists.",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const r = indexedDB.open("vibex-library", 2);
            r.onsuccess = () => {
              const q = r.result
                .transaction("documents")
                .objectStore("documents")
                .get("library");
              q.onsuccess = () => resolve(q.result?.liked?.length);
            };
          }),
      ),
    )
    .toBe(1);
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Evening drive 1 tracks" }),
  ).toBeVisible();
});
test("search, real HTML audio transport, queue controls, lyrics", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search music" }).fill("test");
  await expect(page.locator(".track")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await page.locator(".mini-info").click();
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "First line", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).last().click();
  await expect(page.locator(".big-play")).toHaveAttribute("aria-label", "Play");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  const rows = page.locator(".player-page .queue-track");
  await expect(rows).toHaveCount(8);
  await expect(
    rows.last().getByRole("button", { name: "Move down" }),
  ).toBeDisabled();
  await rows.first().getByRole("button", { name: "Remove from queue" }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole("button", { name: "Close player" }).click();
});
test("legacy migration is non-destructive and backup export is valid", async ({
  page,
}) => {
  await page.addInitScript((s) => {
    localStorage.setItem("svLiked", JSON.stringify([s]));
    localStorage.setItem(
      "svPlaylists",
      JSON.stringify([{ id: "old", name: "Old favorites", songs: [s] }]),
    );
    localStorage.setItem(
      "svStats",
      JSON.stringify({ plays: 42, seconds: 120 }),
    );
  }, songs[0]);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Old favorites 1 tracks" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => !!localStorage.getItem("svLiked")),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe("VIBEX-backup.json");
});
test("settings persist and imported timed lyrics render words", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance", { exact: false }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await page.locator(".mini-info").click();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  await page.locator(".lyrics-tools input[type=file]").setInputFiles({
    name: "lyrics.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "[00:00.00]<00:00.00>Hello <00:01.00>world\n[00:05.00]Second line",
    ),
  });
  await expect(page.locator(".lyrics-body .word-lit").first()).toHaveText(
    "Hello ",
  );
});

test("full player traps focus, background is inert, and Escape restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".mini-info").click();
  const dialog = page.getByRole("dialog", { name: "Now playing" });
  await expect(dialog).toBeVisible();
  expect(await page.locator("main").evaluate((el) => el.inert)).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Close player" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".mini-info")).toBeFocused();
  expect(await page.locator("main").evaluate((el) => el.inert)).toBeFalsy();
});

test("invalid backup is rejected; valid backup can replace and survive reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const input = page.locator("input[type=file]");
  await input.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"bad"}'),
  });
  await expect(page.getByRole("status")).toContainText("Not a supported");
  const library = {
    songs: { track0: songs[0] },
    liked: ["track0"],
    playlists: [{ id: "restore", name: "Restored playlist", ids: ["track0"] }],
    settings: { theme: "dark" },
    events: [],
  };
  await input.setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ format: "vibex-backup", version: 2, library }),
    ),
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Replace", exact: false }).click();
  await expect(page.getByRole("status")).toContainText("Library restored");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restored playlist 1 tracks" }),
  ).toBeVisible();
});

test("reversing lyrics priority selects online lyrics ahead of local imports", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await page.locator(".mini-info").click();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  await page.locator(".lyrics-tools input[type=file]").setInputFiles({
    name: "manual.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("My offline lyrics"),
  });
  await expect(
    page.getByText("My offline lyrics", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close player" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reverse source priority" }).click();
  await page.locator(".mini-info").click();
  await expect(
    page.getByRole("button", { name: "First line", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("My offline lyrics", { exact: true }),
  ).not.toBeVisible();
});

test("Vibex branding, creator credit and removed top-right avatar", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Vibex — Music Player");
  await expect(page.locator(".profile")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".about-block h3")).toHaveText("Vibex");
  await expect(page.locator(".creator-credit")).toHaveText(
    "Made with ❤️ by VISWESHSARAVAN",
  );
  await page.locator(".creator-credit").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

async function storedSearches(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("vibex-library", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const value = db
            .transaction("documents")
            .objectStore("documents")
            .get("library");
          value.onsuccess = () => {
            resolve(value.result?.searchHistory || []);
            db.close();
          };
          value.onerror = () => reject(value.error);
        };
      }),
  );
}
test("recent search remembers its category, persists, repeats and clears privately", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "albums", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search music" })
    .fill("Tamil melody");
  await page.getByRole("textbox", { name: "Search music" }).press("Enter");
  await expect
    .poll(() => storedSearches(page))
    .toEqual([{ query: "Tamil melody", tab: "albums" }]);
  await page.reload();
  await nav.getByRole("button", { name: "Search", exact: true }).click();
  const recent = page.getByRole("button", {
    name: "Search again for Tamil melody in albums",
  });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(page.getByRole("textbox", { name: "Search music" })).toHaveValue(
    "Tamil melody",
  );
  await expect(
    page.getByRole("button", { name: "albums", exact: true }),
  ).toHaveClass("selected");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear history", exact: true })
    .click();
  await expect(recent).toHaveCount(0);
  await expect.poll(() => storedSearches(page)).toEqual([]);
});

test("returning Home reuses the bounded catalog cache instead of fetching again", async ({
  page,
}) => {
  let catalogRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/search/")) catalogRequests++;
  });
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(6);
  await expect(page.locator(".album-card").first()).toBeVisible();
  const first = catalogRequests;
  expect(first).toBe(2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(page.locator(".track")).toHaveCount(6);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(page.locator(".track")).toHaveCount(6);
  expect(catalogRequests).toBe(first);
});

const navigate = (page, name) =>
  page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true })
    .click();
const readStored = (page, key = "library") =>
  page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("vibex-library", 2);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const q = r.result
            .transaction("documents")
            .objectStore("documents")
            .get(key);
          q.onsuccess = () => {
            resolve(q.result);
            r.result.close();
          };
        };
      }),
    key,
  );

test("test3 Battery Saver persists, temporarily suspends crossfade, and preserves quality", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const saver = page.getByRole("switch", {
    name: "Battery Saver",
    exact: true,
  });
  await saver.check();
  await expect(page.locator("html")).toHaveAttribute("data-saver", "true");
  await expect(page.getByLabel("Crossfade", { exact: false })).toBeDisabled();
  await expect(page.getByLabel("Streaming quality")).toHaveValue("320kbps");
  await expect
    .poll(async () => (await readStored(page))?.settings.batterySaver)
    .toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(saver).toBeChecked();
  await saver.uncheck();
  await expect(page.getByLabel("Crossfade", { exact: false })).toBeEnabled();
  await expect(page.getByLabel("Crossfade", { exact: false })).toHaveValue("3");
  await expect(page.getByLabel("Streaming quality")).toHaveValue("320kbps");
  await expect(
    page.getByText("2.0-test5 · Notification player fix"),
  ).toBeVisible();
});

test("test3 Home persists across reload, works offline, and manual refresh bypasses cache", async ({
  page,
  context,
}) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/search/")) calls++;
  });
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(6);
  await expect(page.locator(".album-card")).toHaveCount(1);
  expect(calls).toBe(2);
  await expect
    .poll(
      async () => (await readStored(page, "home-catalog-v1"))?.entries?.length,
    )
    .toBe(2);
  await page.reload();
  await expect(page.locator(".track")).toHaveCount(6);
  expect(calls).toBe(2);
  await page.getByRole("button", { name: "Refresh Home", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh Home", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => calls).toBe(4);
  await navigate(page, "Library");
  await context.setOffline(true);
  await navigate(page, "Home");
  await expect(page.locator(".track")).toHaveCount(6);
  await expect(page.getByText("Offline · saved Home picks")).toBeVisible();
  expect(calls).toBe(4);
  await context.setOffline(false);
});

test("test3 clearing Home cache keeps likes and fetches fresh Home data", async ({
  page,
}) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/search/")) calls++;
  });
  await page.goto("/");
  await page
    .locator(".track")
    .first()
    .getByRole("button", { name: "Like track", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear saved Home picks", exact: true })
    .click();
  await expect
    .poll(
      async () => (await readStored(page, "home-catalog-v1"))?.entries?.length,
    )
    .toBe(0);
  expect((await readStored(page)).liked).toHaveLength(1);
  const before = calls;
  await navigate(page, "Home");
  await expect(page.locator(".track")).toHaveCount(6);
  expect(calls).toBe(before + 2);
});

test("test3 pinned playlists and chosen sort survive a restart", async ({
  page,
}) => {
  await page.goto("/");
  await navigate(page, "Library");
  for (const name of ["Zulu", "Alpha"]) {
    await page
      .getByRole("button", { name: "New playlist", exact: true })
      .click();
    await page.getByRole("textbox", { name: "New playlist name" }).fill(name);
    await page
      .getByRole("button", { name: "Create playlist", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Zulu 0 tracks", exact: true })
    .click();
  await page.getByRole("button", { name: "Pin playlist", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unpin playlist", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await navigate(page, "Library");
  await page
    .getByRole("combobox", { name: "Sort playlists" })
    .selectOption("name");
  await expect(page.locator(".playlist-grid .playlist-tile strong")).toHaveText(
    ["Liked songs", "Zulu", "Alpha", "Make a playlist"],
  );
  await expect
    .poll(async () => (await readStored(page))?.settings.playlistSort)
    .toBe("name");
  await page.reload();
  await navigate(page, "Library");
  await expect(
    page.getByRole("combobox", { name: "Sort playlists" }),
  ).toHaveValue("name");
  await expect(page.locator(".playlist-grid .playlist-tile strong")).toHaveText(
    ["Liked songs", "Zulu", "Alpha", "Make a playlist"],
  );
});

test("test3 per-song lyric timing survives reload and does not leak into other tracks", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await page.locator(".mini-info").click();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  const offset = page.getByRole("slider", { name: "This song’s lyric offset" });
  await offset.focus();
  for (let i = 0; i < 6; i++) await offset.press("ArrowRight");
  await expect(offset).toHaveValue("1.5");
  await expect
    .poll(async () => (await readStored(page))?.lyricOffsets?.track0)
    .toBe(1.5);
  await page
    .getByRole("button", { name: "Next track", exact: true })
    .last()
    .click();
  await expect(offset).toHaveValue("0");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.locator(".player-page .queue-track .track-main").first().click();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  await expect(offset).toHaveValue("1.5");
  await page.getByRole("button", { name: "Pause", exact: true }).last().click();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
  await page.getByRole("button", { name: "Lyrics", exact: true }).click();
  await expect(offset).toHaveValue("1.5");
  await page
    .getByRole("button", { name: "Use global timing", exact: true })
    .click();
  await expect(offset).toHaveValue("0");
});

test("test3 progress advances without mutating Home content every tick", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  // Let initial track/recent-history and catalog changes settle first.
  await expect(page.locator(".recent-card")).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.homeMutations = 0;
    window.homeObserver = new MutationObserver(
      (records) => (window.homeMutations += records.length),
    );
    window.homeObserver.observe(document.querySelector(".page-content"), {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  await expect
    .poll(async () =>
      parseFloat(
        await page.locator(".mini-progress").evaluate((el) => el.style.width),
      ),
    )
    .toBeGreaterThan(15);
  expect(await page.evaluate(() => window.homeMutations)).toBe(0);
  await page.evaluate(() => window.homeObserver.disconnect());
});

test("test3 autoplay appends only six distinct tracks and Battery Saver blocks refill", async ({
  page,
}) => {
  let radioCalls = 0;
  const fresh = Array.from({ length: 9 }, (_, i) => ({
    ...songs[0],
    id: `radio${i}`,
    name: `Radio Song ${i}`,
  }));
  await page.route("**/api/search/songs?**", (r) => {
    const artist =
      new URL(r.request().url()).searchParams.get("query") === "Test Artist";
    if (artist) radioCalls++;
    return r.fulfill({
      json: {
        success: true,
        data: { results: artist ? [songs[5], ...fresh] : songs },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("switch", { name: "Autoplay queue", exact: true })
    .check();
  await page
    .getByRole("switch", { name: "Battery Saver", exact: true })
    .check();
  await navigate(page, "Home");
  await page
    .getByRole("button", { name: "Play Test Song 5", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await page.waitForTimeout(2400);
  expect(radioCalls).toBe(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("switch", { name: "Battery Saver", exact: true })
    .uncheck();
  await page.locator(".mini-info").click();
  await expect(page.locator(".player-page .queue-track")).toHaveCount(12);
  expect(radioCalls).toBe(1);
  await expect(page.locator(".player-page .autoplay-note")).toContainText(
    "6 related tracks",
  );
});

test("test3 pausing ignores an in-flight autoplay response", async ({
  page,
}) => {
  let release,
    requested = false;
  await page.route("**/api/search/songs?**", async (r) => {
    if (new URL(r.request().url()).searchParams.get("query") !== "Test Artist")
      return r.fulfill({ json: { success: true, data: { results: songs } } });
    requested = true;
    await new Promise((resolve) => (release = resolve));
    await r
      .fulfill({
        json: {
          success: true,
          data: { results: [{ ...songs[0], id: "late", name: "Late song" }] },
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("switch", { name: "Autoplay queue", exact: true })
    .check();
  await navigate(page, "Home");
  await page
    .getByRole("button", { name: "Play Test Song 5", exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await page.locator(".mini-play").click();
  release();
  await page.locator(".mini-info").click();
  await expect(page.locator(".player-page .queue-track")).toHaveCount(6);
  await page.waitForTimeout(300);
  await expect(page.locator(".player-page .queue-track")).toHaveCount(6);
});

async function simulateVisibility(page, hidden) {
  await page.evaluate((value) => {
    window.__vibexTestHidden = value;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => window.__vibexTestHidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("test4 top header and bottom navigation stay fixed while the middle scrolls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const width of [320, 393, 412]) {
    await page.setViewportSize({ width, height: 851 });
    await page.locator(".main-scroll").evaluate((el) => el.scrollTo(0, 0));
    const top = await page.locator(".topbar").boundingBox();
    const bottom = await page
      .getByRole("navigation", { name: "Main navigation" })
      .boundingBox();
    await page.locator(".main-scroll").evaluate((el) => el.scrollTo(0, 900));
    await expect
      .poll(() => page.locator(".main-scroll").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(700);
    expect((await page.locator(".topbar").boundingBox()).y).toBeCloseTo(
      top.y,
      0,
    );
    expect(
      (
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .boundingBox()
      ).y,
    ).toBeCloseTo(bottom.y, 0);
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your preferences" }),
  ).toBeInViewport();
});

test("test4 desktop header also stays fixed without covering dialogs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const top = await page.locator(".topbar").boundingBox();
  await page.locator(".main-scroll").evaluate((el) => el.scrollTo(0, 1000));
  await expect
    .poll(() => page.locator(".main-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(300);
  expect((await page.locator(".topbar").boundingBox()).y).toBeCloseTo(top.y, 0);
  await page.locator(".mini-info").click();
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close player" }),
  ).toBeFocused();
  expect(await page.locator("main").evaluate((el) => el.inert)).toBe(true);
});

test("test4 simulated app return opens the current song without restarting playback", async ({
  page,
}) => {
  let streamResolutions = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/songs/track0")) streamResolutions++;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await expect
    .poll(async () =>
      parseFloat(
        await page.locator(".mini-progress").evaluate((el) => el.style.width),
      ),
    )
    .toBeGreaterThan(5);
  const before = await page
    .locator(".mini-progress")
    .evaluate((el) => parseFloat(el.style.width));
  await simulateVisibility(page, true);
  await page.waitForTimeout(1500);
  await simulateVisibility(page, false);
  const player = page.getByRole("dialog", { name: "Now playing" });
  await expect(player).toBeVisible();
  await expect(player.locator(".player-title")).toContainText("Test Song 0");
  await expect(player.locator(".big-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await expect
    .poll(async () =>
      parseFloat(
        await page.locator(".mini-progress").evaluate((el) => el.style.width),
      ),
    )
    .toBeGreaterThan(before);
  expect(streamResolutions).toBe(1);
  await page.getByRole("button", { name: "Close player" }).click();
  await simulateVisibility(page, false);
  await page.waitForTimeout(250);
  await expect(player).not.toBeVisible();
});

test("test4 paused return opens the player without auto-playing or resetting position", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await expect
    .poll(
      async () => +(await page.locator(".mini-timeline input").inputValue()),
    )
    .toBeGreaterThan(0.5);
  await page.locator(".mini-play").click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Play",
  );
  const pausedPosition = +(await page
    .locator(".mini-timeline input")
    .inputValue());
  await simulateVisibility(page, true);
  await simulateVisibility(page, false);
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
  await expect(page.locator(".big-play")).toHaveAttribute("aria-label", "Play");
  expect(
    Math.abs(
      +(await page
        .getByRole("slider", { name: "Playback position" })
        .inputValue()) - pausedPosition,
    ),
  ).toBeLessThan(0.3);
  await page.getByRole("button", { name: "Close player" }).click();
  await page.waitForTimeout(250);
  await expect(
    page.getByRole("dialog", { name: "Now playing" }),
  ).not.toBeVisible();
});

test("test4 empty app return does not force open an empty player or the next chosen song", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(6);
  await simulateVisibility(page, true);
  await simulateVisibility(page, false);
  await expect(
    page.getByRole("dialog", { name: "Now playing" }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await expect(
    page.getByRole("dialog", { name: "Now playing" }),
  ).not.toBeVisible();
});

test("test4 cold reopen restores current track in the player, still paused", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 1", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await page.locator(".mini-play").click();
  await expect
    .poll(async () => (await readStored(page))?.session?.index)
    .toBe(1);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
  await expect(page.locator(".player-title")).toContainText("Test Song 1");
  await expect(page.locator(".big-play")).toHaveAttribute("aria-label", "Play");
});

test("test4 app return preserves an unfinished playlist dialog", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play Test Song 0", exact: true })
    .click();
  await expect(page.locator(".mini-play")).toHaveAttribute(
    "aria-label",
    "Pause",
  );
  await navigate(page, "Library");
  await page.getByRole("button", { name: "New playlist", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New playlist name" })
    .fill("Keep my draft");
  await simulateVisibility(page, true);
  await simulateVisibility(page, false);
  await expect(
    page.getByRole("textbox", { name: "New playlist name" }),
  ).toHaveValue("Keep my draft");
  await expect(
    page.getByRole("dialog", { name: "Now playing" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("dialog", { name: "Now playing" }),
  ).not.toBeVisible();
});

test("test7 audio source setting offers all three services and persists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const source = page.getByLabel("Audio source", { exact: false });
  await expect(source).toHaveValue("auto");
  await expect(source.locator("option")).toHaveCount(3);
  await source.selectOption("youtube");
  await expect
    .poll(async () => (await readStored(page))?.settings.audioSource)
    .toBe("youtube");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Audio source", { exact: false })).toHaveValue(
    "youtube",
  );
});
