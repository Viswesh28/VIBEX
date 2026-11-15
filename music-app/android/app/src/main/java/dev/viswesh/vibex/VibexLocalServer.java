package dev.viswesh.vibex;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * High-speed local loopback HTTP/Range server (`http://127.0.0.1:45821`).
 *
 * Why a real loopback socket outperforms `shouldInterceptRequest`:
 *  1. `http://127.0.0.1:45821` is a deterministic W3C Secure Context (`isSecureContext === true`)
 *     so `localStorage`, `IndexedDB` Offline Vault, Service Workers, Web Crypto PKCE, and
 *     Supabase Cloud Sync sessions persist across every app restart permanently.
 *  2. Full HTTP/1.1 `206 Partial Content` byte-range streaming works natively with Chromium's
 *     hardware `<audio>` decoder AND WebAudio `AudioContext` 10-band Studio EQ without CORS taint.
 *  3. Bundled `assets/www/*` loads in < 1 ms even completely offline in Airplane Mode.
 */
public final class VibexLocalServer {

    private static final int[] PREFERRED_PORTS = {45821, 45822, 45823, 45824, 45825};
    private static VibexLocalServer instance;

    private final Context appContext;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket serverSocket;
    private volatile boolean running = false;
    private int boundPort = 0;

    private VibexLocalServer(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static synchronized VibexLocalServer ensureStarted(Context context) {
        if (instance != null && instance.running && instance.serverSocket != null && !instance.serverSocket.isClosed()) {
            return instance;
        }
        instance = new VibexLocalServer(context);
        instance.start();
        return instance;
    }

    public String getBaseUrl() {
        return "http://127.0.0.1:" + boundPort;
    }

    private void start() {
        try {
            InetAddress loopback = InetAddress.getByName("127.0.0.1");
            for (int candidate : PREFERRED_PORTS) {
                try {
                    ServerSocket ss = new ServerSocket(candidate, 128, loopback);
                    ss.setReuseAddress(true);
                    this.serverSocket = ss;
                    this.boundPort = candidate;
                    break;
                } catch (Throwable ignored) {
                }
            }
            if (this.serverSocket == null) {
                this.serverSocket = new ServerSocket(0, 128, loopback);
                this.boundPort = this.serverSocket.getLocalPort();
            }
            this.running = true;
            Thread acceptThread = new Thread(this::acceptLoop, "vibex-loopback-accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
        } catch (Throwable ignored) {
        }
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket client = serverSocket.accept();
                client.setTcpNoDelay(true);
                client.setSoTimeout(30_000);
                pool.execute(() -> handleClient(client));
            } catch (Throwable ignored) {
            }
        }
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket;
             InputStream rawIn = new BufferedInputStream(s.getInputStream());
             OutputStream out = s.getOutputStream()) {

            String requestLine = readAsciiLine(rawIn);
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.US);
            String fullTarget = parts[1];

