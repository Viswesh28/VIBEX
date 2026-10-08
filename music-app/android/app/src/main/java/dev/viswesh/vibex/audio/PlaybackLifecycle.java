package dev.viswesh.vibex.audio;

/** Removing the UI task is different from pausing playback or Android Force stop. */
public final class PlaybackLifecycle {
  private PlaybackLifecycle() {}

  public static boolean keepOnTaskRemoved(
      boolean stopOnDismiss,
      boolean hasQueue,
      boolean playWhenReady,
      boolean ended,
      boolean resumeAfterFocus) {
    return !stopOnDismiss && hasQueue && (resumeAfterFocus || (playWhenReady && !ended));
  }
}
