package dev.viswesh.vibex.audio;

/**
 * Monotonic-clock accounting. Pauses, buffering, seeks and delayed ticks cannot create listening
 * time.
 */
public final class ListeningLedger {
  public interface Sink {
    void record(String id, double seconds, boolean play);
  }

  private final Sink sink;
  private String id = "";
  private long last = -1;
  private double pending = 0, listened = 0;
  private boolean counted = false, wasPlaying = false;

  public ListeningLedger(Sink sink) {
    this.sink = sink;
  }

  public void sample(String next, boolean playing, long now) {
    if (!id.equals(next)) {
      flush();
      id = next;
      listened = 0;
      counted = false;
      wasPlaying = false;
      last = now;
    }
    if (last >= 0 && wasPlaying && playing && !id.isEmpty()) {
      double sec = Math.max(0, Math.min(2, (now - last) / 1000.0));
      pending += sec;
      listened += sec;
      if (!counted && listened >= 5) {
        sink.record(id, pending, true);
        pending = 0;
        counted = true;
      } else if (pending >= 30) flush();
    }
    if (!playing) flush();
    wasPlaying = playing;
    last = now;
  }

  public void flush() {
    if (pending > 0 && !id.isEmpty()) {
      sink.record(id, pending, false);
      pending = 0;
    }
  }

  public void reset() {
    flush();
    id = "";
    last = -1;
    pending = 0;
    listened = 0;
    counted = false;
    wasPlaying = false;
  }
}
