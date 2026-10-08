package dev.viswesh.vibex.audio;

import android.content.Context;
import android.net.Uri;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Bounded, 24-hour artwork cache. Failed refreshes never overwrite a valid offline image. */
public final class VibeArtwork {
  static File file(Context c, String url) throws Exception {
    byte[] digest =
        MessageDigest.getInstance("SHA-256").digest(url.getBytes(StandardCharsets.UTF_8));
    StringBuilder key = new StringBuilder();
    for (byte b : digest) key.append(String.format("%02x", b));
    File dir = new File(c.getFilesDir(), "artwork");
    dir.mkdirs();
    return new File(dir, key + ".img");
  }

  public static Uri available(Context c, String url) {
    try {
      File f = file(c, url);
      return f.exists() ? Uri.fromFile(f) : Uri.parse(url);
    } catch (Exception e) {
      return Uri.parse(url);
    }
  }

  public static String local(Context context, String id, byte[] data) {
    if (data == null || data.length > 3 * 1024 * 1024) return "";
    android.graphics.Bitmap bitmap = null;
    try {
      android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
      options.inJustDecodeBounds = true;
      android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, options);
      if (options.outWidth <= 0 || options.outHeight <= 0) return "";
      options.inSampleSize = 1;
      while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512)
        options.inSampleSize *= 2;
      options.inJustDecodeBounds = false;
      bitmap = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length, options);
      File dest = file(context, "local:" + id), temp = new File(dest + ".tmp");
      try (OutputStream out = new FileOutputStream(temp)) {
        if (bitmap == null
            || !bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)) return "";
      }
      if (!temp.renameTo(dest)) {
        temp.delete();
        return "";
      }
      trim(dest);
      return Uri.fromFile(dest).toString();
    } catch (Exception e) {
      return "";
    } finally {
      if (bitmap != null) bitmap.recycle();
    }
  }

  private static synchronized void trim(File dest) {
    File[] files = dest.getParentFile().listFiles();
    if (files != null) {
      java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
      long bytes = 0;
      for (File f : files) bytes += f.length();
      for (File f : files) {
        if (bytes < 64L * 1024 * 1024) break;
        if (!f.equals(dest)) {
          long len = f.length();
          if (f.delete()) bytes -= len;
        }
      }
    }
  }

  public static synchronized String cached(Context c, String url) throws Exception {
    if (url.startsWith("file://")) return url;
    Uri uri = Uri.parse(url);
    String host = uri.getHost();
    if (!"https".equals(uri.getScheme())
        || host == null
        || !(host.equals("saavncdn.com")
            || host.endsWith(".saavncdn.com")
            || host.endsWith(".jiosaavn.com"))) return url;
    File dest = file(c, url);
    if (dest.exists() && System.currentTimeMillis() - dest.lastModified() < 86400000)
      return Uri.fromFile(dest).toString();
    HttpURLConnection connection = null;
    File temp = new File(dest + ".tmp");
    try {
      connection = (HttpURLConnection) new URL(url).openConnection();
      connection.setConnectTimeout(5000);
      connection.setReadTimeout(7000);
      connection.setInstanceFollowRedirects(false);
      if (connection.getResponseCode() != 200
          || !String.valueOf(connection.getContentType()).startsWith("image/"))
        throw new IOException("No image");
      try (InputStream in = connection.getInputStream();
          OutputStream out = new FileOutputStream(temp)) {
        byte[] b = new byte[8192];
        int n, total = 0;
        while ((n = in.read(b)) != -1) {
          total += n;
          if (total > 3 * 1024 * 1024) throw new IOException("Image too large");
          out.write(b, 0, n);
        }
      }
      android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
      options.inJustDecodeBounds = true;
      android.graphics.BitmapFactory.decodeFile(temp.toString(), options);
      if (options.outWidth <= 0) throw new IOException("Invalid image");
      if (!temp.renameTo(dest)) throw new IOException("Cache rename failed");
      trim(dest);
    } catch (Exception e) {
      if (!dest.exists()) return url;
    } finally {
      temp.delete();
      if (connection != null) connection.disconnect();
    }
    return Uri.fromFile(dest).toString();
  }
}
