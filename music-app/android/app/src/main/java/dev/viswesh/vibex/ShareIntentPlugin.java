package dev.viswesh.vibex;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges Android native Share Sheet intents (`ACTION_SEND` `text/plain`) and
 * custom/App-Link `ACTION_VIEW` intents into the VIBEX web layer on both cold
 * launch (`load()`) and warm resume (`handleOnNewIntent`).
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    @Override
    public void load() {
        Intent launchIntent = getActivity() != null ? getActivity().getIntent() : null;
        if (launchIntent != null) {
            dispatchShareIntent(launchIntent);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null) {
            dispatchShareIntent(intent);
        }
    }

    @PluginMethod
    public void getInitialShare(PluginCall call) {
        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        JSObject payload = extractPayload(intent);
        if (payload != null && getActivity() != null) {
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
        call.resolve(payload != null ? payload : new JSObject());
    }

    private void dispatchShareIntent(Intent intent) {
        JSObject payload = extractPayload(intent);
        if (payload == null) return;
        notifyListeners("shareReceived", payload, true);
        if (getActivity() != null) {
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    private JSObject extractPayload(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if ((sharedText == null || sharedText.trim().isEmpty())
                    && (sharedTitle == null || sharedTitle.trim().isEmpty())) {
                return null;
            }
            JSObject out = new JSObject();
            out.put("text", sharedText != null ? sharedText : "");
            out.put("title", sharedTitle != null ? sharedTitle : "");
            out.put("url", "");
            return out;
        }
        if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            if (data == null) return null;
            JSObject out = new JSObject();
            out.put("url", data.toString());
            out.put("text", "");
            out.put("title", "");
            return out;
        }
        return null;
    }
}
