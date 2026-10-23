package dev.viswesh.vibex;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge starts so the web layer can see plugins on
        // first paint — including cold-launch Share Sheet intents (`ACTION_SEND`).
        registerPlugin(CanvasMintPlugin.class);
        registerPlugin(ShareIntentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
