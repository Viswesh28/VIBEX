package dev.viswesh.vibex.audio;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.app.Notification;
import android.os.Looper;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;
import androidx.media3.session.MediaController;
import androidx.media3.session.MediaSession;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.time.Duration;
import java.util.Arrays;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/**
 * Real service and Media3 notification path, with a deterministic test player; not a device test.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class NotificationRegistrationTest {
  private ServiceController<VibeAudioService> lifecycle;
  private VibeAudioService service;
  private MediaController controller;
  private NotificationPlayer player;

  @Before
  public void createService() {
    // Same direct creation path used by the Capacitor bridge; no external controller binds first.
    lifecycle = Robolectric.buildService(VibeAudioService.class).create();
    service = lifecycle.get();
  }

  @After
  public void destroyService() {
    if (controller != null) controller.release();
    if (lifecycle != null) lifecycle.destroy();
    if (player != null) player.release();
    shadowOf(Looper.getMainLooper()).idle();
  }

  @Test
  public void directStartRegistersSessionAndPublishesLiveNotificationControls() throws Exception {
    assertEquals(
        "A directly started player must register its notification session",
        1,
        service.getSessions().size());
    MediaSession session = service.getSessions().get(0);
    assertSame(service.player, session.getPlayer());
    assertSame(session, service.onGetSession(null));
    shadowOf(Looper.getMainLooper()).idle();
    assertNull(
        "Empty startup must not post a music card",
        shadowOf(service).getLastForegroundNotification());

    // Exercise Media3 publication without network access or relying on a JVM audio decoder.
    player = new NotificationPlayer();
    session.setPlayer(player);
    shadowOf(Looper.getMainLooper()).idle();
    Notification notification = shadowOf(service).getLastForegroundNotification();
    assertNotNull(
        "Playback must promote the service and publish a media notification", notification);
    assertEquals(
        "Notification song",
        notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
    assertEquals(
        session.getPlatformToken(),
        notification.extras.getParcelable(Notification.EXTRA_MEDIA_SESSION));
    assertNotNull("Tapping the card must have an activity intent", notification.contentIntent);

    // Connect only AFTER notification creation, so this cannot hide missing service registration.
    ListenableFuture<MediaController> future =
        new MediaController.Builder(service, session.getToken()).buildAsync();
    shadowOf(Looper.getMainLooper()).idle();
    assertTrue(future.isDone());
    controller = future.get();
    assertTrue(controller.isPlaying());
    assertEquals(120_000, controller.getDuration());
    assertTrue(controller.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM));
    long position = controller.getCurrentPosition();
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1500));
    assertTrue(
        "Published playback position advances without a WebView",
        controller.getCurrentPosition() >= position + 1400);

    controller.pause();
    shadowOf(Looper.getMainLooper()).idle();
    assertFalse(player.getPlayWhenReady());
    position = controller.getCurrentPosition();
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));
    assertEquals("Paused progress must stay still", position, controller.getCurrentPosition());
    controller.seekTo(30_000);
    shadowOf(Looper.getMainLooper()).idle();
    assertEquals(30_000, player.getCurrentPosition());
    controller.play();
    shadowOf(Looper.getMainLooper()).idle();
    assertTrue(player.getPlayWhenReady());
    controller.seekToNextMediaItem();
    shadowOf(Looper.getMainLooper()).idle();
    assertEquals("Next notification song", controller.getMediaMetadata().title.toString());
    assertEquals(
        "Next notification song",
        shadowOf(service)
            .getLastForegroundNotification()
            .extras
            .getCharSequence(Notification.EXTRA_TITLE)
            .toString());
    assertEquals(
        "No duplicate sessions when controllers connect or tracks change",
        1,
        service.getSessions().size());
  }

  private static final class NotificationPlayer extends SimpleBasePlayer {
    private State state;

    NotificationPlayer() {
      super(Looper.getMainLooper());
      state =
          new State.Builder()
              .setAvailableCommands(
                  new Player.Commands.Builder()
                      .addAll(
                          Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_TIMELINE,
                          Player.COMMAND_GET_METADATA, Player.COMMAND_PLAY_PAUSE,
                          Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                              Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                          Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_RELEASE)
                      .build())
              .setPlaylist(
                  Arrays.asList(
                      item("one", "Notification song"), item("two", "Next notification song")))
              .setCurrentMediaItemIndex(0)
              .setContentPositionMs(1000)
              .setPlayWhenReady(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
              .setPlaybackState(Player.STATE_READY)
              .build();
    }

    private static MediaItemData item(String id, String title) {
      MediaMetadata metadata =
          new MediaMetadata.Builder().setTitle(title).setArtist("Vibex test").build();
      return new MediaItemData.Builder(id)
          .setMediaItem(new MediaItem.Builder().setMediaId(id).setMediaMetadata(metadata).build())
          .setMediaMetadata(metadata)
          .setDurationUs(120_000_000)
          .setIsSeekable(true)
          .build();
    }

    @Override
    protected State getState() {
      return state;
    }

    @Override
    protected ListenableFuture<?> handleSetPlayWhenReady(boolean playing) {
      state =
          state
              .buildUpon()
              .setContentPositionMs(getCurrentPosition())
              .setPlayWhenReady(playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
              .build();
      return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleSeek(int index, long position, int command) {
      state =
          state
              .buildUpon()
              .setCurrentMediaItemIndex(index)
              .setContentPositionMs(position == C.TIME_UNSET ? 0 : position)
              .build();
      return Futures.immediateVoidFuture();
    }

    @Override
    protected ListenableFuture<?> handleRelease() {
      return Futures.immediateVoidFuture();
    }
  }
}
