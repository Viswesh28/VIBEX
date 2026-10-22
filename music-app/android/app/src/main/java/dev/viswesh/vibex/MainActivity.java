package dev.viswesh.vibex;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge starts so the web layer can see it on
        // first paint. Canvas minting is the only custom plugin so far.
        registerPlugin(CanvasMintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
