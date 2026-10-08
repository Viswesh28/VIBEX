package dev.viswesh.vibex.audio;

import android.content.Context;
import android.net.Uri;
import androidx.media3.common.*;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.*;
import androidx.media3.datasource.cache.*;
import androidx.media3.exoplayer.offline.*;
import androidx.media3.exoplayer.scheduler.Requirements;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import org.json.*;

/** Cache is checked before URL resolution. Download IDs are stable even when CDN URLs expire. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class VibeMedia {
  private static VibeMedia instance;
  public static Runnable downloadObserver;

  public static synchronized VibeMedia get(Context c) {
    if (instance == null) instance = new VibeMedia(c.getApplicationContext());
    return instance;
  }

  public final SimpleCache downloads, stream;
  public final DownloadManager manager;
  public final DataSource.Factory playback;
  private final VibeStore store;
  private final Context context;
  private final Map<String, Resolved> urls = new HashMap<>();

  private static class Resolved {
    String url;
    long at;

    Resolved(String u) {
      url = u;
      at = System.currentTimeMillis();
    }
  }

  private VibeMedia(Context c) {
    context = c;
    store = VibeStore.get(c);
    StandaloneDatabaseProvider db = new StandaloneDatabaseProvider(c);
    downloads = new SimpleCache(new File(c.getFilesDir(), "offline"), new NoOpCacheEvictor(), db);
    long mb = Math.max(32, Math.min(1024, store.settings().optLong("cacheMB", 128)));
    stream =
        new SimpleCache(
            new File(c.getCacheDir(), "streams"),
            new LeastRecentlyUsedCacheEvictor(mb * 1024 * 1024),
            db);
    DataSource.Factory http =
        new DefaultDataSource.Factory(
            c,
            new DefaultHttpDataSource.Factory()
                .setUserAgent("VIBEX/2")
                .setConnectTimeoutMs(12000)
                .setReadTimeoutMs(15000)
                .setAllowCrossProtocolRedirects(false));
    DataSource.Factory resolver =
        new ResolvingDataSource.Factory(
            http,
            spec -> {
              if (!"vibex".equals(spec.uri.getScheme())) return spec;
              String id = spec.uri.getLastPathSegment();
              return spec.withUri(Uri.parse(resolve(id, spec.uri.getQueryParameter("q"))));
            });
    DataSource.Factory cached =
        new CacheDataSource.Factory()
            .setCache(stream)
            .setCacheKeyFactory(this::streamKey)
            .setUpstreamDataSourceFactory(resolver)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    playback =
        new CacheDataSource.Factory()
            .setCache(downloads)
            .setCacheKeyFactory(this::offlineKey)
            .setUpstreamDataSourceFactory(cached)
            .setCacheWriteDataSinkFactory(null)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    manager = new DownloadManager(c, db, downloads, cached, Executors.newFixedThreadPool(2));
    manager.addListener(
        new DownloadManager.Listener() {
          @Override
          public void onDownloadChanged(
              DownloadManager manager, Download download, Exception error) {
            if (downloadObserver != null) downloadObserver.run();
          }

          @Override
          public void onDownloadRemoved(DownloadManager manager, Download download) {
            if (downloadObserver != null) downloadObserver.run();
          }
        });
    manager.setMaxParallelDownloads(2);
    manager.setMinRetryCount(3);
    configure(store.settings());
  }

  private String streamKey(DataSpec spec) {
    if (!"vibex".equals(spec.uri.getScheme())) return CacheKeyFactory.DEFAULT.buildCacheKey(spec);
    return spec.uri.getLastPathSegment() + "|" + spec.uri.getQueryParameter("q");
  }

  private String offlineKey(DataSpec spec) {
    if ("vibex".equals(spec.uri.getScheme())) {
      try {
        Download d = manager.getDownloadIndex().getDownload(spec.uri.getLastPathSegment());
        // A partial download of a different bitrate must never be mixed with streaming bytes.
        if (d != null && d.state == Download.STATE_COMPLETED && d.request.customCacheKey != null)
          return d.request.customCacheKey;
      } catch (IOException ignored) {
      }
    }
    return streamKey(spec);
  }

  /** ids whose stream died mid-playback; the next resolve probes before trusting Saavn again. */
  private final Set<String> suspect = new HashSet<>();

  public synchronized void invalidate(String id) {
    for (String q : new String[] {"12kbps", "48kbps", "96kbps", "160kbps", "320kbps"})
      urls.remove(id + q);
    suspect.add(id);
  }

  public void configure(JSONObject prefs) {
    manager.setRequirements(
        new Requirements(
            Requirements.NETWORK
                | (prefs.optBoolean("wifiOnly", true) ? Requirements.NETWORK_UNMETERED : 0)));
  }

  private synchronized String resolve(String id, String quality) throws IOException {
    String q = quality == null ? store.settings().optString("quality", "320kbps") : quality;
    if (!q.matches("(12|48|96|160|320)kbps")) q = "160kbps";
    String key = id + q;
    Resolved old = urls.get(key);
    if (old != null && System.currentTimeMillis() - old.at < 120000) return old.url;
    // YouTube already took control of this track in this session? Skip the
    // Saavn round-trip entirely (route cache — see YtFallback).
    String routed = YtFallback.get(context).routed(id);
    if (routed != null) return routed;
    boolean verify = suspect.remove(id);
    try {
      String url = resolveSaavn(id, q, key);
      // A mid-song death put this id under suspicion: don't trust a Saavn URL
      // again until it survives a probe. A dead probe hands control to YouTube.
      if (verify && !alive(url)) {
        urls.remove(key);
        throw new IOException("Saavn CDN URL failed liveness probe");
      }
      YtFallback.get(context).release(id); // Saavn verified — it keeps/retakes control
      return url;
    } catch (IOException primary) {
      String yt = YtFallback.get(context).resolve(store.song(id), id);
      if (yt != null) return yt; // takeover: same MediaItem, new URL underneath
      throw primary; // truthful original error when YouTube has no confident match
    }
  }

  private boolean alive(String url) {
    HttpURLConnection con = null;
    try {
      con = (HttpURLConnection) new URL(url).openConnection();
      con.setRequestMethod("HEAD");
      con.setConnectTimeout(5000);
      con.setReadTimeout(5000);
      con.setRequestProperty("User-Agent", "VIBEX/2");
      int code = con.getResponseCode();
      return code >= 200 && code < 400;
    } catch (Exception e) {
      return false;
    } finally {
      if (con != null) con.disconnect();
    }
  }

  private String resolveSaavn(String id, String q, String key) throws IOException {
    HttpURLConnection con = null;
    try {
      URL u =
          new URL(
              "https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&pids="
                  + URLEncoder.encode(id, "UTF-8"));
      con = (HttpURLConnection) u.openConnection();
      con.setConnectTimeout(12000);
      con.setReadTimeout(15000);
      con.setRequestProperty("User-Agent", "Mozilla/5.0");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      try (InputStream in = con.getInputStream()) {
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) != -1) {
          out.write(b, 0, n);
          if (out.size() > 2 * 1024 * 1024) throw new IOException("Metadata response too large");
        }
      }
      JSONObject song =
          new JSONObject(out.toString("UTF-8")).getJSONArray("songs").getJSONObject(0);
      String encrypted = song.getJSONObject("more_info").getString("encrypted_media_url");
      Cipher cipher = Cipher.getInstance("DES/ECB/PKCS5Padding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec("38346591".getBytes(StandardCharsets.UTF_8), "DES"));
      String result =
          new String(
                  cipher.doFinal(
                      android.util.Base64.decode(encrypted, android.util.Base64.DEFAULT)),
                  StandardCharsets.UTF_8)
              .replace("_96", "_" + q.replace("kbps", ""))
              .replaceFirst("^http:", "https:");
      Uri uri = Uri.parse(result);
      String host = uri.getHost();
      if (!"https".equals(uri.getScheme())
          || host == null
          || !(host.endsWith(".saavncdn.com")
              || host.equals("saavncdn.com")
              || host.endsWith(".jiosaavn.com")
              || host.endsWith(".akamaized.net"))) throw new IOException("Unexpected media host");
      if (urls.size() > 200) urls.clear();
      urls.put(key, new Resolved(result));
      return result;
    } catch (Exception e) {
      throw new IOException("Unable to refresh stream. Check your connection.", e);
    } finally {
      if (con != null) con.disconnect();
    }
  }

  public static String artist(JSONObject s) {
    JSONArray a =
        s.optJSONObject("artists") != null
            ? s.optJSONObject("artists").optJSONArray("primary")
            : null;
    List<String> names = new ArrayList<>();
    if (a != null)
      for (int i = 0; i < a.length(); i++) names.add(a.optJSONObject(i).optString("name"));
    return names.isEmpty()
        ? s.optString("subtitle", "Unknown artist")
        : android.text.TextUtils.join(", ", names);
  }

  public static String artwork(JSONObject s) {
    JSONArray a = s.optJSONArray("image");
    return a != null && a.length() > 0 ? a.optJSONObject(a.length() - 1).optString("url") : "";
  }

  public MediaItem item(JSONObject s) {
    store.song(s);
    String id = s.optString("id");
    String uri = s.optString("localUri");
    if (uri.isEmpty())
      uri =
          "vibex://song/"
              + Uri.encode(id)
              + "?q="
              + store.settings().optString("quality", "320kbps");
    MediaMetadata.Builder m =
        new MediaMetadata.Builder()
            .setTitle(android.text.Html.fromHtml(s.optString("name")).toString())
            .setArtist(artist(s));
    String art = artwork(s);
    if (!art.isEmpty()) m.setArtworkUri(VibeArtwork.available(context, art));
    return new MediaItem.Builder()
        .setMediaId(id)
        .setUri(uri)
        .setCustomCacheKey(id)
        .setMediaMetadata(m.build())
        .build();
  }

  public JSONArray downloadState() {
    JSONArray a = new JSONArray();
    try (DownloadCursor cursor = manager.getDownloadIndex().getDownloads()) {
      while (cursor.moveToNext()) {
        Download d = cursor.getDownload();
        JSONObject o = new JSONObject();
        o.put("id", d.request.id);
        o.put("state", d.state);
        o.put("percent", Math.max(0, d.getPercentDownloaded()));
        o.put("bytes", d.getBytesDownloaded());
        o.put("song", store.song(d.request.id));
        a.put(o);
      }
    } catch (Exception ignored) {
    }
    return a;
  }

  public void clearStream() throws Exception {
    for (String key : stream.getKeys()) stream.removeResource(key);
  }
}
