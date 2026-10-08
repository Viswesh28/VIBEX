package dev.viswesh.vibex.audio;

/** Pure scheduling rules; no polling at all while idle. Values are not battery measurements. */
public final class PowerPolicy {
  private PowerPolicy() {}

  public static long checkpointMs(boolean saver) {
    return saver ? 30000 : 15000;
  }

  public static long nextTick(boolean playing, boolean fading, boolean stats, long untilFade) {
    if (!playing) return -1;
    if (fading) return 200;
    long interval = stats ? 2000 : 15000;
    if (untilFade >= 0) interval = Math.min(interval, Math.max(100, untilFade));
    return interval;
  }

  public static boolean allowRefill(
      boolean enabled,
      boolean saver,
      boolean playing,
      boolean shuffle,
      boolean repeating,
      boolean sleeping,
      boolean local,
      int size,
      int index) {
    return enabled
        && !saver
        && playing
        && !shuffle
        && !repeating
        && !sleeping
        && !local
        && size > 0
        && size < 200
        && index >= 0
        && index < size
        && size - index <= 2;
  }
}
