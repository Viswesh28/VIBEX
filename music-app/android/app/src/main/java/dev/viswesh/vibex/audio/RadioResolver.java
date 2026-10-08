package dev.viswesh.vibex.audio;

import java.io.*;
import java.net.*;
import java.util.*;
import org.json.*;

/** Same JioSaavn catalog as the app, used by the native service without waking the WebView. */
final class RadioResolver {
  private volatile HttpURLConnection active;
  private volatile boolean cancelled;

  void cancel() {
    cancelled = true;
    HttpURLConnection c = active;
    if (c != null) c.disconnect();
  }

  JSONArray find(String artist, Set<String> excluded) throws Exception {
    if (artist == null || artist.trim().isEmpty() || artist.equals("Unknown artist"))
      return new JSONArray();
    URL url =
        new URL(
            "https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json"
                + "&_marker=0&api_version=4&ctx=web6dot0&p=1&n=30&q="
                + URLEncoder.encode(artist, "UTF-8"));
    HttpURLConnection c = (HttpURLConnection) url.openConnection();
    active = c;
    try {
      if (cancelled) throw new IOException("Cancelled");
      c.setConnectTimeout(8000);
      c.setReadTimeout(10000);
      c.setRequestProperty("User-Agent", "Mozilla/5.0");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      try (InputStream in = c.getInputStream()) {
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) != -1) {
          if (cancelled) throw new IOException("Cancelled");
          out.write(b, 0, n);
          if (out.size() > 2 * 1024 * 1024) throw new IOException("Radio response too large");
        }
      }
      return parse(out.toString("UTF-8"), artist, excluded);
    } finally {
      c.disconnect();
      active = null;
    }
  }

  static JSONArray parse(String raw, String artist, Set<String> excluded) throws JSONException {
    JSONArray results = new JSONObject(raw).optJSONArray("results");
    JSONArray songs = new JSONArray();
    if (results == null) return songs;
    Set<String> seen = new HashSet<>(excluded);
    for (int i = 0; i < results.length() && songs.length() < 6; i++) {
      JSONObject r = results.optJSONObject(i);
      if (r == null || !r.optString("type", "song").equals("song")) continue;
      String id = r.optString("id"), title = r.optString("title");
      if (!id.matches("[A-Za-z0-9_-]{1,128}")
          || Arrays.asList("__proto__", "constructor", "prototype").contains(id)
          || title.isEmpty()
          || !seen.add(id)) continue;
      JSONObject info = r.optJSONObject("more_info");
      if (info == null) continue;
      JSONObject artists = info.optJSONObject("artistMap");
      JSONArray rawArtists = artists == null ? null : artists.optJSONArray("primary_artists");
      JSONArray primary = new JSONArray();
      if (rawArtists != null)
        for (int j = 0; j < Math.min(10, rawArtists.length()); j++) {
          JSONObject person = rawArtists.optJSONObject(j);
          if (person != null && !person.optString("name").isEmpty())
            primary.put(
                new JSONObject()
                    .put("id", person.optString("id"))
                    .put("name", person.optString("name")));
        }
      if (primary.length() == 0) primary.put(new JSONObject().put("name", artist));
      String image = r.optString("image").replaceFirst("^http:", "https:");
      JSONArray images = new JSONArray();
      if (image.startsWith("https://"))
        images.put(new JSONObject().put("url", image).put("quality", "150x150"));
      songs.put(
          new JSONObject()
              .put("id", id)
              .put("name", title)
              .put("duration", info.optInt("duration", 0))
              .put("artists", new JSONObject().put("primary", primary))
              .put("image", images)
              .put(
                  "album",
                  new JSONObject()
                      .put("id", info.optString("album_id"))
                      .put("name", info.optString("album")))
              .put("url", r.optString("perma_url")));
    }
    return songs;
  }
}
