package dev.viswesh.vibex.audio;

import android.app.*;
import android.content.*;
import android.media.AudioManager;
import android.media.audiofx.Equalizer;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.*;
import java.util.*;
import org.json.*;

/**
 * Android owns playback, focus, session, sleep timer and accounting, independent of the WebView.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class VibeAudioService extends MediaSessionService {
  public static VibeAudioService instance;
  // Only attached by a visible Capacitor activity; playback does not depend on this observer.
  public static Runnable uiObserver;
  private boolean destroyed;
  private long queueRevision = 0, snapshotSerial, retryGeneration;
  private final String queueEpoch = UUID.randomUUID().toString();
  private JSONArray cachedQueue;
  private String lastSaved = "", lastWidget = "";
  private int eqSession = -1;
  private String eqPreset = "";
  private final java.util.concurrent.ExecutorService radioWorker =
      java.util.concurrent.Executors.newSingleThreadExecutor();
  private RadioResolver radioRequest;
  private String radioSeed = "", radioMessage = "";
  private long radioLastAttempt;
  private int radioFailures;
  private final Runnable notifyUi =
      () -> {
        if (!destroyed && uiObserver != null) uiObserver.run();
      };
  private final Runnable sleepTask =
      () -> {
        sleepUntil = 0;
        pause();
        save();
        notifyState();
      };
  public ExoPlayer player;
  private ExoPlayer incoming;
  private MediaSession session;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private VibeStore store;
  private VibeMedia media;
  private AudioManager audio;
  private Equalizer eq, incomingEq;
  private JSONObject prefs = new JSONObject();
  private long fadeStart, fadeLength, sleepUntil, lastSave;
  private String error = "";
  private float duckVolume = 1;
  private boolean resumeAfterFocus = false, hasFocus = false;
  private final RetryBudget retries = new RetryBudget();
  private ListeningLedger ledger;
  private boolean promoting = false;
  private final AudioManager.OnAudioFocusChangeListener focus =
      change -> {
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
          hasFocus = true;
          if (player != null) {
            duckVolume = 1;
            updateVolumes();
            if (resumeAfterFocus) {
              resumeAfterFocus = false;
              player.play();
            }
          }
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
          duckVolume = .2f;
          updateVolumes();
        } else {
          boolean resume =
              change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                  && player != null
                  && player.getPlayWhenReady();
          hasFocus = false;
          pause();
          resumeAfterFocus = resume;
        }
      };
  private final BroadcastReceiver noisy =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
          pause();
        }
      };

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    store = VibeStore.get(this);
    ledger =
        new ListeningLedger(
            (id, sec, play) -> {
              JSONObject song = store.song(id);
              if (song == null) return;
              try {
                JSONObject e = new JSONObject();
                e.put("id", id);
                e.put("name", song.optString("name"));
                e.put("artist", VibeMedia.artist(song));
                e.put("image", VibeMedia.artwork(song));
                e.put("at", System.currentTimeMillis());
                e.put("sec", sec);
                e.put("play", play);
                store.event(e);
              } catch (Exception ignored) {
              }
            });
    media = VibeMedia.get(this);
    prefs = store.settings();
    audio = (AudioManager) getSystemService(AUDIO_SERVICE);
    player = deck();
    session =
        new MediaSession.Builder(this, player)
            .setSessionActivity(
                PendingIntent.getActivity(
                    this,
                    0,
                    dev.viswesh.vibex.MainActivity.playerIntent(this),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .build();
    // Capacitor starts this service directly rather than binding a MediaController.
    // onGetSession() therefore need not run. Explicitly register so Media3 attaches its
    // notification controller and owns foreground promotion / system playback controls.
    addSession(session);
    restore();
    apply(prefs);
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(
          noisy,
          new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
          Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    scheduleTick();
  }

  private ExoPlayer deck() {
    ExoPlayer p =
        new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(media.playback))
            .build();
    p.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),
        false);
    p.setWakeMode(C.WAKE_MODE_LOCAL);
    p.addListener(
        new Player.Listener() {
          @Override
          public void onPlayWhenReadyChanged(boolean ready, int reason) {
            if (p == player && ready && !hasFocus) {
              hasFocus =
                  audio.requestAudioFocus(
                          focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                      == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
              if (!hasFocus) {
                p.pause();
                error = "Another app currently owns audio focus.";
              }
            }
            if (p == player
                && ready
                && hasFocus
                && p.getPlaybackState() == Player.STATE_IDLE
                && p.getMediaItemCount() > 0) p.prepare();
            if (p == player && !ready) {
              cancelRadio();
              save();
            }
            if (p == player && !ready && incoming != null) cancelFade();
            if (p == player && !ready && ledger != null)
              ledger.sample(
                  p.getCurrentMediaItem() == null ? "" : p.getCurrentMediaItem().mediaId,
                  false,
                  SystemClock.elapsedRealtime());
          }

          @Override
          public void onMediaItemTransition(MediaItem item, int reason) {
            if (p == player && !promoting) {
              if (incoming != null && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                promote();
                return;
              }
              cancelFade();
              ledger.reset();
              retries.track(item == null ? "" : item.mediaId);
              retryGeneration++;
              configureWakeMode(p);
              error = "";
              save();
            }
          }

          @Override
          public void onPositionDiscontinuity(
              Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
            if (p == player
                && !promoting
                && (reason == Player.DISCONTINUITY_REASON_SEEK
                    || reason == Player.DISCONTINUITY_REASON_REMOVE)) cancelFade();
          }

          @Override
          public void onPlayerError(PlaybackException e) {
            if (p != player) {
              if (p == incoming) cancelFade();
              return;
            }
            error = "Playback failed. Check connection or reselect the local file.";
            boolean retry = p.getPlayWhenReady();
            final long attempt = ++retryGeneration;
            final String failedId =
                p.getCurrentMediaItem() == null ? "" : p.getCurrentMediaItem().mediaId;
            if (p.getCurrentMediaItem() != null) media.invalidate(p.getCurrentMediaItem().mediaId);
            if (retry && retries.failure()) {
              handler.postDelayed(
                  () -> {
                    if (!destroyed
                        && attempt == retryGeneration
                        && player == p
                        && p.getPlayWhenReady()
                        && p.getCurrentMediaItem() != null
                        && failedId.equals(p.getCurrentMediaItem().mediaId)) {
                      p.prepare();
                    }
                  },
                  1500);
            } else p.pause();
          }

          @Override
          public void onEvents(Player ignored, Player.Events events) {
            if (p != player || promoting || destroyed) return;
            if (events.contains(Player.EVENT_TIMELINE_CHANGED)) {
              queueRevision++;
              cachedQueue = null;
              save();
            }
            if (events.contains(Player.EVENT_IS_PLAYING_CHANGED)) {
              retries.playing(p.isPlaying(), SystemClock.elapsedRealtime());
              ledger.sample(
                  p.getCurrentMediaItem() == null ? "" : p.getCurrentMediaItem().mediaId,
                  p.isPlaying() && prefs.optBoolean("stats", true),
                  SystemClock.elapsedRealtime());
            }
            if (!p.isPlaying()) {
              retries.playing(false, SystemClock.elapsedRealtime());
              ledger.sample(
                  p.getCurrentMediaItem() == null ? "" : p.getCurrentMediaItem().mediaId,
                  false,
                  SystemClock.elapsedRealtime());
              save();
            }
            scheduleTick();
            notifyState();
          }

          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY && p == player) {
              attachEq();
            }
          }
        });
    return p;
  }

  private void notifyState() {
    if (destroyed || player == null) return;
    String widget =
        (player.getCurrentMediaItem() == null ? "" : player.getCurrentMediaItem().mediaId)
            + "|"
            + player.isPlaying();
    if (!widget.equals(lastWidget)) {
      lastWidget = widget;
      VibeWidget.updateAll(this);
    }
    handler.removeCallbacks(notifyUi);
    handler.post(notifyUi);
  }

  private long untilFade() {
    if (prefs.optBoolean("batterySaver")
        || prefs.optDouble("crossfade", 3) <= 0
        || player.getRepeatMode() == Player.REPEAT_MODE_ONE
        || player.getNextMediaItemIndex() == C.INDEX_UNSET
        || player.getNextMediaItemIndex() == player.getCurrentMediaItemIndex()) return -1;
    long duration = player.getDuration(), length = (long) (prefs.optDouble("crossfade", 3) * 1000);
    if (duration == C.TIME_UNSET || duration < 2 * length) return -1;
    return Math.max(0, duration - player.getCurrentPosition() - length);
  }

  private void scheduleTick() {
    handler.removeCallbacks(tick);
    if (destroyed || player == null) return;
    long delay =
        PowerPolicy.nextTick(
            player.isPlaying(), incoming != null, prefs.optBoolean("stats", true), untilFade());
    if (delay >= 0) handler.postDelayed(tick, delay);
  }

  private final Runnable tick =
      new Runnable() {
        public void run() {
          if (destroyed || player == null) return;
          long now = SystemClock.elapsedRealtime();
          ledger.sample(
              player.getCurrentMediaItem() == null ? "" : player.getCurrentMediaItem().mediaId,
              player.isPlaying() && prefs.optBoolean("stats", true),
              now);
          if (player.isPlaying()) {
            retries.playing(true, now);
            if (!prefs.optBoolean("batterySaver")) fade(now);
            maybeRefill();
            if (now - lastSave >= PowerPolicy.checkpointMs(prefs.optBoolean("batterySaver")))
              save();
          }
          scheduleTick();
        }
      };

  private void configureWakeMode(ExoPlayer p) {
    MediaItem item = p.getCurrentMediaItem();
    boolean local =
        item == null
            || item.localConfiguration == null
            || !"vibex".equals(item.localConfiguration.uri.getScheme());
    if (!local && item != null) {
      try {
        androidx.media3.exoplayer.offline.Download d =
            media.manager.getDownloadIndex().getDownload(item.mediaId);
        local = d != null && d.state == androidx.media3.exoplayer.offline.Download.STATE_COMPLETED;
      } catch (java.io.IOException ignored) {
      }
    }
    p.setWakeMode(local ? C.WAKE_MODE_LOCAL : C.WAKE_MODE_NETWORK);
  }

  private boolean canRefill() {
    MediaItem current = player.getCurrentMediaItem();
    boolean local =
        current == null
            || current.localConfiguration == null
            || !"vibex".equals(current.localConfiguration.uri.getScheme());
    return PowerPolicy.allowRefill(
        prefs.optBoolean("autoplay"),
        prefs.optBoolean("batterySaver"),
        player.isPlaying(),
        player.getShuffleModeEnabled(),
        player.getRepeatMode() != Player.REPEAT_MODE_OFF,
        sleepUntil > 0,
        local,
        player.getMediaItemCount(),
        player.getCurrentMediaItemIndex());
  }

  public void cancelRadio() {
    if (radioRequest != null) radioRequest.cancel();
    radioRequest = null;
  }

  private String radioQueueIdentity() {
    JSONArray ids = new JSONArray();
    ids.put(player.getCurrentMediaItem() == null ? "" : player.getCurrentMediaItem().mediaId);
    for (int i = 0; i < player.getMediaItemCount(); i++) ids.put(player.getMediaItemAt(i).mediaId);
    return ids.toString();
  }

  private void maybeRefill() {
    if (!canRefill() || radioRequest != null || radioFailures >= 2) return;
    String id = player.getCurrentMediaItem().mediaId;
    long now = SystemClock.elapsedRealtime();
    if (id.equals(radioSeed) || (radioLastAttempt > 0 && now - radioLastAttempt < 30000)) return;
    JSONObject seed = store.song(id);
    if (seed == null) return;
    radioSeed = id;
    radioLastAttempt = now;
    String artist = VibeMedia.artist(seed).split(",")[0];
    String token = radioQueueIdentity();
    Set<String> excluded = new HashSet<>();
    for (int i = 0; i < player.getMediaItemCount(); i++)
      excluded.add(player.getMediaItemAt(i).mediaId);
    RadioResolver request = new RadioResolver();
    radioRequest = request;
    radioMessage = "Finding related songs…";
    notifyState();
    radioWorker.execute(
        () -> {
          JSONArray found;
          try {
            found = request.find(artist, excluded);
          } catch (Exception e) {
            found = new JSONArray();
          }
          final JSONArray result = found;
          handler.post(
              () -> {
                if (destroyed || radioRequest != request) return;
                radioRequest = null;
                if (!token.equals(radioQueueIdentity()) || !canRefill()) {
                  radioMessage = "";
                  notifyState();
                  return;
                }
                int count = 0;
                for (int i = 0; i < result.length() && player.getMediaItemCount() < 200; i++) {
                  JSONObject song = result.optJSONObject(i);
                  if (song != null && excluded.add(song.optString("id"))) {
                    player.addMediaItem(media.item(song));
                    count++;
                  }
                }
                if (count == 0) radioFailures++;
                else radioFailures = 0;
                radioMessage =
                    count > 0
                        ? "Autoplay added " + count + " related tracks"
                        : radioFailures >= 2
                            ? "Autoplay stopped after two empty or failed lookups"
                            : "No new related tracks found";
                queueRevision++;
                cachedQueue = null;
                save();
                notifyState();
              });
        });
  }

  private void fade(long now) {
    long duration = player.getDuration();
    long length = (long) (prefs.optDouble("crossfade", 3) * 1000);
    int next = player.getNextMediaItemIndex();
    if (incoming == null) {
      if (length <= 0
          || duration == C.TIME_UNSET
          || player.getRepeatMode() == Player.REPEAT_MODE_ONE
          || next == C.INDEX_UNSET
          || next == player.getCurrentMediaItemIndex()
          || duration - player.getCurrentPosition() > length
          || duration < 2 * length) return;
      incoming = deck();
      List<MediaItem> list = new ArrayList<>();
      for (int i = 0; i < player.getMediaItemCount(); i++) list.add(player.getMediaItemAt(i));
      incoming.setMediaItems(list, next, 0);
      incoming.setRepeatMode(player.getRepeatMode());
      incoming.setShuffleModeEnabled(player.getShuffleModeEnabled());
      incoming.setVolume(0);
      configureWakeMode(incoming);
      incoming.prepare();
      fadeStart = 0;
      fadeLength = length;
    }
    if (incoming.getPlaybackState() != Player.STATE_READY) return;
    if (fadeStart == 0) {
      fadeStart = now;
      incoming.play();
      incomingEq = equalizer(incoming);
    }
    double t = Math.min(1, (double) (now - fadeStart) / Math.max(1, fadeLength));
    player.setVolume(duckVolume * (float) Math.cos(t * Math.PI / 2));
    incoming.setVolume(duckVolume * (float) Math.sin(t * Math.PI / 2));
    if (t >= 1 || player.getPlaybackState() == Player.STATE_ENDED) {
      promote();
    }
  }

  private void updateVolumes() {
    if (player == null) return;
    if (incoming != null && fadeStart > 0) {
      double t =
          Math.min(
              1, (double) (SystemClock.elapsedRealtime() - fadeStart) / Math.max(1, fadeLength));
      player.setVolume(duckVolume * (float) Math.cos(t * Math.PI / 2));
      incoming.setVolume(duckVolume * (float) Math.sin(t * Math.PI / 2));
    } else player.setVolume(duckVolume);
  }

  private void promote() {
    if (incoming == null) return;
    boolean shouldPlay = player.getPlayWhenReady();
    promoting = true;
    ledger.reset();
    ExoPlayer old = player;
    player = incoming;
    incoming = null;
    session.setPlayer(player);
    old.release();
    if (eq != null) eq.release();
    eq = incomingEq;
    incomingEq = null;
    eqSession = player.getAudioSessionId();
    eqPreset = prefs.optString("eq", "Flat");
    player.setVolume(duckVolume);
    if (shouldPlay) player.play();
    promoting = false;
    queueRevision++;
    cachedQueue = null;
    retries.track(player.getCurrentMediaItem() == null ? "" : player.getCurrentMediaItem().mediaId);
    retryGeneration++;
    attachEq();
    save();
    notifyState();
    scheduleTick();
  }

  private Equalizer equalizer(ExoPlayer p) {
    if (prefs.optString("eq", "Flat").equals("Flat")) return null;
    try {
      Equalizer e = new Equalizer(0, p.getAudioSessionId());
      short n = e.getNumberOfBands();
      String preset = prefs.optString("eq", "Flat");
      short[] range = e.getBandLevelRange();
      for (short i = 0; i < n; i++) {
        float x = n < 2 ? .5f : (float) i / (n - 1);
        int db =
            switch (preset) {
              case "Bass boost" -> x < .4 ? 5 : 0;
              case "Vocal" -> x > .25 && x < .8 ? 4 : -1;
              case "Bright" -> x > .6 ? 4 : 0;
              default -> 0;
            };
        e.setBandLevel(i, (short) Math.max(range[0], Math.min(range[1], db * 100)));
      }
      e.setEnabled(!preset.equals("Flat"));
      return e;
    } catch (Exception e) {
      return null;
    }
  }

  private void attachEq() {
    String preset = prefs.optString("eq", "Flat");
    int id = player.getAudioSessionId();
    if (eqSession == id && eqPreset.equals(preset)) return;
    if (eq != null) eq.release();
    eq = equalizer(player);
    eqSession = id;
    eqPreset = preset;
  }

  public void apply(JSONObject settings) {
    JSONObject old = prefs;
    prefs = settings;
    player.setShuffleModeEnabled(prefs.optBoolean("shuffle", false));
    player.setRepeatMode(
        switch (prefs.optString("repeat", "off")) {
          case "one" -> Player.REPEAT_MODE_ONE;
          case "all" -> Player.REPEAT_MODE_ALL;
          default -> Player.REPEAT_MODE_OFF;
        });
    if (incoming != null
        && (prefs.optBoolean("batterySaver")
            || old.optDouble("crossfade", 3) != prefs.optDouble("crossfade", 3)
            || !old.optString("eq", "Flat").equals(prefs.optString("eq", "Flat"))
            || old.optBoolean("shuffle") != prefs.optBoolean("shuffle")
            || !old.optString("repeat", "off").equals(prefs.optString("repeat", "off"))))
      cancelFade();
    if (!canRefill()) {
      cancelRadio();
      radioMessage = "";
    }
    if (!prefs.optBoolean("stats", true)) ledger.sample("", false, SystemClock.elapsedRealtime());
    attachEq();
    media.configure(prefs);
    scheduleTick();
    notifyState();
  }

  public void cancelFade() {
    if (incoming != null) {
      incoming.release();
      incoming = null;
    }
    if (incomingEq != null) {
      incomingEq.release();
      incomingEq = null;
    }
    if (player != null) player.setVolume(duckVolume);
  }

  public void resetAccounting() {
    ledger.reset();
  }

  public void recordSkip() {
    if (!prefs.optBoolean("stats", true)
        || !player.isPlaying()
        || player.getCurrentPosition() >= 30000
        || player.getCurrentMediaItem() == null) return;
    try {
      String id = player.getCurrentMediaItem().mediaId;
      JSONObject song = store.song(id);
      if (song == null) return;
      store.event(
          new JSONObject()
              .put("id", id)
              .put("name", song.optString("name"))
              .put("artist", VibeMedia.artist(song))
              .put("at", System.currentTimeMillis())
              .put("sec", 0)
              .put("skip", true)
              .put("play", false));
    } catch (JSONException ignored) {
    }
  }

  public void pause() {
    retryGeneration++;
    cancelRadio();
    radioMessage = "";
    resumeAfterFocus = false;
    cancelFade();
    if (player != null) {
      player.pause();
      if (ledger != null)
        ledger.sample(
            player.getCurrentMediaItem() == null ? "" : player.getCurrentMediaItem().mediaId,
            false,
            SystemClock.elapsedRealtime());
    }
  }

  public void queue(JSONArray songs, int index, long position, boolean play) {
    cancelRadio();
    radioSeed = "";
    radioFailures = 0;
    radioMessage = "";
    queueRevision++;
    cachedQueue = null;
    resumeAfterFocus = false;
    ledger.reset();
    cancelFade();
    player.pause();
    retries.reset();
    retryGeneration++;
    List<MediaItem> items = new ArrayList<>();
    for (int i = 0; i < songs.length(); i++) {
      JSONObject s = songs.optJSONObject(i);
      if (s != null) items.add(media.item(s));
    }
    if (items.isEmpty()) {
      player.clearMediaItems();
      save();
      return;
    }
    player.setMediaItems(
        items, Math.max(0, Math.min(index, items.size() - 1)), Math.max(0, position));
    // Restoring a paused queue must not open a stream or start network buffering.
    if (play) {
      player.prepare();
      player.play();
    }
    save();
  }

  public void sleep(long minutes) {
    handler.removeCallbacks(sleepTask);
    sleepUntil = minutes <= 0 ? 0 : System.currentTimeMillis() + minutes * 60000;
    if (sleepUntil > 0) {
      cancelRadio();
      handler.postDelayed(sleepTask, minutes * 60000);
    }
    notifyState();
  }

  private void restore() {
    try {
      String raw = store.read("native-session");
      if (raw == null) return;
      JSONObject s = new JSONObject(raw);
      JSONArray ids = s.getJSONArray("ids"), songs = new JSONArray();
      for (int i = 0; i < ids.length(); i++) {
        JSONObject song = store.song(ids.getString(i));
        if (song != null) songs.put(song);
      }
      if (songs.length() > 0) queue(songs, s.optInt("index"), s.optLong("position"), false);
    } catch (Exception ignored) {
    }
  }

  public void save() {
    if (player == null) return;
    try {
      JSONObject s = new JSONObject();
      JSONArray ids = new JSONArray();
      for (int i = 0; i < player.getMediaItemCount(); i++)
        ids.put(player.getMediaItemAt(i).mediaId);
      s.put("ids", ids);
      s.put("index", player.getCurrentMediaItemIndex());
      s.put("position", player.getCurrentPosition());
      String value = s.toString();
      if (!value.equals(lastSaved)) {
        store.write("native-session", value);
        lastSaved = value;
      }
      lastSave = SystemClock.elapsedRealtime();
    } catch (Exception ignored) {
    }
  }

  public void queueChanged() {
    queueRevision++;
    cachedQueue = null;
  }

  private String queueToken() {
    return queueEpoch + ":" + queueRevision;
  }

  public JSONObject snapshot() {
    return snapshot("");
  }

  public JSONObject snapshot(String knownQueue) {
    JSONObject o = new JSONObject();
    try {
      if (!queueToken().equals(knownQueue)) {
        if (cachedQueue == null) {
          cachedQueue = new JSONArray();
          for (int i = 0; i < player.getMediaItemCount(); i++) {
            JSONObject s = store.song(player.getMediaItemAt(i).mediaId);
            if (s != null) cachedQueue.put(s);
          }
        }
        o.put("queue", cachedQueue);
      }
      o.put("queueToken", queueToken());
      o.put("epoch", queueEpoch);
      o.put("snapshotSerial", ++snapshotSerial);
      o.put("autoplayMessage", radioMessage);
      o.put("index", Math.max(0, player.getCurrentMediaItemIndex()));
      o.put("position", player.getCurrentPosition() / 1000.0);
      long duration = player.getDuration();
      if (duration == C.TIME_UNSET && player.getCurrentMediaItem() != null) {
        JSONObject current = store.song(player.getCurrentMediaItem().mediaId);
        if (current != null) duration = (long) (current.optDouble("duration", 0) * 1000);
      }
      o.put("duration", Math.max(0, duration / 1000.0));
      o.put("playing", player.isPlaying());
      o.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
      o.put("error", error);
      o.put("sleepUntil", sleepUntil);
      o.put("eqAvailable", eq != null);
    } catch (Exception ignored) {
    }
    return o;
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo info) {
    return session;
  }

  @Override
  public void onTaskRemoved(Intent intent) {
    if (!PlaybackLifecycle.keepOnTaskRemoved(
        prefs.optBoolean("stopOnDismiss", false),
        player.getMediaItemCount() > 0,
        player.getPlayWhenReady(),
        player.getPlaybackState() == Player.STATE_ENDED,
        resumeAfterFocus)) {
      pause();
      save();
      stopSelf();
    }
  }

  @Override
  public void onDestroy() {
    destroyed = true;
    cancelRadio();
    radioWorker.shutdownNow();
    ledger.flush();
    save();
    handler.removeCallbacksAndMessages(null);
    cancelFade();
    if (eq != null) eq.release();
    session.release();
    player.release();
    audio.abandonAudioFocus(focus);
    unregisterReceiver(noisy);
    instance = null;
    super.onDestroy();
  }
}
