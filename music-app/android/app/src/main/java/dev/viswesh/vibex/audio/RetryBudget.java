package dev.viswesh.vibex.audio;

/** A READY event is not proof of sustained playback. Same-track transitions keep the budget. */
public final class RetryBudget {
  private String track = "";
  private int failures;
  private long healthySince = -1;

  public void track(String next) {
    if (!track.equals(next)) {
      reset();
      track = next;
    }
  }

  public void reset() {
    failures = 0;
    healthySince = -1;
  }

  public boolean failure() {
    healthySince = -1;
    return ++failures <= 2;
  }

  public void playing(boolean playing, long now) {
    if (!playing) healthySince = -1;
    else if (healthySince < 0) healthySince = now;
    else if (now - healthySince >= 10000) failures = 0;
  }
}
