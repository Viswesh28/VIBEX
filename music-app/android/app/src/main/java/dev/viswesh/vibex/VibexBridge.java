package dev.viswesh.vibex;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Native `@JavascriptInterface` bound to `window.VibexAndroid` inside VIBEX's WebView.
 */
public final class VibexBridge {

    private final MainActivity activity;

    public VibexBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getVersion() {
        return "3.2.0";
    }

    @JavascriptInterface
    public String getPackageId() {
        return "dev.viswesh.vibex";
    }

    @JavascriptInterface
    public void minimizeApp() {
        activity.runOnUiThread(() -> activity.moveTaskToBack(true));
    }

    @JavascriptInterface
    public String consumeInitialShare() {
        return activity.consumePendingShareJson();
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.runOnUiThread(() -> {
                if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(
                            new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9101);
                }
            });
        }
    }

    @JavascriptInterface
    public void updateMetadata(
            String title,
            String artist,
            String album,
            String artworkUrl,
            long durationMs) {
        try {
            Context ctx = activity.getApplicationContext();
            Intent i = new Intent(ctx, PlaybackService.class);
            i.setAction(PlaybackService.ACTION_UPDATE_METADATA);
            i.putExtra("title", title != null ? title : "");
            i.putExtra("artist", artist != null ? artist : "");
            i.putExtra("album", album != null ? album : "");
            i.putExtra("artworkUrl", artworkUrl != null ? artworkUrl : "");
            i.putExtra("durationMs", durationMs);
            ctx.startService(i);
        } catch (Throwable ignored) {
        }
    }

    @JavascriptInterface
    public void updatePlaybackState(boolean isPlaying, long positionMs, long durationMs) {
        try {
            Context ctx = activity.getApplicationContext();
            Intent i = new Intent(ctx, PlaybackService.class);
            i.setAction(PlaybackService.ACTION_UPDATE_STATE);
            i.putExtra("isPlaying", isPlaying);
            i.putExtra("positionMs", positionMs);
            i.putExtra("durationMs", durationMs);
            if (isPlaying && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * Save tagged `.m4a` / `.mp3` audio bytes straight into Android's public `Music/VIBEX/`
     * folder using Scoped Storage (`MediaStore.Audio.Media`) on Android 10+ and public
     * `Music/VIBEX` + `MediaScannerConnection` on Android 8–9.
     */
    @JavascriptInterface
    public String saveAudioBase64(String fileName, String mimeType, String base64Data) {
        if (base64Data == null || base64Data.isEmpty()) return "";
        byte[] raw = Base64.decode(base64Data, Base64.DEFAULT);
        if (raw == null || raw.length == 0) return "";

        String cleanName = (fileName == null || fileName.trim().isEmpty())
                ? "track.m4a"
                : fileName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        String cleanMime = (mimeType == null || mimeType.trim().isEmpty())
                ? "audio/mp4"
                : mimeType.trim();

        Context ctx = activity.getApplicationContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = ctx.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, cleanName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, cleanMime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/VIBEX");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);

            Uri itemUri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
            if (itemUri != null) {
                try (OutputStream os = resolver.openOutputStream(itemUri)) {
                    if (os != null) {
                        os.write(raw);
                        os.flush();
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(itemUri, done, null, null);
                    return itemUri.toString();
                } catch (Throwable err) {
                    try {
                        resolver.delete(itemUri, null, null);
                    } catch (Throwable ignored) {
                    }
                }
            }
        }

        // Fallback for Android 8.0–9.0 or vendor ROMs
        try {
            File baseDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            File dir = new File(baseDir, "VIBEX");
            if (!dir.exists() && !dir.mkdirs()) {
                dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_MUSIC), "VIBEX");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            File out = new File(dir, cleanName);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(raw);
                fos.flush();
            }
            MediaScannerConnection.scanFile(
                    ctx,
                    new String[]{out.getAbsolutePath()},
                    new String[]{cleanMime},
                    null);
            return Uri.fromFile(out).toString();
        } catch (Throwable ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public void openSystemShare(String title, String text, String url) {
        activity.runOnUiThread(() -> {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
                String body = (text != null && !text.isEmpty())
                        ? (url != null && !url.isEmpty() ? text + "\n" + url : text)
                        : (url != null ? url : "");
                send.putExtra(Intent.EXTRA_TEXT, body);
                activity.startActivity(Intent.createChooser(send, "Share from VIBEX"));
            } catch (Throwable ignored) {
            }
        });
    }
}
