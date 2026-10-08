package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import org.junit.Test;

public class PowerPolicyTest {
  @Test
  public void idleHasNoRecurringMaintenanceTimer() {
    assertEquals(-1, PowerPolicy.nextTick(false, false, true, -1));
    assertEquals(-1, PowerPolicy.nextTick(false, true, false, 0));
  }

  @Test
  public void playingUsesBoundedAccountingCadence() {
    assertEquals(2000, PowerPolicy.nextTick(true, false, true, -1));
    assertEquals(15000, PowerPolicy.nextTick(true, false, false, -1));
  }

  @Test
  public void fasterTicksAreLimitedToFadeWindow() {
    assertEquals(200, PowerPolicy.nextTick(true, true, true, 0));
    assertEquals(700, PowerPolicy.nextTick(true, false, true, 700));
    assertEquals(100, PowerPolicy.nextTick(true, false, true, 0));
    assertEquals(2000, PowerPolicy.nextTick(true, false, true, 8000));
  }

  @Test
  public void saverHalvesScheduledCheckpointsNotSoundQuality() {
    assertEquals(15000, PowerPolicy.checkpointMs(false));
    assertEquals(30000, PowerPolicy.checkpointMs(true));
  }

  @Test
  public void refillIsOptInAndOnlyNearQueueEnd() {
    assertTrue(PowerPolicy.allowRefill(true, false, true, false, false, false, false, 8, 6));
    assertFalse(PowerPolicy.allowRefill(false, false, true, false, false, false, false, 8, 6));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, false, false, false, 8, 5));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, false, false, false, 200, 199));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, false, false, false, 0, 0));
  }

  @Test
  public void saverPauseShuffleRepeatSleepAndLocalBlockRefill() {
    assertFalse(PowerPolicy.allowRefill(true, true, true, false, false, false, false, 1, 0));
    assertFalse(PowerPolicy.allowRefill(true, false, false, false, false, false, false, 1, 0));
    assertFalse(PowerPolicy.allowRefill(true, false, true, true, false, false, false, 1, 0));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, true, false, false, 1, 0));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, false, true, false, 1, 0));
    assertFalse(PowerPolicy.allowRefill(true, false, true, false, false, false, true, 1, 0));
  }
}
