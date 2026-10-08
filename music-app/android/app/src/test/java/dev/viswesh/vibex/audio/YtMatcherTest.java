package dev.viswesh.vibex.audio;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Cross-source matcher rules for the JioSaavn → YouTube takeover. Pure JVM —
 * no Robolectric needed. Thresholds: songs phase 0.55, video rescue 0.65.
 */
public class YtMatcherTest {

  @Test
  public void exactAlbumTrackScoresHigh() {
    double s = YtFallback.score("Tum Hi Ho", "Arijit Singh", 262, "Tum Hi Ho", "Arijit Singh", 261);
    assertTrue("exact match should clear songs threshold, got " + s, s >= YtFallback.ACCEPT_SONGS);
  }

  @Test
  public void noisyYouTubeTitleStillMatches() {
    double s =
        YtFallback.score(
            "Hukum",
            "Anirudh Ravichander",
            188,
            "Hukum (Official Lyric Video)",
            "Anirudh Ravichander • Jailer",
            190);
    assertTrue("noise-stripped title should match, got " + s, s >= YtFallback.ACCEPT_SONGS);
  }

  @Test
  public void coverVersionIsRejected() {
    double s =
        YtFallback.score(
            "Tum Hi Ho", "Arijit Singh", 262, "Tum Hi Ho (Cover)", "Random Singer", 250);
    assertTrue("cover with wrong artist must fail threshold, got " + s, s < YtFallback.ACCEPT_SONGS);
  }

  @Test
  public void differentRecordingLengthIsPenalized() {
    double s =
        YtFallback.score(
            "Vaathi Coming", "Anirudh Ravichander", 223, "Vaathi Coming", "Anirudh Ravichander", 410);
    double close =
        YtFallback.score(
            "Vaathi Coming", "Anirudh Ravichander", 223, "Vaathi Coming", "Anirudh Ravichander", 224);
    assertTrue("duration drift must lower the score", close > s);
  }

  @Test
  public void sameTitleDifferentSongIsRejected() {
    double s = YtFallback.score("Kesariya", "Arijit Singh", 268, "Kesariya Dance Mix", "DJ Unknown", 180);
    assertTrue("remix by another artist must fail, got " + s, s < YtFallback.ACCEPT_SONGS);
  }

  @Test
  public void videoRescueThresholdIsStricterThanSongs() {
    assertTrue(YtFallback.ACCEPT_VIDEOS > YtFallback.ACCEPT_SONGS);
  }

  @Test
  public void normalizeStripsFilmNoise() {
    assertTrue(YtFallback.normalize("Hukum (Official Lyric Video) [4K HD]").startsWith("hukum"));
  }
}
