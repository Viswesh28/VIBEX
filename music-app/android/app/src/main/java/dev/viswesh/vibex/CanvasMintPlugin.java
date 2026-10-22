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

import java.net.HttpURLConnection;
import java.net.URL;

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
 * <p>The WebView is a mint, not a player: it loads one watch page offscreen,
 * hands back the player response, and is reused for the next track. It never
 * plays audio; audio stays with the native player.
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

    /**
     * Injected as early as the platform lets us, before the page's own player
     * script builds its loaders.
     *
     * The point is not to scrape: the page's player already does the signature
     * decipher and the `n` transform, and those requests are what carry a URL
     * this device is allowed to use. Wrapping `XMLHttpRequest`/`fetch`/`addSourceBuffer`
     * lets us read them. Reading `video.src` does *not* work here, because the
     * player feeds a MediaSource and the element carries a `blob:` URL.
     */
    private static final String SHIM_JS =
            "(function(){"
                    + "if(window.__vibexMint){return;}window.__vibexMint=1;"
                    + "var hits=[];window.__vibexHits=hits;"
                    + "var mse=[];window.__vibexMse=mse;"
                    + "var keep=function(u){try{"
                    + "u=String(u);"
                    + "if(u.indexOf('googlevideo.com/videoplayback')<0){return;}"
                    + "if(hits[hits.length-1]!==u){hits.push(u);}"
                    + "if(hits.length>300){hits.shift();}"
                    + "}catch(e){}};"
                    + "var xo=XMLHttpRequest.prototype.open;"
                    + "XMLHttpRequest.prototype.open=function(m,u){keep(u);"
                    + "return xo.apply(this,arguments);};"
                    + "var f=window.fetch;"
                    + "if(f){window.fetch=function(i){keep((i&&i.url)||i);"
                    + "return f.apply(this,arguments);};}"
                    + "if(window.MediaSource){"
                    + "var asb=MediaSource.prototype.addSourceBuffer;"
                    + "MediaSource.prototype.addSourceBuffer=function(m){"
                    + "try{mse.push(String(m));}catch(e){}"
                    + "return asb.apply(this,arguments);};}"
                    + "})()";

    /**
     * What the page was told about the track, before it plays anything.
     *
     * This is the cheap path and usually enough: a player response that still
     * carries direct `url`s in `adaptiveFormats` needs no playback at all.
     */
    private static final String FORMATS_JS =
            "(function(){"
                    + "var pr=window.ytInitialPlayerResponse;"
                    + "var body=(document.body&&document.body.innerText)||'';"
                    + "var blocked=/confirm you.{0,3}re not a bot|Sign in to confirm|Before you continue/i.test(body);"
                    + "var ps=(pr&&pr.playabilityStatus&&pr.playabilityStatus.status)||'';"
                    + "if(blocked||/LOGIN_REQUIRED|AGE_CHECK/i.test(ps)){"
                    + "return JSON.stringify({ok:false,blocked:blocked,why:'bot_challenge'});}"
                    + "var sd=pr&&pr.streamingData;"
                    + "if(!sd){return JSON.stringify({ok:false,why:'no_player_response'});}"
                    + "var all=(sd.adaptiveFormats||[]).concat(sd.formats||[]);"
                    + "var audio=all.filter(function(f){"
                    + "return f&&f.mimeType&&f.mimeType.indexOf('audio/')===0&&f.url;});"
                    + "if(!audio.length){return JSON.stringify({ok:false,why:'no_direct_audio'});}"
                    + "var want=[251,250,249,140,139];var pick=null;"
                    + "for(var i=0;i<want.length&&!pick;i++){"
                    + "for(var j=0;j<audio.length;j++){"
                    + "if(Number(audio[j].itag)===want[i]){pick=audio[j];break;}}}"
                    + "if(!pick){audio.sort(function(a,b){return (b.bitrate||0)-(a.bitrate||0);});"
                    + "pick=audio[0];}"
                    + "return JSON.stringify({ok:true,url:pick.url,itag:pick.itag,"
                    + "mime:pick.mimeType,bitrate:pick.bitrate||0,"
                    + "clen:Number(pick.contentLength)||0,"
                    + "durationMs:(Number(pr.videoDetails&&pr.videoDetails.lengthSeconds)||0)*1000});"
                    + "})()";

    /** Reads what the shim saw, once the page has actually started fetching. */
    private static final String CAPTURED_JS =
            "(function(){"
                    + "var hits=window.__vibexHits||[];"
                    + "if(!hits.length){return JSON.stringify({ok:false,why:'no_hits'});}"
                    + "var itag=function(u){var m=/[?&]itag=(\\d+)/.exec(u);return m?Number(m[1]):-1;};"
                    + "var audio=[251,250,249,140,139];"
                    + "var pool=hits.filter(function(u){return audio.indexOf(itag(u))>=0;});"
                    + "if(!pool.length){return JSON.stringify({ok:false,why:'no_direct_audio'});}"
                    + "var pick=pool[0];"
                    + "for(var i=0;i<audio.length;i++){"
                    + "for(var j=0;j<pool.length;j++){"
                    + "if(itag(pool[j])===audio[i]){pick=pool[j];break;}}}"
                    + "return JSON.stringify({ok:true,url:pick,itag:itag(pick),mime:'audio/webm'});"
                    + "})()";

    /** Muted, because the page must fetch, not be heard. */
    private static final String PLAY_JS =
            "(function(){"
                    + "var v=document.querySelector('video');"
                    + "if(!v){return 'no_video_element';}"
                    + "v.muted=true;v.volume=0;"
                    + "try{v.play();}catch(e){}"
                    + "return 'playing';"
                    + "})()";

    /**
     * How much of the file will this signature actually serve?
     *
     * A preview answers a one-byte range with a `Content-Range` total that is a
     * fraction of the real length, and 403s on the tail. Both numbers go back to
     * JS, where the verdict is decided and unit-tested — this method only makes
     * the two requests.
     */
    private JSObject probe(String url) {
        JSObject out = new JSObject();
        try {
            HttpURLConnection head = ranged(url, "bytes=0-0");
            try {
                // Status and headers only. The body is one byte and is never
                // read: this asks the server what it will serve, not for audio.
                out.put("headStatus", head.getResponseCode());
                String range = head.getHeaderField("Content-Range");
                if (range != null) out.put("contentRange", range);
                long total = totalFrom(range);
                if (total <= 0) return out;
                HttpURLConnection tail = ranged(url, "bytes=" + Math.max(0, total - 1024) + "-" + (total - 1));
                try {
                    // A preview URL answers 403 exactly here.
                    out.put("tailStatus", tail.getResponseCode());
                } finally {
                    tail.disconnect();
                }
            } finally {
                head.disconnect();
            }
            return out;
        } catch (Exception e) {
            out.put("error", String.valueOf(e.getMessage()));
            return out;
        }
    }

    private HttpURLConnection ranged(String url, String range) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("GET");
        c.setRequestProperty("Range", range);
        c.setRequestProperty("User-Agent", UA);
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        c.setInstanceFollowRedirects(true);
        // No getInputStream(): that is what turns a 403 into an IOException and
        // loses the status code we are asking for.
        return c;
    }

    private static long totalFrom(String contentRange) {
        if (contentRange == null) return -1;
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("bytes\\s+\\d+-\\d+/(\\d+)").matcher(contentRange);
        return m.find() ? Long.parseLong(m.group(1)) : -1;
    }

    private WebView webView;
    private PluginCall pending;
    private String pendingVideoId;
    private String pendingQuery;
    /** search → watch → harvest; the search step is skipped for a known id. */
    private String stage = STAGE_SEARCH;
    /** True while the pending call is a stream mint, not a canvas mint. */
    private boolean streamMode = false;
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
        pendingVideoId = videoId;
        pendingQuery = query;

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

    /**
     * Mint a playable audio URL for one video id.
     *
     * Same WebView, different question. Two paths, cheap then reliable:
     *
     * 1. `ytInitialPlayerResponse.adaptiveFormats` — a response that still
     *    carries direct URLs needs no playback at all.
     * 2. The shim's captures, after the page has fetched a segment itself.
     *    This is the path that works when the response is cipher-only, because
     *    the URL the page fetched already carries the deciphered signature and
     *    the transformed `n`.
     *
     * Either way the URL is range-probed before it is returned: the JS side
     * refuses anything it cannot verify, but the numbers come from here.
     */
    @PluginMethod
    public void mintStream(PluginCall call) {
        String videoId = call.getString("videoId");
        if (videoId == null || !videoId.matches("[A-Za-z0-9_-]{11}")) {
            call.reject("a valid videoId is required");
            return;
        }
        if (pending != null) {
            call.reject("busy");
            return;
        }
        pending = call;
        pendingVideoId = videoId;
        streamMode = true;

        getActivity().runOnUiThread(() -> {
            try {
                ensureWebView();
                handler.postDelayed(timeout, STREAM_TIMEOUT_MS);
                stage = STAGE_STREAM;
                webView.loadUrl(watchUrl(videoId));
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
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(UA);
        view.setBackgroundColor(Color.TRANSPARENT);
        view.setAlpha(0f);
        view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

        ViewGroup root = getActivity().findViewById(android.R.id.content);
        // 1x1 and transparent: present enough to run, invisible enough to forget.
        root.addView(view, new ViewGroup.LayoutParams(1, 1));

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                // Earliest hook the platform gives us without pulling in
                // androidx.webkit's DOCUMENT_START_SCRIPT. Best effort by
                // nature: if a request beats the injection, path 1 covers it.
                if (streamMode) v.evaluateJavascript(SHIM_JS, null);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                // The page announces itself before its data is usable, so give
                // the player response a moment to be assigned.
                if (STAGE_SEARCH.equals(stage)) handler.postDelayed(() -> resolveId(v), 700);
                else if (streamMode) handler.postDelayed(() -> harvestStream(v), 1200);
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
            pendingVideoId = id;
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
     * Ask the page for a stream, cheaply first.
     *
     * `resolveFrom(page)` may answer `no_direct_audio`; only then is the page
     * allowed to play, and only muted. A page that never fetches anything is
     * reported as such rather than retried in a loop.
     */
    private void harvestStream(WebView v) {
        if (pending == null) return;
        v.evaluateJavascript(FORMATS_JS, direct -> {
            if (pending == null) return;
            JSObject parsed = parse(direct);
            if (parsed != null && Boolean.TRUE.equals(parsed.getBool("ok"))) {
                validateAndFinish(parsed);
                return;
            }
            if (parsed != null && Boolean.TRUE.equals(parsed.getBool("blocked"))) {
                finish(parsed);
                return;
            }
            // Cipher-only response: let the page do the work it is good at.
            v.evaluateJavascript(PLAY_JS, ignored -> handler.postDelayed(() -> captured(v), 1600));
        });
    }

    private void captured(WebView v) {
        if (pending == null) return;
        v.evaluateJavascript(CAPTURED_JS, raw -> {
            if (pending == null) return;
            JSObject parsed = parse(raw);
            if (parsed == null || !Boolean.TRUE.equals(parsed.getBool("ok"))) {
                finish(parsed == null ? failure("bad_payload") : parsed);
                return;
            }
            validateAndFinish(parsed);
        });
    }

    /** Range-probe off the UI thread, then resolve with the numbers. */
    private void validateAndFinish(JSObject minted) {
        String url = minted.getString("url");
        if (url == null || url.isEmpty()) {
            finish(failure("no_url"));
            return;
        }
        new Thread(() -> {
            // Flattened deliberately: JSObject's typed put() overloads are the
            // only ones that cannot throw, and the JS side reassembles this.
            JSObject probe = probe(url);
            Integer headStatus = probe.getInteger("headStatus");
            Integer tailStatus = probe.getInteger("tailStatus");
            if (headStatus != null) minted.put("headStatus", headStatus);
            if (tailStatus != null) minted.put("tailStatus", tailStatus);
            String range = probe.getString("contentRange");
            if (range != null) minted.put("contentRange", range);
            handler.post(() -> finish(minted));
        }, "vibex-stream-probe").start();
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
        pendingVideoId = null;
        pendingQuery = null;
        streamMode = false;
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
    private static final String STAGE_STREAM = "stream";
    /** A cold mint plus two probe round-trips; past this, fall back. */
    private static final long STREAM_TIMEOUT_MS = 18_000L;

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
