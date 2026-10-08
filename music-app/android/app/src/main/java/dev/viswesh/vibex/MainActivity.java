package dev.viswesh.vibex;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.viswesh.vibex.audio.PlayerReturnPolicy;
import dev.viswesh.vibex.audio.VibexAudioPlugin;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
  private static final String OPEN_PLAYER = "dev.viswesh.vibex.OPEN_PLAYER";
  private static final String EXTERNAL_FLOW = "vibex.externalFlow";
  private final String viewEpoch = UUID.randomUUID().toString();
  private PlayerReturnPolicy returns;

  public static Intent playerIntent(Context context) {
    return new Intent(context, MainActivity.class)
        .setAction(OPEN_PLAYER)
        .putExtra(OPEN_PLAYER, true)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
  }

  public String playerReturnToken() {
    return returns == null || returns.version() == 0 ? "" : viewEpoch + ":" + returns.version();
  }

  private void readPlayerIntent(Intent intent) {
    if (intent != null && intent.getBooleanExtra(OPEN_PLAYER, false)) {
      returns.openFromMediaControl();
      intent.removeExtra(OPEN_PLAYER);
    }
  }

  @Override
  public void onCreate(Bundle state) {
    returns = new PlayerReturnPolicy(state != null && state.getBoolean(EXTERNAL_FLOW, false));
    readPlayerIntent(getIntent());
    registerPlugin(VibexAudioPlugin.class);
    super.onCreate(state);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    setIntent(intent);
    readPlayerIntent(intent);
    // Update routing before Capacitor forwards the intent to the audio UI observer.
    super.onNewIntent(intent);
  }

  @Override
  public void onResume() {
    if (returns != null) returns.resumed();
    super.onResume();
  }

  @Override
  public void onStop() {
    if (returns != null) returns.stopped();
    // Activity visibility never controls whether the native player is playing.
    super.onStop();
  }

  @Override
  public void startActivityForResult(Intent intent, int requestCode, Bundle options) {
    // Covers native audio/backup pickers and WebView file inputs through ActivityResultRegistry.
    if (returns != null && requestCode >= 0) returns.externalFlowStarted();
    try {
      super.startActivityForResult(intent, requestCode, options);
    } catch (RuntimeException error) {
      if (returns != null) returns.externalFlowFailed();
      throw error;
    }
  }

  @Override
  public void onSaveInstanceState(Bundle state) {
    if (returns != null) state.putBoolean(EXTERNAL_FLOW, returns.isExternalFlow());
    super.onSaveInstanceState(state);
  }
}
