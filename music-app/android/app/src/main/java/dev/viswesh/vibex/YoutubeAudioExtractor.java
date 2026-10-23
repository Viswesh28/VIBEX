package dev.viswesh.vibex;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * On-device pure-audio stream resolver for YouTube & YouTube Music IDs.
 *
 * Tier 1: Direct InnerTube ANDROID_VR player request from the user's own residential IP.
 * Tier 2: Direct InnerTube IOS player request from the user's own residential IP.
 * Tier 3: Seamless fallback to VIBEX Cloud OMV audio bridge (`vibex-music-pi.vercel.app/api/ytaudio`)
 *         so UMG/SME Art Tracks and signature-protected streams also play as pure audio.
 */
public final class YoutubeAudioExtractor {

    public static final String CLOUD_ORIGIN = "https://vibex-music-pi.vercel.app";
    private static final long CACHE_TTL_MS = 90L * 60L * 1000L;

    public static final class StreamInfo {
        public final String videoId;
        public final String directUrl; // null when routed via cloud /api/ytaudio
        public final String mimeType;
        public final String quality;
        public final long durationSec;
        public final String userAgent;
        public final String source;
        public final long expiresAtMs;

        public StreamInfo(
                String videoId,
                String directUrl,
                String mimeType,
                String quality,
                long durationSec,
                String userAgent,
                String source,
                long expiresAtMs) {
            this.videoId = videoId;
            this.directUrl = directUrl;
            this.mimeType = mimeType != null ? mimeType : "audio/mp4";
            this.quality = quality != null ? quality : "160kbps";
            this.durationSec = durationSec;
            this.userAgent = userAgent;
            this.source = source;
            this.expiresAtMs = expiresAtMs;
        }
    }