            Map<String, String> reqHeaders = new HashMap<>();
            String line;
            int contentLength = 0;
            while ((line = readAsciiLine(rawIn)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String k = line.substring(0, colon).trim().toLowerCase(Locale.US);
                    String v = line.substring(colon + 1).trim();
                    reqHeaders.put(k, v);
                    if ("content-length".equals(k)) {
                        try {
                            contentLength = Integer.parseInt(v);
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }

            byte[] reqBody = null;
            if (contentLength > 0 && contentLength <= 2 * 1024 * 1024) {
                reqBody = new byte[contentLength];
                int readTotal = 0;
                while (readTotal < contentLength) {
                    int n = rawIn.read(reqBody, readTotal, contentLength - readTotal);
                    if (n <= 0) break;
                    readTotal += n;
                }
            }

            if ("OPTIONS".equals(method)) {
                writeHeaders(out, "204 No Content", "text/plain", 0, null);
                out.flush();
                return;
            }

            int qIdx = fullTarget.indexOf('?');
            String rawPath = qIdx >= 0 ? fullTarget.substring(0, qIdx) : fullTarget;
            String query = qIdx >= 0 ? fullTarget.substring(qIdx + 1) : "";

            if ("/api/ytaudio".equals(rawPath)) {
                handleYoutubeAudio(method, fullTarget, query, reqHeaders, out);
                return;
            }

            if (rawPath.startsWith("/api/") || "/dl".equals(rawPath) || "/download/vibex.apk".equals(rawPath)) {
                proxyToCloud(method, fullTarget, reqHeaders, reqBody, out);
                return;
            }

            serveBundledAsset(method, rawPath, reqHeaders, out);
        } catch (Throwable ignored) {
        }
    }

    private void handleYoutubeAudio(
            String method,
            String fullTarget,
            String query,
            Map<String, String> reqHeaders,
            OutputStream out) throws Exception {
        Uri parsed = Uri.parse("http://localhost/api/ytaudio" + (query.isEmpty() ? "" : "?" + query));
        String videoId = parsed.getQueryParameter("id");
        String meta = parsed.getQueryParameter("meta");
        String title = parsed.getQueryParameter("title");
        String artist = parsed.getQueryParameter("artist");

        YoutubeAudioExtractor.StreamInfo info = YoutubeAudioExtractor.resolve(videoId, title, artist);

        if ("1".equals(meta)) {
            JSONObject resp = new JSONObject();
            JSONObject data = new JSONObject();
            if (info != null) {
                resp.put("success", true);
                data.put("playable", true);
                data.put("videoId", info.videoId);
                data.put("mimeType", info.mimeType);
                data.put("quality", info.quality);
                data.put("duration", info.durationSec);
                data.put("source", info.source);
            } else {
                resp.put("success", true);
                data.put("playable", false);
                data.put("videoId", videoId != null ? videoId : "");
            }
            resp.put("data", data);
            byte[] jsonBytes = resp.toString().getBytes(StandardCharsets.UTF_8);
            Map<String, String> extra = new HashMap<>();
            extra.put("Cache-Control", "no-store");
            writeHeaders(out, "200 OK", "application/json; charset=utf-8", jsonBytes.length, extra);
            if (!"HEAD".equals(method)) {
                out.write(jsonBytes);
            }
            out.flush();
            return;
        }

        // Stream direct residential-IP audio when available; fall back to cloud OMV bridge automatically
        if (info != null && info.directUrl != null) {
            if (streamRemoteMedia(method, info.directUrl, info.userAgent, info.mimeType, reqHeaders, out)) {
                return;
            }
            YoutubeAudioExtractor.invalidate(videoId);
        }

        proxyToCloud(method, fullTarget, reqHeaders, null, out);
    }

    private boolean streamRemoteMedia(
            String method,
            String remoteUrl,
            String userAgent,
            String fallbackMime,
            Map<String, String> reqHeaders,
            OutputStream out) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(remoteUrl).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("HEAD".equals(method) ? "HEAD" : "GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(20_000);
            conn.setRequestProperty("User-Agent", userAgent != null ? userAgent : "VIBEX-Android/3.2.0");
            String range = reqHeaders.get("range");
            if (range != null && !range.isEmpty()) {
                conn.setRequestProperty("Range", range);
            }

            int status = conn.getResponseCode();
            if (status != 200 && status != 206) {
                return false;
            }

            String ct = conn.getContentType();
            if (ct == null || ct.isEmpty()) ct = fallbackMime;
            long len = conn.getContentLengthLong();
            Map<String, String> extra = new HashMap<>();
            extra.put("Accept-Ranges", "bytes");
            String contentRange = conn.getHeaderField("Content-Range");
            if (contentRange != null) extra.put("Content-Range", contentRange);
            extra.put("Cache-Control", "private, max-age=300");

            writeHeaders(out, status == 206 ? "206 Partial Content" : "200 OK", ct, len, extra);
            if (!"HEAD".equals(method)) {
                try (InputStream mediaIn = conn.getInputStream()) {
                    byte[] buf = new byte[32 * 1024];
                    int n;
                    while ((n = mediaIn.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
            }
            out.flush();
            return true;
        } catch (Throwable ignored) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void proxyToCloud(
            String method,
            String fullTarget,
            Map<String, String> reqHeaders,
            byte[] reqBody,
            OutputStream out) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL target = new URL(YoutubeAudioExtractor.CLOUD_ORIGIN + fullTarget);
            conn = (HttpURLConnection) target.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod(method);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(25_000);
            conn.setRequestProperty("User-Agent", "VIBEX-Android/3.2.0");

            String[] forwardNames = {"accept", "content-type", "range", "authorization", "x-youtube-api-key"};
            for (String h : forwardNames) {
                String v = reqHeaders.get(h);
                if (v != null && !v.isEmpty()) {
                    conn.setRequestProperty(h, v);
                }
            }

            if (reqBody != null && reqBody.length > 0 && !"GET".equals(method) && !"HEAD".equals(method)) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(reqBody.length);
                try (OutputStream reqOut = conn.getOutputStream()) {
                    reqOut.write(reqBody);
                }
            }

            int code = conn.getResponseCode();
            String msg = conn.getResponseMessage();
            String statusText = code + " " + (msg != null ? msg : "OK");
            String ct = conn.getContentType();
            if (ct == null || ct.isEmpty()) ct = "application/octet-stream";
            long len = conn.getContentLengthLong();

            Map<String, String> extra = new HashMap<>();
            for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                String key = entry.getKey();
                if (key == null || entry.getValue() == null || entry.getValue().isEmpty()) continue;
                String low = key.toLowerCase(Locale.US);
                if ("content-range".equals(low)
                        || "accept-ranges".equals(low)
                        || "content-disposition".equals(low)
                        || "cache-control".equals(low)) {
                    extra.put(key, entry.getValue().get(0));
                }
            }

            InputStream bodyStream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            writeHeaders(out, statusText, ct, len, extra);
            if (!"HEAD".equals(method) && bodyStream != null) {
                try (InputStream in = bodyStream) {
                    byte[] buf = new byte[32 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
            }
            out.flush();
        } catch (Throwable err) {
            byte[] fallback = "{\"success\":false,\"message\":\"Network unavailable.\"}".getBytes(StandardCharsets.UTF_8);
            writeHeaders(out, "503 Service Unavailable", "application/json; charset=utf-8", fallback.length, null);
            if (!"HEAD".equals(method)) {
                out.write(fallback);
            }
            out.flush();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void serveBundledAsset(
            String method,
            String rawPath,
            Map<String, String> reqHeaders,
            OutputStream out) throws Exception {
        AssetManager assets = appContext.getAssets();
        String rel = Uri.decode(rawPath);
        if (rel == null || rel.isEmpty() || "/".equals(rel)) {
            rel = "/index.html";
        }
        while (rel.startsWith("/")) {
            rel = rel.substring(1);
        }

        byte[] data = readAssetBytes(assets, "www/" + rel);
        String mime = guessMime(rel);

        // SPA fallback for client routes (`/artist/*`, `/album/*`, `/playlist/*`, `/search`, `/library`)
        if (data == null && !rel.contains(".")) {
            data = readAssetBytes(assets, "www/index.html");
            mime = "text/html; charset=utf-8";
        }

        if (data == null) {
            byte[] missing = "Not found".getBytes(StandardCharsets.UTF_8);
            writeHeaders(out, "404 Not Found", "text/plain; charset=utf-8", missing.length, null);
            if (!"HEAD".equals(method)) out.write(missing);
            out.flush();
            return;
        }

        Map<String, String> extra = new HashMap<>();
        extra.put("Accept-Ranges", "bytes");
        if (rel.startsWith("assets/")) {
            extra.put("Cache-Control", "public, max-age=31536000, immutable");
        } else {
            extra.put("Cache-Control", "no-cache");
        }

        String range = reqHeaders.get("range");
        if (range != null && range.startsWith("bytes=") && data.length > 0) {
            int dash = range.indexOf('-', 6);
            if (dash > 0) {
                try {
                    String sPart = range.substring(6, dash).trim();
                    String ePart = range.substring(dash + 1).trim();
                    int start = sPart.isEmpty() ? 0 : Integer.parseInt(sPart);
                    int end = ePart.isEmpty() ? (data.length - 1) : Math.min(data.length - 1, Integer.parseInt(ePart));
                    if (start >= 0 && start <= end && start < data.length) {
                        int sliceLen = end - start + 1;
                        extra.put("Content-Range", "bytes " + start + "-" + end + "/" + data.length);
                        writeHeaders(out, "206 Partial Content", mime, sliceLen, extra);
                        if (!"HEAD".equals(method)) {
                            out.write(data, start, sliceLen);
                        }
                        out.flush();
                        return;
                    }
                } catch (NumberFormatException ignored) {
                }
            }
        }

        writeHeaders(out, "200 OK", mime, data.length, extra);
        if (!"HEAD".equals(method)) {
            out.write(data);
        }
        out.flush();
    }

    private static byte[] readAssetBytes(AssetManager assets, String path) {
        try (InputStream is = assets.open(path);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static void writeHeaders(
            OutputStream out,
            String status,
            String contentType,
            long contentLength,
            Map<String, String> extra) throws Exception {
        StringBuilder sb = new StringBuilder(256);
        sb.append("HTTP/1.1 ").append(status).append("\r\n");
        sb.append("Content-Type: ").append(contentType).append("\r\n");
        if (contentLength >= 0) {
            sb.append("Content-Length: ").append(contentLength).append("\r\n");
        }
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n");
        sb.append("Access-Control-Allow-Headers: accept, content-type, range, authorization, x-youtube-api-key\r\n");
        sb.append("Connection: close\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> e : extra.entrySet()) {
                sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
    }

    private static String readAsciiLine(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(128);
        int b;
        boolean sawByte = false;
        while ((b = in.read()) != -1) {
            sawByte = true;
            if (b == '\n') break;
            if (b != '\r') bos.write(b);
            if (bos.size() > 16_384) break;
        }
        if (!sawByte && bos.size() == 0) return null;
        return bos.toString("ISO-8859-1");
    }

    private static String guessMime(String path) {
        String low = path.toLowerCase(Locale.US);
        if (low.endsWith(".html")) return "text/html; charset=utf-8";
        if (low.endsWith(".js") || low.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (low.endsWith(".css")) return "text/css; charset=utf-8";
        if (low.endsWith(".json")) return "application/json; charset=utf-8";
        if (low.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (low.endsWith(".svg")) return "image/svg+xml";
        if (low.endsWith(".png")) return "image/png";
        if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg";
        if (low.endsWith(".webp")) return "image/webp";
        if (low.endsWith(".ico")) return "image/x-icon";
        if (low.endsWith(".woff2")) return "font/woff2";
        if (low.endsWith(".woff")) return "font/woff";
        if (low.endsWith(".apk")) return "application/vnd.android.package-archive";
        return "application/octet-stream";
    }
}
