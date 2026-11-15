package dev.viswesh.vibex;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground Android Media Playback Service (`foregroundServiceType="mediaPlayback"`).
 *
 * Keeps CPU + Wi-Fi radios awake with the screen locked, paints the native Android
 * Notification Shade & Lock-Screen Media Player with Album Artwork + Scrubber, routes
 * Bluetooth Earbuds / Android Auto / Lock-Screen controls straight to VIBEX WebView,
 * handles phone calls & navigation voice prompts via `AudioFocusRequest`, and pauses
 * playback immediately when wired/Bluetooth headphones disconnect (`ACTION_AUDIO_BECOMING_NOISY`).
 */
public final class PlaybackService extends Service {

    public static final String CHANNEL_ID = "vibex_media_playback";
    public static final int NOTIFICATION_ID = 7401;

    public static final String ACTION_UPDATE_METADATA = "dev.viswesh.vibex.UPDATE_METADATA";
    public static final String ACTION_UPDATE_STATE = "dev.viswesh.vibex.UPDATE_STATE";
    public static final String ACTION_MEDIA_PREV = "dev.viswesh.vibex.MEDIA_PREV";
    public static final String ACTION_MEDIA_TOGGLE = "dev.viswesh.vibex.MEDIA_TOGGLE";
    public static final String ACTION_MEDIA_NEXT = "dev.viswesh.vibex.MEDIA_NEXT";
    public static final String ACTION_MEDIA_STOP = "dev.viswesh.vibex.MEDIA_STOP";

    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean resumeOnFocusGain = false;
    private boolean noisyReceiverRegistered = false;
    private boolean inForeground = false;

    private String title = "VIBEX";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private Bitmap artworkBitmap = null;
    private long durationMs = 0L;
    private long positionMs = 0L;
    private boolean isPlaying = false;

