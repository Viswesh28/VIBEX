package dev.viswesh.vibex.audio;

import android.app.Notification;
import androidx.media3.exoplayer.offline.*;
import androidx.media3.exoplayer.scheduler.*;
import java.util.List;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class VibeDownloadService extends DownloadService {
  public VibeDownloadService() {
    super(41, 1000, "vibex-downloads", dev.viswesh.vibex.R.string.download_channel, 0);
  }

  @Override
  protected DownloadManager getDownloadManager() {
    return VibeMedia.get(this).manager;
  }

  @Override
  protected Scheduler getScheduler() {
    return new PlatformScheduler(this, 4201);
  }

  @Override
  protected Notification getForegroundNotification(
      List<Download> downloads, int notMetRequirements) {
    return new DownloadNotificationHelper(this, "vibex-downloads")
        .buildProgressNotification(
            this,
            android.R.drawable.stat_sys_download,
            null,
            "Vibex · Offline library",
            downloads,
            notMetRequirements);
  }
}
