package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import org.junit.Test;

public class PlaybackLifecycleTest {
  @Test
  public void activePlaybackAndBufferingKeepServiceAfterTaskRemoval() {
    assertTrue(PlaybackLifecycle.keepOnTaskRemoved(false, true, true, false, false));
  }

  @Test
  public void temporaryAudioFocusLossPreservesResumeIntent() {
    assertTrue(PlaybackLifecycle.keepOnTaskRemoved(false, true, false, false, true));
  }

  @Test
  public void explicitDismissPreferenceWins() {
    assertFalse(PlaybackLifecycle.keepOnTaskRemoved(true, true, true, false, false));
    assertFalse(PlaybackLifecycle.keepOnTaskRemoved(true, true, false, false, true));
  }

  @Test
  public void pausedEmptyAndEndedQueuesDoNotKeepIdleService() {
    assertFalse(PlaybackLifecycle.keepOnTaskRemoved(false, true, false, false, false));
    assertFalse(PlaybackLifecycle.keepOnTaskRemoved(false, false, true, false, false));
    assertFalse(PlaybackLifecycle.keepOnTaskRemoved(false, true, true, true, false));
  }
}
