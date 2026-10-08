package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import org.junit.Test;

public class PlayerReturnPolicyTest {
  @Test
  public void coldLaunchAndRealBackgroundReturnAreDistinct() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(false);
    assertEquals(1, p.version());
    p.resumed();
    assertEquals(1, p.version());
    p.stopped();
    p.resumed();
    assertEquals(2, p.version());
    p.resumed();
    assertEquals(2, p.version());
  }

  @Test
  public void permissionOverlayPauseAloneDoesNotReopen() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(false);
    p.resumed();
    p.resumed();
    assertEquals(1, p.version());
  }

  @Test
  public void externalPickerRoundTripDoesNotReopen() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(false);
    p.externalFlowStarted();
    p.stopped();
    p.resumed();
    assertEquals(1, p.version());
    p.stopped();
    p.resumed();
    assertEquals(2, p.version());
  }

  @Test
  public void restoredPickerAndFailedPickerDoNotPoisonNextReturn() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(true);
    assertEquals(0, p.version());
    p.resumed();
    assertEquals(0, p.version());
    p.externalFlowStarted();
    p.externalFlowFailed();
    p.stopped();
    p.resumed();
    assertEquals(1, p.version());
  }

  @Test
  public void mediaNotificationAndResumeCoalesceToOneRequest() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(false);
    p.stopped();
    p.openFromMediaControl();
    assertEquals(2, p.version());
    p.resumed();
    assertEquals(2, p.version());
    p.stopped();
    p.resumed();
    assertEquals(3, p.version());
  }

  @Test
  public void explicitMediaTapWinsOverPendingPicker() {
    PlayerReturnPolicy p = new PlayerReturnPolicy(false);
    p.externalFlowStarted();
    p.stopped();
    p.openFromMediaControl();
    p.resumed();
    assertEquals(2, p.version());
  }
}
