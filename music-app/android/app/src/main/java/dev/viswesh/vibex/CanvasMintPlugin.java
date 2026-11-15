package dev.viswesh.vibex;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Mints a canvas URL from a real YouTube page, on the device.
 *
 * <p>The server-side lookup cannot work: YouTube will not describe a music
 * track to a client without a signed-in session, and a serverless function has
 * none (see docs/adr/0001). A real page is not gated that way — it is a normal
 * client on the listener's connection, running YouTube's own script — so the
 * page is asked what it already resolved.
 *
 * <p>The WebView is a canvas metadata lookup only, never an audio extractor or
 * player (see docs/adr/0002 and docs/adr/0007): it loads one watch page
 * offscreen, reads {@code ytInitialPlayerResponse} for canvas artwork loops,
 * pauses immediately, and is reused for the next track. It never captures
 * audio streams, never reads cookies, and never plays media.
 *
 * <p>One warm instance per app session. A WebView costs on the order of 100 MB
 * and a cold start, so creating one per track would be felt as a broken app.
 *
 * <p>This class is the only piece of the canvas feature that cannot be built or
 * tested in CI from this repository — it needs the Android SDK. Keep it small
 * and boring for that reason.
 */
@CapacitorPlugin(name = "CanvasMint")
public class CanvasMintPlugin extends Plugin {

    /** Desktop Chrome, matching what a normal browser sends the page. */
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/124.0.0.0 Mobile Safari/537.36";

    /** A cold page needs a few seconds; past this, artwork is the better answer. */
    private static final long TIMEOUT_MS = 12_000L;

    /** Above this the bridge transfer is not worth it; the caller gets a reason. */
    private static final int MAX_CHARS = 4_000_000;

    /**
     * Find the track's video id in a search page.
     *
     * The catalogue has no YouTube ids, so the page has to resolve the query
     * itself. First `videoId` in the results is the same choice the server-side
     * lookup made; ordering is handled on the JS side, once.
     */
    private static final String SEARCH_JS =
            "(function(){"
                    + "var d=window.ytInitialData;"
                    + "if(!d){return '';}"
                    + "var m=/\\\"videoId\\\":\\\"([A-Za-z0-9_-]{11})\\\"/.exec(JSON.stringify(d));"
                    + "return m?m[1]:'';"
                    + "})()";

    /**
     * Returns the page's own player response. Reading `ytInitialPlayerResponse`
     * is enough for the canvas: the canvas is part of what the page was told
     * about the track, so no playback and no video element are needed.
     */
    private static final String HARVEST_JS =
            "(function(){"
                    + "var pr=window.ytInitialPlayerResponse;"
                    + "var body=(document.body&&document.body.innerText)||'';"
                    + "var blocked=/confirm you.{0,3}re not a bot|Sign in to confirm|Before you continue/i.test(body);"
                    + "if(!pr){return JSON.stringify({ok:false,blocked:blocked,"
                    + "why:blocked?'bot_challenge':'no_player_response'});}"
                    + "var ps=(pr.playabilityStatus&&pr.playabilityStatus.status)||'';"
                    + "var json=JSON.stringify(pr);"
                    + "return JSON.stringify({ok:true,blocked:blocked,"
                    + "blockReason:(pr.playabilityStatus&&pr.playabilityStatus.reason)||ps,"
                    + "playability:ps,length:json.length,response:json});"
                    + "})()";

    private WebView webView;
    private PluginCall pending;
    private String stage = STAGE_SEARCH;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> finish(failure("timeout"));

    @PluginMethod
    public void mint(PluginCall call) {
        String videoId = call.getString("videoId");
        String query = call.getString("query");
        if ((videoId == null || videoId.isEmpty()) && (query == null || query.isEmpty())) {
            call.reject("videoId or query is required");
            return;
        }
        if (pending != null) {
            // One mint at a time: a second page load would only slow both down.
            call.reject("busy");
            return;
        }
        pending = call;

        getActivity().runOnUiThread(() -> {
            try {
                ensureWebView();
                handler.postDelayed(timeout, TIMEOUT_MS);
                if (videoId != null && !videoId.isEmpty()) {
                    stage = STAGE_WATCH;
                    webView.loadUrl(watchUrl(videoId));
                } else {
                    stage = STAGE_SEARCH;
                    webView.loadUrl(searchUrl(query));
                }
            } catch (Exception e) {
                finish(failure("webview_error"));
            }
        });
    }

