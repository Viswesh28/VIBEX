package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;

import java.util.*;
import org.junit.Test;

public class ListeningLedgerTest {
  @Test
  public void pausesAndBufferingDoNotCount() {
    List<Double> credits = new ArrayList<>();
    ListeningLedger l = new ListeningLedger((id, sec, play) -> credits.add(sec));
    l.sample("a", true, 0);
    l.sample("a", true, 1000);
    l.sample("a", false, 2000);
    l.sample("a", false, 90000);
    l.sample("a", true, 91000);
    l.sample("a", true, 92000);
    l.flush();
    assertEquals(2, credits.stream().mapToDouble(Double::doubleValue).sum(), .001);
  }

  @Test
  public void onePlayAfterFiveSeconds() {
    int[] plays = {0};
    ListeningLedger l =
        new ListeningLedger(
            (id, sec, play) -> {
              if (play) plays[0]++;
            });
    for (int i = 0; i < 40; i++) l.sample("a", true, i * 1000);
    assertEquals(1, plays[0]);
  }

  @Test
  public void trackTransitionFlushesOldTrack() {
    List<String> ids = new ArrayList<>();
    ListeningLedger l = new ListeningLedger((id, sec, play) -> ids.add(id));
    l.sample("a", true, 0);
    l.sample("a", true, 1000);
    l.sample("b", true, 2000);
    l.sample("b", true, 3000);
    l.flush();
    assertEquals(Arrays.asList("a", "b"), ids);
  }

  @Test
  public void suspendedTicksAreBounded() {
    double[] total = {0};
    ListeningLedger l = new ListeningLedger((id, sec, play) -> total[0] += sec);
    l.sample("a", true, 0);
    l.sample("a", true, 600000);
    l.flush();
    assertEquals(2, total[0], .001);
  }

  @Test
  public void shortFailedPlayDoesNotIncrementPlays() {
    int[] plays = {0};
    ListeningLedger l =
        new ListeningLedger(
            (id, sec, play) -> {
              if (play) plays[0]++;
            });
    l.sample("a", true, 0);
    l.sample("a", true, 500);
    l.sample("a", false, 1000);
    assertEquals(0, plays[0]);
  }
}
