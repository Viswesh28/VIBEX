package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import org.junit.Test;

public class RetryBudgetTest {
  @Test
  public void sameTrackReadyFailureCyclesAreBounded() {
    RetryBudget r = new RetryBudget();
    r.track("a");
    assertTrue(r.failure());
    r.track("a");
    r.playing(true, 0);
    r.playing(false, 100);
    assertTrue(r.failure());
    r.track("a");
    r.playing(true, 200);
    r.playing(false, 300);
    assertFalse(r.failure());
  }

  @Test
  public void tenSecondsOfActualPlaybackResetsBudget() {
    RetryBudget r = new RetryBudget();
    r.failure();
    r.failure();
    r.playing(true, 0);
    r.playing(true, 10000);
    assertTrue(r.failure());
  }

  @Test
  public void bufferingDoesNotCountAsHealthyPlayback() {
    RetryBudget r = new RetryBudget();
    r.failure();
    r.failure();
    r.playing(true, 0);
    r.playing(false, 100);
    r.playing(true, 20000);
    assertFalse(r.failure());
  }

  @Test
  public void differentTrackOrExplicitNewQueueGetsFreshBudget() {
    RetryBudget r = new RetryBudget();
    r.track("a");
    r.failure();
    r.failure();
    r.track("b");
    assertTrue(r.failure());
    r.failure();
    r.reset();
    assertTrue(r.failure());
  }
}
