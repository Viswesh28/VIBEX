# 0007 — YouTube is embed-only, on every client

Status: **accepted**. Built and unit-tested; the embed itself is **unverified in
a browser** (there is no browser in the build environment). Supersedes the
device-mint line of thinking in 0004/0005 and the twenty-minute threshold in
0006; the canvas path (0002) is unrelated and stays as it is.

## The question

0004 gave the Android WebView a mint: open the track's own page on the device,
read the player response, hand one signed URL to an `<audio>` deck. 0005 tried
the same from a browser extension. 0006 carved out long videos because they are
the worst case for that path.

Two things then happened:

1. The mint never became reliable. The player endpoint refuses a foreign
   `Origin` and the CORS preflight with it, so a plain browser can never read
   it; on the device it works only behind a shim that has to be maintained
   against YouTube's own changes, and its preview-only formats mean a URL can
   403 a minute into a track.
2. A track-shaped product does not need it. What the mint bought was *our*
   transport — one deck, crossfade, the visualiser — for a catalogue whose
   playback terms we cannot meet anyway.

## The decision

Every YouTube item is played by **YouTube's own embed**, in the browser and in
the app alike. There is no extraction path in this repository, no server-side
resolve, no proxy, no accounts and no cookies.

* `playbackPlan(track, { embed: true })` returns `mode: 'embed'` with the
  `videoId` for *every* YouTube item. `willMint` no longer exists, so no code
  path can quietly mint.
* `PlayerContext.openEmbed` pauses both decks before opening the iframe, so two
  players never make sound at once, and `YouTubeEmbed` renders it. Escape or the
  close button ends it; the local queue is untouched.
* The device mint is gone: `src/lib/ytStream.js` and its spec are deleted, and
  the re-mint on network change with them (there is nothing to re-mint).
* The twenty-minute rule stays in the plan only as a *reason*, `long_form`,
  because the copy for an hour-long mix is worth keeping distinct. It no longer
  changes behaviour.
* `capabilities.js` and the source banner now say what happens: YouTube's video
  and ads, not our audio-only transport. JioSaavn is still the default and the
  source that plays as audio.

## What this costs, honestly

* No crossfade, no gapless hand-over, no visualiser and no offline story for
  YouTube items — the embed owns its transport.
* Ads and video are part of the experience, because they are part of YouTube's
  player. Saying otherwise would be a lie in a settings screen.
* A WebView origin is not one YouTube's embed accepts, so the Android app may
  show the iframe's own refusal. That is a real limitation, not a hidden
  fallback: the app has no other route to that audio any more.

## What it does not change

JioSaavn playback is untouched: catalogue, signed CDN URLs, two decks,
crossfade, MediaSession, the tagger at `/api/dl`. The canvas lookup in the
full-screen player is untouched and remains `deployment_blocked` (0001).

## Amendment — a YouTube item is a queue item (after the first report that it "does not play")

The first version of this decision treated the embed as a surface you open: it
paused the decks, showed the iframe, and left the queue where it was. Pressing a
YouTube result therefore looked broken — the now-playing bar still named the
previous track, nothing advanced when the video ended, and there was no
transport in the overlay. The complaint was accurate, and about us, not YouTube.

The embed is driven as a player now:

* `openEmbed(song, index)` moves the queue onto the item, so the bar, the queue
  highlight and MediaSession describe what is actually making sound.
* YouTube's `onStateChange` is the source of truth for playing/paused, and
  `ended` advances the queue through the same `advance()` an `<audio>` deck
  uses — including repeat-one, which is answered with a `seekTo` + `playVideo`
  rather than a reload.
* The overlay carries previous/next, closing itself first so the next item owns
  the screen whether it is an embed or a stream.
* A refused video surfaces its reason (101/150 and friends) with a link out.

What it still is not: an `<audio>` element. YouTube audio cannot be extracted in
a browser — the player endpoint refuses a foreign origin and the CDN URLs are
bound to the address that requested them — so there is no version of this where
the embed is not YouTube's player. Everything around it now behaves like a
track.