    private final ExecutorService artworkPool = Executors.newSingleThreadExecutor();

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                MainActivity.dispatchMediaAction("pause", -1L, 0L);
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                resumeOnFocusGain = false;
                MainActivity.dispatchMediaAction("pause", -1L, 0L);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                resumeOnFocusGain = isPlaying;
                MainActivity.dispatchMediaAction("pause", -1L, 0L);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                MainActivity.dispatchMediaAction("duck", -1L, 0L);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                MainActivity.dispatchMediaAction("unduck", -1L, 0L);
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false;
                    MainActivity.dispatchMediaAction("play", -1L, 0L);
                }
                break;
            default:
                break;
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        initLocks();
        initAudioFocus();
        initMediaSession();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            switch (action) {
                case ACTION_MEDIA_PREV:
                    MainActivity.dispatchMediaAction("prev", -1L, 0L);
                    break;
                case ACTION_MEDIA_TOGGLE:
                    MainActivity.dispatchMediaAction(isPlaying ? "pause" : "play", -1L, 0L);
                    break;
                case ACTION_MEDIA_NEXT:
                    MainActivity.dispatchMediaAction("next", -1L, 0L);
                    break;
                case ACTION_MEDIA_STOP:
                    isPlaying = false;
                    releaseLocksAndFocus();
                    MainActivity.dispatchMediaAction("pause", -1L, 0L);
                    stopForeground(true);
                    inForeground = false;
                    stopSelf();
                    return START_NOT_STICKY;
                case ACTION_UPDATE_METADATA: {
                    String newTitle = intent.getStringExtra("title");
                    String newArtist = intent.getStringExtra("artist");
                    String newAlbum = intent.getStringExtra("album");
                    String newArt = intent.getStringExtra("artworkUrl");
                    long newDur = intent.getLongExtra("durationMs", 0L);

                    if (newTitle == null || newTitle.isEmpty()) {
                        isPlaying = false;
                        releaseLocksAndFocus();
                        if (inForeground) {
                            stopForeground(true);
                            inForeground = false;
                        }
                        return START_NOT_STICKY;
                    }

                    this.title = newTitle;
                    this.artist = newArtist != null ? newArtist : "";
                    this.album = newAlbum != null ? newAlbum : "";
                    if (newDur > 0L) this.durationMs = newDur;

                    if (newArt != null && !newArt.equals(this.artworkUrl)) {
                        this.artworkUrl = newArt;
                        fetchArtworkAsync(newArt);
                    }
                    pushMetadataAndNotification();
                    break;
                }
                case ACTION_UPDATE_STATE: {
                    boolean nextPlaying = intent.getBooleanExtra("isPlaying", false);
                    long pos = intent.getLongExtra("positionMs", 0L);
                    long dur = intent.getLongExtra("durationMs", 0L);
                    this.isPlaying = nextPlaying;
                    this.positionMs = Math.max(0L, pos);
                    if (dur > 0L) this.durationMs = dur;

                    if (nextPlaying) {
                        acquireLocksAndFocus();
                    } else {
                        releaseWakeLocksOnly();
                    }
                    pushPlaybackState();
                    pushNotificationOnly();
                    break;
                }
                default:
                    break;
            }
        }
        return START_STICKY;
    }

    private void ensureChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "VIBEX Music Playback",
                NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Lock-screen controls and background streaming status");
        ch.setShowBadge(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    @SuppressWarnings("deprecation")
    private void initLocks() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vibex:PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "vibex:PlaybackWifiLock");
            wifiLock.setReferenceCounted(false);
        }
    }

    private void initAudioFocus() {
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener)
                .build();
    }

    private void initMediaSession() {
        mediaSession = new MediaSession(this, "VIBEXMediaSession");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                MainActivity.dispatchMediaAction("play", -1L, 0L);
            }

            @Override
            public void onPause() {
                MainActivity.dispatchMediaAction("pause", -1L, 0L);
            }

            @Override
            public void onSkipToNext() {
                MainActivity.dispatchMediaAction("next", -1L, 0L);
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.dispatchMediaAction("prev", -1L, 0L);
            }

            @Override
            public void onSeekTo(long pos) {
                positionMs = Math.max(0L, pos);
                pushPlaybackState();
                MainActivity.dispatchMediaAction("seekto", positionMs, 0L);
            }

            @Override
            public void onStop() {
                MainActivity.dispatchMediaAction("pause", -1L, 0L);
            }
        });
        mediaSession.setActive(true);
    }

    private void acquireLocksAndFocus() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        } catch (Throwable ignored) {
        }
        try {
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Throwable ignored) {
        }
        try {
            if (audioManager != null && focusRequest != null) {
                audioManager.requestAudioFocus(focusRequest);
            }
        } catch (Throwable ignored) {
        }
        if (!noisyReceiverRegistered) {
            try {
                IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(noisyReceiver, f, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(noisyReceiver, f);
                }
                noisyReceiverRegistered = true;
            } catch (Throwable ignored) {
            }
        }
    }

    private void releaseWakeLocksOnly() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {
        }
    }

    private void releaseLocksAndFocus() {
        releaseWakeLocksOnly();
        try {
            if (audioManager != null && focusRequest != null) {
                audioManager.abandonAudioFocusRequest(focusRequest);
            }
        } catch (Throwable ignored) {
        }
        if (noisyReceiverRegistered) {
            try {
                unregisterReceiver(noisyReceiver);
            } catch (Throwable ignored) {
            }
            noisyReceiverRegistered = false;
        }
    }

    private void fetchArtworkAsync(final String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) {
            artworkBitmap = null;
            return;
        }
        artworkPool.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("User-Agent", "VIBEX-Android/3.2.0");
                if (conn.getResponseCode() == 200) {
                    try (InputStream in = conn.getInputStream()) {
                        Bitmap decoded = BitmapFactory.decodeStream(in);
                        if (decoded != null && urlStr.equals(artworkUrl)) {
                            artworkBitmap = decoded;
                            pushMetadataAndNotification();
                        }
                    }
                }
            } catch (Throwable ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void pushPlaybackState() {
        if (mediaSession == null) return;
        long actions = PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_STOP;

        int stateCode = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        float speed = isPlaying ? 1.0f : 0.0f;

        PlaybackState ps = new PlaybackState.Builder()
                .setActions(actions)
                .setState(stateCode, positionMs, speed)
                .build();
        mediaSession.setPlaybackState(ps);
    }

    private void pushMetadataAndNotification() {
        if (mediaSession != null) {
            MediaMetadata.Builder mb = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
            if (durationMs > 0L) {
                mb.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
            }
            if (artworkBitmap != null) {
                mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artworkBitmap);
                mb.putBitmap(MediaMetadata.METADATA_KEY_ART, artworkBitmap);
            }
            mediaSession.setMetadata(mb.build());
        }
        pushPlaybackState();
        pushNotificationOnly();
    }

    private void pushNotificationOnly() {
        try {
            Notification notification = buildNotification();
            if (isPlaying && !inForeground) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                            NOTIFICATION_ID,
                            notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                inForeground = true;
            } else {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.notify(NOTIFICATION_ID, notification);
            }
        } catch (Throwable ignored) {
        }
    }

    private Notification buildNotification() {
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(this, 100, openIntent, piFlags);

        PendingIntent prevPi = serviceActionPi(ACTION_MEDIA_PREV, 101, piFlags);
        PendingIntent togglePi = serviceActionPi(ACTION_MEDIA_TOGGLE, 102, piFlags);
        PendingIntent nextPi = serviceActionPi(ACTION_MEDIA_NEXT, 103, piFlags);
        PendingIntent stopPi = serviceActionPi(ACTION_MEDIA_STOP, 104, piFlags);

        Notification.Action prevAction = new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "Previous", prevPi).build();
        Notification.Action toggleAction = new Notification.Action.Builder(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                togglePi).build();
        Notification.Action nextAction = new Notification.Action.Builder(
                android.R.drawable.ic_media_next, "Next", nextPi).build();

        Notification.MediaStyle style = new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(isPlaying ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album)
                .setContentIntent(contentPi)
                .setDeleteIntent(stopPi)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .setShowWhen(false)
                .setColor(0xFFA855F7)
                .setColorized(true)
                .setStyle(style)
                .addAction(prevAction)
                .addAction(toggleAction)
                .addAction(nextAction);

        if (artworkBitmap != null) {
            builder.setLargeIcon(artworkBitmap);
        }
        return builder.build();
    }

    private PendingIntent serviceActionPi(String action, int reqCode, int flags) {
        Intent i = new Intent(this, PlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(this, reqCode, i, flags);
    }

    @Override
    public void onDestroy() {
        releaseLocksAndFocus();
        artworkPool.shutdownNow();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
