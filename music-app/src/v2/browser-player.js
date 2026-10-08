import { watchBrowserReturns } from "./player-return.js";
import { api } from "../lib/api.js";
import { streamOf, artistsOf, imgOf } from "../lib/song.js";
import {
  nextIndex,
  moveQueue,
  removeQueue,
  shouldRefill,
  uniqueSongs,
} from "./core.js";

/** Web adapter only. Android never constructs these audio decks. */
export class BrowserPlayer {
  constructor(onState, onEvent, session = {}) {
    this.onState = onState;
    this.onEvent = onEvent;
    this.queue = session.queue || [];
    this.index = session.index || 0;
    this.position = session.position || 0;
    this.settings = {};
    this.returnCount = 0;
    this.returnToPlayer = "web-launch";
    this.deck = new Audio();
    this.deck.preload = "none";
    this.secondary = new Audio();
    this.secondary.preload = "none";
    this.decks = [this.deck, this.secondary];
    this.token = 0;
    this.counted = false;
    this.listened = 0;
    this.error = "";
    this.last = performance.now();
    this.fade = null;
    this.sleepUntil = 0;
    this.refillFailures = 0;
    this.refillSeed = "";
    this.refillAt = -Infinity;
    this.autoplayMessage = "";
    for (const el of this.decks) {
      el.crossOrigin = "anonymous";
      el.addEventListener("ended", () => {
        if (el === this.deck && !this.fade) this.next(true);
      });
      el.addEventListener("error", () => {
        if (el === this.deck) {
          this.error =
            "Playback unavailable. Check your connection or choose the local file again.";
          this.emit();
        }
      });
      for (const event of ["play", "pause", "waiting", "playing", "seeked"])
        el.addEventListener(event, () => {
          if (this.destroyed) return;
          this.last = performance.now();
          this.emit();
          this.scheduleTick();
          if (this.deck.paused && !this.fade) this.audioContext?.suspend();
        });
    }
    this.stopReturnWatch = watchBrowserReturns(() => {
      this.returnToPlayer = `web-return-${++this.returnCount}`;
      this.emit();
    });
    this.onVisibility = () => this.emit();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.emit();
  }
  configure(s) {
    const before = this.settings;
    this.settings = { ...s, crossfade: s.batterySaver ? 0 : s.crossfade };
    if (before.crossfade !== this.settings.crossfade) this.cancelFade();
    if (s.batterySaver || !s.autoplay) {
      this.refillController?.abort();
      this.autoplayMessage = "";
    }
    if (s.eq !== "Flat" && !this.deck.paused) this.graph();
    this.setEq(s.eq);
    this.scheduleTick();
    this.emit();
  }
  setEq(preset) {
    if (!this.audioContext || this.eqPreset === preset) return;
    this.eqPreset = preset;
    for (const [i, filters] of (this.filters || []).entries()) {
      const source = this.sources[i];
      source.disconnect();
      filters.forEach((filter) => filter.disconnect());
      let node = source;
      if (preset !== "Flat")
        for (const filter of filters) {
          node.connect(filter);
          node = filter;
        }
      node.connect(this.audioContext.destination);
      const shape = {
        "Bass boost": [5, 3, 0, 0, 0],
        Vocal: [-1, 1, 4, 3, -1],
        Bright: [0, 0, 1, 3, 4],
        Flat: [0, 0, 0, 0, 0],
      }[preset] || [0, 0, 0, 0, 0];
      filters.forEach((f, i) =>
        f.gain.setTargetAtTime(shape[i], this.audioContext.currentTime, 0.1),
      );
    }
  }
  graph() {
    if (
      !this.audioContext &&
      (!this.settings.eq || this.settings.eq === "Flat")
    )
      return;
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
        this.sources = [];
        this.filters = this.decks.map((el) => {
          let node = this.audioContext.createMediaElementSource(el);
          this.sources.push(node);
          const fs = [60, 230, 910, 3600, 14000].map((f) => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = "peaking";
            filter.frequency.value = f;
            filter.Q.value = 1;
            node.connect(filter);
            node = filter;
            return filter;
          });
          node.connect(this.audioContext.destination);
          return fs;
        });
      }
      this.audioContext.resume();
      this.setEq(this.settings.eq);
    } catch {
      /* EQ may not be supported by the browser. */
    }
  }
  snapshot() {
    const deck = this.fade?.next || this.deck;
    return {
      queue: this.queue,
      index: this.index,
      position: deck.src ? deck.currentTime : this.position,
      duration: Number.isFinite(deck.duration)
        ? deck.duration
        : this.queue[this.index]?.duration || 0,
      playing: !deck.paused,
      buffering: deck.src && !deck.paused && deck.readyState < 3,
      error: this.error,
      sleepUntil: this.sleepUntil,
      eqAvailable: !!window.AudioContext,
      autoplayMessage: this.autoplayMessage,
      returnToPlayer: this.returnToPlayer,
    };
  }
  emit() {
    if (!this.destroyed && !document.hidden) this.onState(this.snapshot());
  }
  async url(song) {
    if (song.local) return song.localUri;
    const fresh = await api(`/songs/${encodeURIComponent(song.id)}`);
    const s = Array.isArray(fresh) ? fresh[0] : fresh;
    return streamOf(s, this.settings.quality || "320kbps");
  }
  async load(index, play = true, position = 0, crossfade = 0) {
    if (index < 0 || index >= this.queue.length) return;
    this.cancelFade();
    const token = ++this.token;
    this.error = "";
    const song = this.queue[index];
    this.graph();
    try {
      const url = await this.url(song);
      if (token !== this.token) return;
      const el = crossfade ? this.secondary : this.deck;
      if (!crossfade) this.deck.pause();
      el.src = url;
      el.currentTime = position;
      el.volume = crossfade ? 0 : 1;
      this.index = index;
      this.position = position;
      this.counted = false;
      this.listened = 0;
      if (play) await el.play();
      if (token !== this.token) {
        el.pause();
        return;
      }
      if (crossfade)
        this.fade = {
          start: performance.now(),
          duration: crossfade * 1000,
          old: this.deck,
          next: el,
        };
      this.metadata(song);
      this.emit();
    } catch (e) {
      if (token === this.token) {
        this.error = e.message || "Unable to play";
        this.emit();
      }
    }
  }
  metadata(s) {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.name,
        artist: artistsOf(s),
        artwork: imgOf(s) ? [{ src: imgOf(s) }] : [],
      });
      for (const [a, fn] of Object.entries({
        play: () => this.play(),
        pause: () => this.pause(),
        nexttrack: () => this.next(),
        previoustrack: () => this.previous(),
        seekto: (d) => this.seek(d.seekTime),
      }))
        navigator.mediaSession.setActionHandler(a, fn);
    } catch {}
  }
  async setQueue(songs, index = 0, play = true, position = 0) {
    ++this.token;
    this.refillController?.abort();
    this.refillFailures = 0;
    this.refillSeed = "";
    this.autoplayMessage = "";
    this.queue = songs;
    this.index = index;
    this.position = position;
    this.deck.pause();
    if (!songs.length) {
      this.deck.removeAttribute("src");
      this.emit();
      return;
    }
    if (play) return this.load(index, true, position);
    this.emit();
  }
  play() {
    this.graph();
    if (!this.deck.src) return this.load(this.index, true, this.position);
    return this.deck.play().catch((e) => {
      this.error = e.message;
      this.emit();
    });
  }
  pause() {
    this.refillController?.abort();
    this.autoplayMessage = "";
    ++this.token;
    this.cancelFade();
    this.deck.pause();
    this.emit();
  }
  seek(position) {
    this.cancelFade();
    this.deck.currentTime = Math.max(
      0,
      Math.min(position, this.deck.duration || Infinity),
    );
    this.emit();
  }
  recordSkip() {
    const song = this.queue[this.index];
    if (
      !this.settings.stats ||
      !song ||
      this.deck.paused ||
      this.listened >= 30
    )
      return;
    this.onEvent({
      id: song.id,
      name: song.name,
      artist: artistsOf(song),
      image: imgOf(song),
      at: Date.now(),
      sec: 0,
      play: false,
      skip: true,
    });
  }
  next(automatic = false) {
    const next = nextIndex(this.queue.length, this.index, {
      ...this.settings,
      automatic,
    });
    if (next < 0) {
      this.pause();
      return;
    }
    this.load(
      next,
      true,
      0,
      automatic ? 0 : Math.min(this.settings.crossfade || 0, 0.5),
    );
  }
  previous() {
    if (this.deck.currentTime > 3) this.seek(0);
    else this.load(Math.max(0, this.index - 1));
  }
  enqueue(song, next = false) {
    this.queue = [...this.queue];
    this.queue.splice(next ? this.index + 1 : this.queue.length, 0, song);
    this.emit();
  }
  move(from, to) {
    const s = moveQueue(this.queue, this.index, from, to);
    Object.assign(this, s);
    this.emit();
  }
  remove(at) {
    const current = at === this.index,
      s = removeQueue(this.queue, this.index, at);
    Object.assign(this, s);
    if (current) {
      if (this.queue.length) this.load(this.index, !this.deck.paused);
      else {
        this.pause();
        this.deck.removeAttribute("src");
      }
    }
    this.emit();
  }
  clear() {
    this.queue = this.queue[this.index] ? [this.queue[this.index]] : [];
    this.index = 0;
    this.emit();
  }
  cancelFade() {
    if (this.fade) {
      this.fade.old.pause();
      this.deck = this.fade.next;
      this.secondary = this.fade.old;
      this.fade = null;
    }
    this.deck.volume = 1;
  }
  setSleep(minutes) {
    clearTimeout(this.sleepTimer);
    this.sleepUntil = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    if (minutes > 0) {
      this.refillController?.abort();
      this.sleepTimer = setTimeout(() => {
        this.sleepUntil = 0;
        this.pause();
      }, minutes * 60000);
    }
    this.emit();
  }
  scheduleTick() {
    clearTimeout(this.timer);
    if (this.destroyed || (this.deck.paused && !this.fade)) return;
    let delay = this.fade ? 100 : this.settings.batterySaver ? 2000 : 1000;
    if (
      !this.fade &&
      this.settings.crossfade > 0 &&
      this.settings.repeat !== "one"
    ) {
      const until =
        (this.deck.duration - this.deck.currentTime - this.settings.crossfade) *
        1000;
      if (Number.isFinite(until) && until > 0)
        delay = Math.min(delay, Math.max(100, until));
    }
    this.timer = setTimeout(() => this.tick(), delay);
  }
  async refill() {
    const state = this.snapshot();
    if (
      !shouldRefill(state, this.settings) ||
      this.refillController ||
      this.refillFailures >= 2
    )
      return;
    const seed = this.queue[this.index],
      now = performance.now();
    if (seed.id === this.refillSeed || now - this.refillAt < 30000) return;
    this.refillSeed = seed.id;
    this.refillAt = now;
    const token = this.token,
      queue = this.queue;
    const ctl = new AbortController();
    this.refillController = ctl;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, 15000);
    this.autoplayMessage = "Finding related songs…";
    try {
      const artist = artistsOf(seed).split(",")[0];
      const data = await api(
        `/search/songs?query=${encodeURIComponent(artist)}&limit=30`,
        { signal: ctl.signal },
      );
      if (
        ctl.signal.aborted ||
        token !== this.token ||
        queue !== this.queue ||
        !shouldRefill(this.snapshot(), this.settings)
      )
        return;
      const seen = new Set(this.queue.map((s) => s.id));
      const added = uniqueSongs(data.results || [])
        .filter((s) => !seen.has(s.id))
        .slice(0, Math.min(6, 200 - this.queue.length));
      this.queue = [...this.queue, ...added];
      this.refillFailures = added.length ? 0 : this.refillFailures + 1;
      this.autoplayMessage = added.length
        ? `Autoplay added ${added.length} related tracks`
        : "No new related tracks found";
    } catch {
      if (!ctl.signal.aborted || timedOut) this.refillFailures++;
      if (token === this.token)
        this.autoplayMessage =
          !ctl.signal.aborted || timedOut
            ? "Autoplay unavailable. Your existing queue is unchanged."
            : "";
    } finally {
      clearTimeout(timeout);
      if (this.refillController === ctl) this.refillController = null;
      this.emit();
    }
  }
  tick() {
    const now = performance.now(),
      sec = Math.min(2, (now - this.last) / 1000);
    this.last = now;
    if (this.sleepUntil && Date.now() >= this.sleepUntil) {
      this.sleepUntil = 0;
      this.pause();
    }
    if (!this.deck.paused && this.deck.readyState >= 3) {
      const song = this.queue[this.index];
      if (song && this.settings.stats) {
        this.listened += sec;
        const play = !this.counted && this.listened >= 5;
        if (play) this.counted = true;
        this.onEvent({
          id: song.id,
          name: song.name,
          artist: artistsOf(song),
          image: imgOf(song),
          at: Date.now(),
          sec,
          play,
        });
      }
      if (!this.fade && !this.loadingNext && this.settings.repeat !== "one") {
        const remain = this.deck.duration - this.deck.currentTime,
          cf = this.settings.crossfade || 0;
        if (cf > 0 && remain > 0 && remain <= cf && this.queue.length > 1) {
          const n = nextIndex(this.queue.length, this.index, {
            ...this.settings,
            automatic: true,
          });
          if (n >= 0) {
            this.loadingNext = true;
            this.load(n, true, 0, Math.min(remain, cf)).finally(
              () => (this.loadingNext = false),
            );
          }
        }
      }
    }
    if (this.fade) {
      const { old, next, start, duration } = this.fade,
        t = Math.min(1, (now - start) / duration);
      old.volume = Math.cos((t * Math.PI) / 2);
      next.volume = Math.sin((t * Math.PI) / 2);
      if (t === 1) this.cancelFade();
    }
    void this.refill();
    this.emit();
    this.scheduleTick();
  }
  destroy() {
    this.destroyed = true;
    this.stopReturnWatch?.();
    this.refillController?.abort();
    document.removeEventListener("visibilitychange", this.onVisibility);
    clearTimeout(this.timer);
    clearTimeout(this.sleepTimer);
    ++this.token;
    this.decks.forEach((e) => {
      e.pause();
      e.removeAttribute("src");
      e.load();
    });
    this.audioContext?.close();
  }
}
