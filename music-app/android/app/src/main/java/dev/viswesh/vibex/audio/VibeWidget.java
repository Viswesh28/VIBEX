package dev.viswesh.vibex.audio;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.widget.RemoteViews;
import dev.viswesh.vibex.R;

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class VibeWidget extends AppWidgetProvider {
  public static void updateAll(Context context) {
    AppWidgetManager m = AppWidgetManager.getInstance(context);
    new VibeWidget()
        .onUpdate(context, m, m.getAppWidgetIds(new ComponentName(context, VibeWidget.class)));
  }

  @Override
  public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
    for (int id : ids) {
      RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.vibex_widget);
      VibeAudioService s = VibeAudioService.instance;
      String title =
          s != null && s.player.getCurrentMediaItem() != null
              ? String.valueOf(s.player.getMediaMetadata().title)
              : "Your music, your moment";
      v.setTextViewText(R.id.widget_title, title);
      v.setTextViewText(R.id.widget_play, s != null && s.player.isPlaying() ? "Ⅱ" : "▶");
      v.setOnClickPendingIntent(
          R.id.widget_title,
          PendingIntent.getActivity(
              c,
              0,
              dev.viswesh.vibex.MainActivity.playerIntent(c),
              PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
      int[] views = {R.id.widget_prev, R.id.widget_play, R.id.widget_next};
      String[] actions = {"previous", "toggle", "next"};
      for (int i = 0; i < 3; i++)
        v.setOnClickPendingIntent(
            views[i],
            PendingIntent.getBroadcast(
                c,
                i,
                new Intent(c, VibeWidget.class).setAction("dev.viswesh.vibex." + actions[i]),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
      m.updateAppWidget(id, v);
    }
  }

  @Override
  public void onReceive(Context c, Intent i) {
    super.onReceive(c, i);
    String a = i.getAction();
    if (a == null || !a.startsWith("dev.viswesh.vibex.")) return;
    VibeAudioService s = VibeAudioService.instance;
    if (s == null) {
      c.startActivity(
          dev.viswesh.vibex.MainActivity.playerIntent(c).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      return;
    }
    if (a.endsWith("next") || a.endsWith("previous")) s.recordSkip();
    s.cancelFade();
    if (a.endsWith("toggle")) {
      if (s.player.isPlaying()) s.pause();
      else s.player.play();
    } else if (a.endsWith("next")) s.player.seekToNextMediaItem();
    else s.player.seekToPrevious();
    updateAll(c);
  }
}
