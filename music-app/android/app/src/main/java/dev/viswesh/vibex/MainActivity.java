package dev.viswesh.vibex;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * Main native Android host Activity for VIBEX (`dev.viswesh.vibex`).
 *
 * Hosts a full-bleed 120Hz hardware-accelerated `BackgroundAudioWebView` backed by
 * `VibexLocalServer`, `PlaybackService`, OS `ACTION_SEND` / `ACTION_VIEW` Share Sheet
 * routing, `DownloadManager` integration, and non-destructive gesture Back navigation.
 */
public class MainActivity extends Activity {

    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);

    private BackgroundAudioWebView webView;
    private volatile String pendingShareJson = null;
    private volatile boolean pageLoaded = false;
    private OnBackInvokedCallback backInvokedCallback;

    /**
     * Custom WebView subclass that keeps Chromium timers, WebAudio 10-band EQ, crossfades,
     * and track-end auto-advance active when the phone screen is turned off or locked.
     */
    public static final class BackgroundAudioWebView extends WebView {
        public BackgroundAudioWebView(Context context) {
            super(context);
        }

        @Override
        protected void onWindowVisibilityChanged(int visibility) {
            if (visibility != View.GONE && visibility != View.INVISIBLE) {
                super.onWindowVisibilityChanged(visibility);
            } else {
                super.onWindowVisibilityChanged(View.VISIBLE);
            }
        }
    }

    public static void dispatchMediaAction(final String action, final long positionMs, final long offsetMs) {
        MainActivity act = activeInstance.get();
        if (act == null) return;
        act.runOnUiThread(() -> {
            if (act.webView == null) return;
            try {
                JSONObject detail = new JSONObject();
                detail.put("action", action);
                if (positionMs >= 0L) detail.put("positionMs", positionMs);
                if (offsetMs != 0L) detail.put("offsetMs", offsetMs);
                String js = "window.dispatchEvent(new CustomEvent('vibex:native-media-action',{detail:"
                        + detail.toString() + "}));";
                act.webView.evaluateJavascript(js, null);
            } catch (Throwable ignored) {
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = new WeakReference<>(this);

        configureSystemBars();
        captureIncomingIntent(getIntent(), false);

        VibexLocalServer localServer = VibexLocalServer.ensureStarted(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0b0f"));

        webView = new BackgroundAudioWebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0b0f"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " VIBEXAndroid/3.2.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new VibexBridge(this), "VibexAndroid");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("127.0.0.1".equals(host) || "localhost".equals(host)) {
                    return false;
                }
                if ("vibex".equalsIgnoreCase(scheme)) {
                    emitSharePayload(uri.toString(), "", "");
                    return true;
                }
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        Intent browser = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(browser);
                    } catch (Throwable ignored) {
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                flushPendingShareToJs();
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                if (url == null || url.startsWith("blob:") || url.startsWith("data:")) return;
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm == null) return;
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setMimeType(mimetype);
                req.setTitle(fileName);
                req.setDescription("Downloading track in VIBEX");
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_MUSIC, "VIBEX/" + fileName);
                dm.enqueue(req);
            } catch (Throwable ignored) {
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        registerPredictiveBack();
        requestPostNotificationsIfNeeded();

        webView.loadUrl(localServer.getBaseUrl() + "/");
    }

    private void configureSystemBars() {
        Window window = getWindow();
        if (window == null) return;
        int obsidian = Color.parseColor("#0b0b0f");
        window.setStatusBarColor(obsidian);
        window.setNavigationBarColor(obsidian);
    }

    private void requestPostNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9100);
            }
        }
    }

    private void registerPredictiveBack() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backInvokedCallback = this::dispatchBackToWebApp;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    backInvokedCallback);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        dispatchBackToWebApp();
    }

    private void dispatchBackToWebApp() {
        if (webView != null && pageLoaded) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('vibex:native-back'));",
                    null);
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIncomingIntent(intent, true);
    }

    private void captureIncomingIntent(Intent intent, boolean dispatchImmediately) {
        if (intent == null) return;
        String action = intent.getAction();
        String url = "";
        String text = "";
        String title = "";

        if (Intent.ACTION_SEND.equals(action)) {
            CharSequence extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            CharSequence extraSubj = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            text = extraText != null ? extraText.toString() : "";
            title = extraSubj != null ? extraSubj.toString() : "";
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            url = intent.getData().toString();
        }

        if (url.isEmpty() && text.isEmpty() && title.isEmpty()) return;

        if (dispatchImmediately && pageLoaded && webView != null) {
            emitSharePayload(url, text, title);
        } else {
            try {
                JSONObject obj = new JSONObject();
                obj.put("url", url);
                obj.put("text", text);
                obj.put("title", title);
                pendingShareJson = obj.toString();
            } catch (Throwable ignored) {
            }
        }
    }

    public String consumePendingShareJson() {
        String snap = pendingShareJson;
        pendingShareJson = null;
        return snap != null ? snap : "";
    }

    private void flushPendingShareToJs() {
        String snap = pendingShareJson;
        if (snap == null || snap.isEmpty() || webView == null) return;
        pendingShareJson = null;
        webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('vibex:native-share',{detail:" + snap + "}));",
                null);
    }

    private void emitSharePayload(String url, String text, String title) {
        if (webView == null) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("url", url != null ? url : "");
            obj.put("text", text != null ? text : "");
            obj.put("title", title != null ? title : "");
            final String json = obj.toString();
            runOnUiThread(() -> webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('vibex:native-share',{detail:" + json + "}));",
                    null));
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            } catch (Throwable ignored) {
            }
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