    private static String watchUrl(String videoId) {
        return "https://music.youtube.com/watch?v=" + videoId + "&hl=en&gl=US";
    }

    private static String searchUrl(String query) {
        try {
            return "https://music.youtube.com/search?q="
                    + java.net.URLEncoder.encode(query, "UTF-8")
                    + "&hl=en&gl=US";
        } catch (Exception e) {
            return "https://music.youtube.com/search?q=" + query;
        }
    }

    /** Tear the page down; the next mint builds a fresh one. */
    @PluginMethod
    public void dispose(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            destroyWebView();
            call.resolve();
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void ensureWebView() {
        if (webView != null) return;

        WebView view = new WebView(getContext());
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(UA);
        view.setBackgroundColor(Color.TRANSPARENT);
        view.setAlpha(0f);
        view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

        ViewGroup root = getActivity().findViewById(android.R.id.content);
        // 1x1 and transparent: present enough to run, invisible enough to forget.
        root.addView(view, new ViewGroup.LayoutParams(1, 1));

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String url) {
                // The page announces itself before its data is usable, so give
                // the player response a moment to be assigned.
                if (STAGE_SEARCH.equals(stage)) handler.postDelayed(() -> resolveId(v), 700);
                else handler.postDelayed(() -> evaluate(v), 700);
            }
        });

        webView = view;
    }

    /** Search page → first result's video id → the watch page. */
    private void resolveId(WebView v) {
        if (pending == null) return;
        v.evaluateJavascript(SEARCH_JS, value -> {
            if (pending == null) return;
            String id = value == null ? "" : value.replace("\"", "").trim();
            if (!id.matches("[A-Za-z0-9_-]{11}")) {
                finish(failure("no_results"));
                return;
            }
            stage = STAGE_WATCH;
            v.loadUrl(watchUrl(id));
        });
    }

    private void evaluate(WebView v) {
        if (pending == null) return;
        v.evaluateJavascript(HARVEST_JS, value -> {
            if (pending == null) return;
            JSObject result = parse(value);
            if (result == null) {
                finish(failure("bad_payload"));
                return;
            }
            finish(result);
        });
    }

    /**
     * `evaluateJavascript` hands back a JSON-encoded value: the JS returned a
     * string, so this is a quoted string containing JSON. Unwrap it once.
     */
    private JSObject parse(String raw) {
        if (raw == null || raw.isEmpty() || "null".equals(raw)) return null;
        try {
            String inner = raw;
            if (inner.length() > 1 && inner.charAt(0) == '"') {
                inner = new org.json.JSONArray("[" + inner + "]").getString(0);
            }
            JSObject obj = JSObject.fromJSONObject(new org.json.JSONObject(inner));
            Number length = obj.getInteger("length");
            if (length != null && length.intValue() > MAX_CHARS) return failure("response_too_large");
            return obj;
        } catch (Exception e) {
            return null;
        }
    }

    private void finish(JSObject result) {
        handler.removeCallbacks(timeout);
        PluginCall call = pending;
        pending = null;
        stage = STAGE_SEARCH;
        if (call == null) return;
        call.resolve(result);
        // Idle now: stop timers so a parked WebView costs no battery.
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
    }

    private static final String STAGE_SEARCH = "search";
    private static final String STAGE_WATCH = "watch";

    private JSObject failure(String why) {
        JSObject o = new JSObject();
        o.put("ok", false);
        o.put("why", why);
        return o;
    }

    private void destroyWebView() {
        handler.removeCallbacks(timeout);
        if (webView == null) return;
        try {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.stopLoading();
            webView.destroy();
        } catch (Exception ignored) {
            // A WebView that fails to tear down must not take the app with it.
        }
        webView = null;
    }

    @Override
    protected void handleOnDestroy() {
        destroyWebView();
        super.handleOnDestroy();
    }
}
