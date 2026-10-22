# 0006 — Long-form YouTube plays in YouTube's player, not ours

Status: **accepted**. Built and tested; the embed itself is **unverified in a
browser** (no browser in the build environment).

## The question

Every other decision in this repo is about getting a *track* to play: mint a
URL on the device, gate it on a head-and-tail range probe, hand it to one of two
`<audio>` decks. Does that path make sense for a one-hour mix?

No, and the reasons are independent of each other:

* **Size.** At ~160 kbps an hour is ~70 MB; a three-hour DJ set is ~210 MB. The
  player would pull all of it through a media element built for a four-minute
  song, and every byte is fetched from `googlevideo` with the listener's own
  connection.
* **Binding.** A minted URL is one signed file with an `expire`, an `ip`, and
  increasingly a PO token. The longer a single URL has to stay valid, the more
  likely it is to be re-minted mid-listen — and re-mints are the one thing the
  gate refuses to loop.
* **Nothing to gain.** There is no crossfade, no visualiser and no offline
  story for a three-hour item either. The things our player adds are all
  track-shaped.

## The decision

Anything from **`LONG_FORM_SEC` (20 minutes)** up is played by YouTube's own
embed instead of being streamed here.

* The threshold and the URL live in `src/lib/ytEmbed.js` as pure functions.
* `playbackPlan(track, { embed: true })` returns `mode: 'embed'` above the
  threshold. It never returns `willMint` for such a track, so no code path can
  quietly fall back to minting.
* `PlayerContext.openLongForm` pauses both decks before opening the embed, so
  two players never make sound at once, and `YouTubeEmbed` renders the iframe.
  Escape or the close button ends it; the local queue is untouched.
* `native` outranks `embed`. A WebView origin is not one YouTube's embed
  accepts, and the app has a real mint, so Android keeps streaming long items
  as audio.

## What this is not

It is not a fallback for a failed mint — a mint failure still produces its typed
sentence and its way out. It is not audio-only: the embed is video, with
YouTube's controls and YouTube's advertising, and the UI says so above and
below the frame. And it is not a way to hear a three-minute track on the web:
the twenty-minute line is what keeps it from becoming one.

## Consequences

* Web gains something real for the part of the YouTube catalogue that used to be
  unreachable in *any* browser: mixes, sets, live sets, full albums.
* Web loses nothing: no mint was possible for those on a plain tab anyway.
* The capability matrix changes its wording — "browse only on the web" is no
  longer the whole truth — and `test/capabilities.spec.js` asserts the new
  sentence, including the threshold and the word "embed".
* No new server surface: no proxy, no relay, no session. ADR 0001 is untouched.
