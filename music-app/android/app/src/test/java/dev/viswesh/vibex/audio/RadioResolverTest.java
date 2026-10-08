package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import java.util.*;
import org.json.*;
import org.junit.Test;

public class RadioResolverTest {
  private JSONObject song(String id) throws Exception {
    return new JSONObject()
        .put("id", id)
        .put("title", "A song")
        .put("type", "song")
        .put("image", "http://example.test/cover.jpg")
        .put(
            "more_info",
            new JSONObject().put("duration", "180").put("encrypted_media_url", "never copy this"));
  }

  @Test
  public void capsSixAndDeduplicatesQueueAndProviderRows() throws Exception {
    JSONArray rows = new JSONArray().put(song("old")).put(song("new0"));
    for (int i = 0; i < 12; i++) rows.put(song("new" + i));
    JSONArray result =
        RadioResolver.parse(
            new JSONObject().put("results", rows).toString(),
            "Artist",
            new HashSet<>(Arrays.asList("old")));
    assertEquals(6, result.length());
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < result.length(); i++)
      assertTrue(ids.add(result.getJSONObject(i).getString("id")));
    assertFalse(ids.contains("old"));
  }

  @Test
  public void stripsTransientAudioUrlsAndKeepsPlaybackMetadata() throws Exception {
    JSONArray result =
        RadioResolver.parse(
            new JSONObject().put("results", new JSONArray().put(song("one"))).toString(),
            "Artist",
            Collections.emptySet());
    JSONObject s = result.getJSONObject(0);
    assertEquals(180, s.getInt("duration"));
    assertFalse(s.toString().contains("encrypted_media_url"));
    assertFalse(s.has("downloadUrl"));
    assertEquals(
        "Artist",
        s.getJSONObject("artists").getJSONArray("primary").getJSONObject(0).getString("name"));
    assertEquals(
        "https://example.test/cover.jpg",
        s.getJSONArray("image").getJSONObject(0).getString("url"));
  }

  @Test
  public void skipsMalformedRowsAndNonSongResults() throws Exception {
    JSONArray rows =
        new JSONArray()
            .put(JSONObject.NULL)
            .put(song("bad").put("type", "album"))
            .put(song("__proto__"))
            .put(song("ok"));
    JSONArray result =
        RadioResolver.parse(
            new JSONObject().put("results", rows).toString(), "Artist", Collections.emptySet());
    assertEquals(1, result.length());
    assertEquals("ok", result.getJSONObject(0).getString("id"));
  }

  @Test
  public void missingResultsIsAnEmptyRecommendationNotAFailure() throws Exception {
    assertEquals(0, RadioResolver.parse("{}", "Artist", Collections.emptySet()).length());
  }
}
