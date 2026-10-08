package dev.viswesh.vibex.audio;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JioSaavn → YouTube stream takeover. Login-free by design.
 *
 * Fired by VibeMedia.resolve() only after the Saavn path has failed (API error,
 * dead CDN URL, region block). Two phases:
 *
 *   MATCH  — YT Music search, *songs filter first* (ATV = clean album audio whose
 *            duration matches Saavn metadata ±2s), video songs only as rescue
 *            with a stricter text threshold (film edits carry dialogues/intros,
 *            so duration can't be trusted and the text match must carry more).
 *            Below threshold the takeover refuses: a wrong song is worse than
 *            an error. Even on video rescue only AUDIO formats are streamed.
 *
 *   STREAM — InnerTube /player across a measured client cascade:
 *            ANDROID_VR 1.65.10 (whole-file capable, no cipher, no login)
 *            → ANDROID_VR 1.43.32 (legacy pin, control)
 *            → IOS (≈1 MiB preview only — still beats silence).
 *
 * Once YouTube wins a track it keeps control for the app session (route map),
 * so the next resolve skips Saavn and the search round-trip entirely.
 */
final class YtFallback {
  private static YtFallback instance;

  static synchronized YtFallback get(Context c) {
    if (instance == null) instance = new YtFallback();
    return instance;
  }

  /** mediaId → videoId once a match was accepted (session route cache). */
  private final Map<String, String> routes = new HashMap<>();

  /** mediaId currently controlled by YouTube — read by the service snapshot. */
  private static final Set<String> viaYt = new HashSet<>();

  private static class Resolved {
    final String url;
    final long expiresAt;

    Resolved(String url, long expiresAt) {
      this.url = url;
      this.expiresAt = expiresAt;
    }
  }

  private final Map<String, Resolved> urls = new HashMap<>();

  static synchronized boolean via(String mediaId) {
    return mediaId != null && viaYt.contains(mediaId);
  }

  private static synchronized void markVia(String mediaId, boolean on) {
    if (on) viaYt.add(mediaId);
    else viaYt.remove(mediaId);
  }

  /** Fast path: YouTube already controls this track and its URL is still fresh. */
  synchronized String routed(String mediaId) {
    Resolved r = urls.get(mediaId);
    if (r != null && System.currentTimeMillis() < r.expiresAt) return r.url;
    String videoId = routes.get(mediaId);
    if (videoId == null) return null;
    try {
      String url = streamUrl(videoId, mediaId);
      return url;
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Full takeover: match by metadata, then stream. Returns null when no
   * confident match or every client failed — the caller rethrows the original
   * Saavn error so the user sees the truthful message.
   */
  synchronized String resolve(JSONObject song, String mediaId) {
    if (song == null) return null;
    try {
      String videoId = routes.get(mediaId);
      if (videoId == null) {
        videoId = match(song);
        if (videoId == null) return null;
        routes.put(mediaId, videoId);
      }
      return streamUrl(videoId, mediaId);
    } catch (Exception e) {
      return null;
    }
  }

  /** Saavn healed for this id (fresh resolve succeeded): hand control back. */
  synchronized void release(String mediaId) {
    urls.remove(mediaId);
    markVia(mediaId, false);
  }

  // ---------------------------------------------------------------- matching

  private static final String FILTER_SONGS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";
  private static final String FILTER_VIDEOS = "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D";
  static final double ACCEPT_SONGS = 0.55;
  static final double ACCEPT_VIDEOS = 0.65;

  private String match(JSONObject song) throws Exception {
    String title = plain(song.optString("name"));
    String artist = VibeMedia.artist(song);
    String firstArtist = artist.split(",")[0].trim();
    double duration = song.optDouble("duration", 0);
    if (duration == 0 && song.optJSONObject("more_info") != null)
      duration = song.optJSONObject("more_info").optDouble("duration", 0);
    String query = (title + " " + firstArtist).trim();

    // Phase 1: songs (ATV album audio). Phase 2: video songs, stricter.
    String hit = bestOf(search(query, FILTER_SONGS), title, artist, duration, ACCEPT_SONGS);
    if (hit != null) return hit;
    return bestOf(search(query, FILTER_VIDEOS), title, artist, duration, ACCEPT_VIDEOS);
  }

  private static class Candidate {
    String videoId = "";
    String title = "";
    String artists = "";
    double duration = 0;
  }

  private String bestOf(
      List<Candidate> candidates, String title, String artist, double duration, double threshold) {
    Candidate best = null;
    double bestScore = 0;
    for (Candidate c : candidates) {
      double s = score(title, artist, duration, c.title, c.artists, c.duration);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best != null && bestScore >= threshold ? best.videoId : null;
  }

  /** Pure and static so it is unit-testable without Android. */
  static double score(
      String qTitle, String qArtists, double qDuration, String cTitle, String cArtists, double cDuration) {
    String qt = normalize(qTitle), ct = normalize(cTitle);
    double s = 0.5 * titleSimilarity(qt, ct);
    s += 0.3 * artistOverlap(qArtists, cArtists + " " + ct);
    s += 0.2 * durationScore(qDuration, cDuration);
    for (String trap :
        new String[] {"cover", "remix", "live", "slowed", "sped up", "reverb", "8d", "instrumental", "karaoke"})
      if (ct.contains(trap) && !qt.contains(trap)) s -= 0.25;
    return Math.max(0, Math.min(1, s));
  }

  private static final Pattern NOISE =
      Pattern.compile(
          "\\((official|lyric|lyrical|full|hd|4k|audio|video|visualizer)[^)]*\\)"
              + "|\\[(official|lyric|lyrical|full|hd|4k|audio|video)[^]]*]"
              + "|official video|official audio|lyric video|full song|video song|hq|hd",
          Pattern.CASE_INSENSITIVE);

  static String normalize(String s) {
    if (s == null) return "";
    s = NOISE.matcher(s).replaceAll(" ");
    s = s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N} ]", " ").replaceAll("\\s+", " ").trim();
    return s;
  }

  private static double titleSimilarity(String a, String b) {
    if (a.isEmpty() || b.isEmpty()) return 0;
    if (a.equals(b)) return 1;
    Set<String> ta = new HashSet<>(), tb = new HashSet<>();
    for (String t : a.split(" ")) ta.add(t);
    for (String t : b.split(" ")) tb.add(t);
    Set<String> inter = new HashSet<>(ta);
    inter.retainAll(tb);
    Set<String> union = new HashSet<>(ta);
    union.addAll(tb);
    double jaccard = (double) inter.size() / union.size();
    double containment = (double) inter.size() / Math.max(1, Math.min(ta.size(), tb.size()));
    return Math.max(jaccard, 0.9 * containment);
  }

  private static double artistOverlap(String qArtists, String hay) {
    String[] names = qArtists.split(",");
    if (names.length == 0) return 0.5;
    String h = normalize(hay);
    int hits = 0, total = 0;
    for (String n : names) {
      String name = normalize(n);
      if (name.isEmpty()) continue;
      total++;
      if (h.contains(name)) hits++;
    }
    return total == 0 ? 0.5 : (double) hits / total;
  }

  private static double durationScore(double q, double c) {
    if (q <= 0 || c <= 0) return 0.5;
    double d = Math.abs(q - c);
    if (d <= 2) return 1;
    if (d <= 5) return 0.7;
    if (d <= 12) return 0.3;
    return 0;
  }

  // ---------------------------------------------------------------- innertube

  private List<Candidate> search(String query, String filter) throws Exception {
    JSONObject client =
        new JSONObject()
            .put("clientName", "WEB_REMIX")
            .put("clientVersion", "1.20241028.01.00")
            .put("hl", "en")
            .put("gl", "IN");
    JSONObject body =
        new JSONObject()
            .put("context", new JSONObject().put("client", client))
            .put("query", query)
            .put("params", filter);
    JSONObject res =
        post(
            "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
            body,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
    List<Candidate> out = new ArrayList<>();
    collectItems(res, out);
    return out;
  }

  /** Walk the whole response for musicResponsiveListItemRenderer nodes. */
  private void collectItems(Object node, List<Candidate> out) {
    if (out.size() >= 12) return;
    if (node instanceof JSONObject) {
      JSONObject o = (JSONObject) node;
      JSONObject item = o.optJSONObject("musicResponsiveListItemRenderer");
      if (item != null) {
        Candidate c = parseItem(item);
        if (c != null) out.add(c);
      }
      JSONArray names = o.names();
      if (names != null)
        for (int i = 0; i < names.length(); i++) collectItems(o.opt(names.optString(i)), out);
    } else if (node instanceof JSONArray) {
      JSONArray a = (JSONArray) node;
      for (int i = 0; i < a.length(); i++) collectItems(a.opt(i), out);
    }
  }

  private static final Pattern TIME = Pattern.compile("^(\\d+):(\\d{2})(?::(\\d{2}))?$");

  private Candidate parseItem(JSONObject item) {
    try {
      Candidate c = new Candidate();
      JSONObject pid = item.optJSONObject("playlistItemData");
      if (pid != null) c.videoId = pid.optString("videoId", "");
      JSONArray cols = item.optJSONArray("flexColumns");
      if (cols == null || cols.length() == 0) return null;
      StringBuilder artists = new StringBuilder();
      for (int i = 0; i < cols.length(); i++) {
        JSONObject col =
            cols.optJSONObject(i)
                .optJSONObject("musicResponsiveListItemFlexColumnRenderer");
        if (col == null) continue;
        JSONArray runs = col.optJSONObject("text") == null ? null : col.optJSONObject("text").optJSONArray("runs");
        if (runs == null) continue;
        for (int r = 0; r < runs.length(); r++) {
          JSONObject run = runs.optJSONObject(r);
          if (run == null) continue;
          String text = run.optString("text", "");
          if (i == 0) {
            if (c.title.isEmpty()) c.title = text;
            if (c.videoId.isEmpty()) {
              JSONObject nav = run.optJSONObject("navigationEndpoint");
              if (nav != null && nav.optJSONObject("watchEndpoint") != null)
                c.videoId = nav.optJSONObject("watchEndpoint").optString("videoId", "");
            }
          } else {
            Matcher m = TIME.matcher(text.trim());
            if (m.matches()) {
              double t = Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
              if (m.group(3) != null) t = t * 60 + Integer.parseInt(m.group(3));
              c.duration = t;
            } else if (!"•".equals(text.trim())) {
              artists.append(text).append(' ');
            }
          }
        }
      }
      c.artists = artists.toString();
      return c.videoId.isEmpty() || c.title.isEmpty() ? null : c;
    } catch (Exception e) {
      return null;
    }
  }

  private static class YtClient {
    final String name, version, userAgent;
    final JSONObject extra;

    YtClient(String name, String version, String userAgent, JSONObject extra) {
      this.name = name;
      this.version = version;
      this.userAgent = userAgent;
      this.extra = extra;
    }
  }

  private List<YtClient> cascade() throws Exception {
    List<YtClient> clients = new ArrayList<>();
    clients.add(
        new YtClient(
            "ANDROID_VR",
            "1.65.10",
            "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            new JSONObject()
                .put("deviceMake", "Oculus")
                .put("deviceModel", "Quest 3")
                .put("osName", "Android")
                .put("osVersion", "12L")
                .put("androidSdkVersion", 32)));
    clients.add(
        new YtClient(
            "ANDROID_VR",
            "1.43.32",
            "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            new JSONObject()
                .put("deviceMake", "Oculus")
                .put("deviceModel", "Quest 3")
                .put("osName", "Android")
                .put("osVersion", "12L")
                .put("androidSdkVersion", 32)));
    clients.add(
        new YtClient(
            "IOS",
            "19.45.4",
            "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
            new JSONObject()
                .put("deviceMake", "Apple")
                .put("deviceModel", "iPhone16,2")
                .put("osName", "iOS")
                .put("osVersion", "18.1.0.22B83")));
    return clients;
  }

  private String streamUrl(String videoId, String mediaId) throws Exception {
    for (YtClient yc : cascade()) {
      try {
        JSONObject client =
            new JSONObject()
                .put("clientName", yc.name)
                .put("clientVersion", yc.version)
                .put("hl", "en")
                .put("gl", "IN");
        JSONArray extraNames = yc.extra.names();
        if (extraNames != null)
          for (int i = 0; i < extraNames.length(); i++) {
            String k = extraNames.optString(i);
            client.put(k, yc.extra.get(k));
          }
        JSONObject body =
            new JSONObject()
                .put("context", new JSONObject().put("client", client))
                .put("videoId", videoId)
                .put("contentCheckOk", true)
                .put("racyCheckOk", true);
        JSONObject res =
            post("https://music.youtube.com/youtubei/v1/player?prettyPrint=false", body, yc.userAgent);
        JSONObject status = res.optJSONObject("playabilityStatus");
        if (status == null || !"OK".equals(status.optString("status"))) continue;
        JSONObject streaming = res.optJSONObject("streamingData");
        if (streaming == null) continue;
        JSONArray formats = streaming.optJSONArray("adaptiveFormats");
        if (formats == null) continue;
        JSONObject best = null;
        for (int i = 0; i < formats.length(); i++) {
          JSONObject f = formats.optJSONObject(i);
          if (f == null || !f.optString("mimeType").startsWith("audio/")) continue;
          if (f.optString("url").isEmpty()) continue; // ciphered — client can't use it
          if (best == null) {
            best = f;
            continue;
          }
          boolean bestOpus = best.optInt("itag") == 251, fOpus = f.optInt("itag") == 251;
          if (fOpus && !bestOpus) best = f; // prefer opus 251 outright
          else if (fOpus == bestOpus && f.optInt("bitrate") > best.optInt("bitrate")) best = f;
        }
        if (best == null) continue;
        long ttl = 0;
        try {
          ttl = Long.parseLong(streaming.optString("expiresInSeconds", "0"));
        } catch (NumberFormatException ignored) {
        }
        long expires = System.currentTimeMillis() + Math.max(60, ttl - 60) * 1000L;
        String url = best.optString("url");
        urls.put(mediaId, new Resolved(url, expires));
        markVia(mediaId, true);
        return url;
      } catch (Exception ignored) {
        // next client in the cascade takes over
      }
    }
    throw new IOException("YouTube cascade exhausted for " + videoId);
  }

  // ------------------------------------------------------------------- http

  private JSONObject post(String url, JSONObject body, String userAgent) throws Exception {
    HttpURLConnection con = null;
    try {
      con = (HttpURLConnection) new URL(url).openConnection();
      con.setConnectTimeout(12000);
      con.setReadTimeout(15000);
      con.setDoOutput(true);
      con.setRequestMethod("POST");
      con.setRequestProperty("Content-Type", "application/json");
      con.setRequestProperty("User-Agent", userAgent);
      con.setRequestProperty("Origin", "https://music.youtube.com");
      con.setRequestProperty("Referer", "https://music.youtube.com/");
      byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
      try (OutputStream out = con.getOutputStream()) {
        out.write(payload);
      }
      ByteArrayOutputStream buf = new ByteArrayOutputStream();
      try (InputStream in = con.getInputStream()) {
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) != -1) {
          buf.write(b, 0, n);
          if (buf.size() > 8 * 1024 * 1024) throw new IOException("Response too large");
        }
      }
      return new JSONObject(buf.toString("UTF-8"));
    } finally {
      if (con != null) con.disconnect();
    }
  }

  private static String plain(String html) {
    return android.text.Html.fromHtml(html == null ? "" : html).toString();
  }
}