    private static final Map<String, StreamInfo> CACHE = new LinkedHashMap<String, StreamInfo>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, StreamInfo> eldest) {
            return size() > 96;
        }
    };

    private YoutubeAudioExtractor() {}

    public static synchronized StreamInfo getCached(String videoId) {
        StreamInfo hit = CACHE.get(videoId);
        if (hit == null) return null;
        if (System.currentTimeMillis() > hit.expiresAtMs) {
            CACHE.remove(videoId);
            return null;
        }
        return hit;
    }

    public static synchronized void invalidate(String videoId) {
        CACHE.remove(videoId);
    }

    private static synchronized void putCached(String videoId, StreamInfo info) {
        CACHE.put(videoId, info);
    }

    public static StreamInfo resolve(String videoId, String title, String artist) {
        if (videoId == null || videoId.trim().isEmpty()) return null;
        String cleanId = videoId.trim();

        StreamInfo cached = getCached(cleanId);
        if (cached != null) return cached;

        // Tier 1: ANDROID_VR client on device IP
        StreamInfo vr = tryInnerTube(
                cleanId,
                "ANDROID_VR",
                "1.62.27",
                28,
                "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "Android",
                "12L",
                32);
        if (vr != null) {
            putCached(cleanId, vr);
            return vr;
        }

        // Tier 2: IOS client on device IP
        StreamInfo ios = tryInnerTube(
                cleanId,
                "IOS",
                "20.03.02",
                5,
                "com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)",
                "iPhone",
                "18.2.1.22C161",
                0);
        if (ios != null) {
            putCached(cleanId, ios);
            return ios;
        }

        // Tier 3: Cloud OMV bridge probe (`https://vibex-music-pi.vercel.app/api/ytaudio?meta=1`)
        StreamInfo cloud = probeCloudBridge(cleanId, title, artist);
        if (cloud != null) {
            putCached(cleanId, cloud);
            return cloud;
        }

        return null;
    }

    private static StreamInfo tryInnerTube(
            String videoId,
            String clientName,
            String clientVersion,
            int clientIdHeader,
            String userAgent,
            String osName,
            String osVersion,
            int androidSdkVersion) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(6500);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", userAgent);
            conn.setRequestProperty("X-YouTube-Client-Name", String.valueOf(clientIdHeader));
            conn.setRequestProperty("X-YouTube-Client-Version", clientVersion);
            conn.setRequestProperty("Origin", "https://www.youtube.com");

            JSONObject client = new JSONObject();
            client.put("clientName", clientName);
            client.put("clientVersion", clientVersion);
            client.put("osName", osName);
            client.put("osVersion", osVersion);
            client.put("hl", "en");
            client.put("gl", "US");
            if (androidSdkVersion > 0) {
                client.put("androidSdkVersion", androidSdkVersion);
            }

            JSONObject context = new JSONObject();
            context.put("client", client);

            JSONObject body = new JSONObject();
            body.put("videoId", videoId);
            body.put("contentCheckOk", true);
            body.put("racyCheckOk", true);
            body.put("context", context);

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;

            String jsonText = readStream(conn.getInputStream());
            JSONObject root = new JSONObject(jsonText);

            JSONObject status = root.optJSONObject("playabilityStatus");
            if (status == null || !"OK".equalsIgnoreCase(status.optString("status"))) {
                return null;
            }

            JSONObject streaming = root.optJSONObject("streamingData");
            if (streaming == null) return null;

            JSONArray adaptive = streaming.optJSONArray("adaptiveFormats");
            if (adaptive == null || adaptive.length() == 0) return null;

            JSONObject best = null;
            int bestScore = -1;

            for (int i = 0; i < adaptive.length(); i++) {
                JSONObject fmt = adaptive.optJSONObject(i);
                if (fmt == null) continue;
                String direct = fmt.optString("url", "");
                if (direct.isEmpty()) continue;
                String mime = fmt.optString("mimeType", "");
                if (!mime.startsWith("audio/")) continue;

                int itag = fmt.optInt("itag", 0);
                int bitrate = fmt.optInt("averageBitrate", fmt.optInt("bitrate", 0));
                int score = bitrate / 1000;
                // Prefer AAC-in-MP4 (`audio/mp4`, e.g. itag 140/141) for universal Android hardware decode & seeking
                if (mime.startsWith("audio/mp4")) {
                    score += 400;
                }
                if (itag == 140 || itag == 141) {
                    score += 100;
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = fmt;
                }
            }

            if (best == null) return null;

            String rawMime = best.optString("mimeType", "audio/mp4");
            int semi = rawMime.indexOf(';');
            String cleanMime = semi > 0 ? rawMime.substring(0, semi).trim() : rawMime.trim();
            int kbps = Math.max(64, best.optInt("averageBitrate", best.optInt("bitrate", 128000)) / 1000);
            JSONObject details = root.optJSONObject("videoDetails");
            long dur = details != null ? details.optLong("lengthSeconds", 0L) : 0L;

            return new StreamInfo(
                    videoId,
                    best.optString("url"),
                    cleanMime,
                    kbps + "kbps",
                    dur,
                    userAgent,
                    "android:" + clientName.toLowerCase(),
                    System.currentTimeMillis() + CACHE_TTL_MS);
        } catch (Throwable ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static StreamInfo probeCloudBridge(String videoId, String title, String artist) {
        HttpURLConnection conn = null;
        try {
            StringBuilder sb = new StringBuilder(CLOUD_ORIGIN)
                    .append("/api/ytaudio?id=")
                    .append(URLEncoder.encode(videoId, "UTF-8"))
                    .append("&meta=1");
            if (title != null && !title.isEmpty()) {
                sb.append("&title=").append(URLEncoder.encode(title, "UTF-8"));
            }
            if (artist != null && !artist.isEmpty()) {
                sb.append("&artist=").append(URLEncoder.encode(artist, "UTF-8"));
            }
            conn = (HttpURLConnection) new URL(sb.toString()).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(9000);
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != 200) return null;

            JSONObject json = new JSONObject(readStream(conn.getInputStream()));
            if (!json.optBoolean("success", false)) return null;
            JSONObject data = json.optJSONObject("data");
            if (data == null || !data.optBoolean("playable", false)) return null;

            return new StreamInfo(
                    videoId,
                    null, // stream via cloud OMV bridge endpoint
                    data.optString("mimeType", "audio/mp4"),
                    data.optString("quality", "128kbps"),
                    data.optLong("duration", 0L),
                    "VIBEX-Android/3.2.0",
                    data.optString("source", "cloud:omv"),
                    System.currentTimeMillis() + 5L * 60L * 1000L);
        } catch (Throwable ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(InputStream is) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = br.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
        }
        return sb.toString();
    }
}
