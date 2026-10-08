package dev.viswesh.vibex.audio;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;

/** Versioned app-private persistence. Writes are transactional; credentials never enter backups. */
public final class VibeStore extends SQLiteOpenHelper {
  private static VibeStore instance;
  // Metadata is read repeatedly by native snapshots; keep a bounded immutable-string cache.
  private final android.util.LruCache<String, String> songCache = new android.util.LruCache<>(256);

  public static synchronized VibeStore get(Context c) {
    if (instance == null) instance = new VibeStore(c.getApplicationContext());
    return instance;
  }

  private VibeStore(Context c) {
    super(c, "vibex.db", null, 1);
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase d) {
    d.execSQL("CREATE TABLE documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    d.execSQL("CREATE TABLE songs (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    d.execSQL("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
  }

  @Override
  public void onUpgrade(SQLiteDatabase d, int old, int next) {
    throw new IllegalStateException("Unsupported database upgrade; refusing destructive migration");
  }

  public synchronized String read(String key) {
    try (Cursor c =
        getReadableDatabase()
            .rawQuery("SELECT value FROM documents WHERE key=?", new String[] {key})) {
      return c.moveToFirst() ? c.getString(0) : null;
    }
  }

  public synchronized void write(String key, String value) {
    ContentValues v = new ContentValues();
    v.put("key", key);
    v.put("value", value);
    if (getWritableDatabase()
            .insertWithOnConflict("documents", null, v, SQLiteDatabase.CONFLICT_REPLACE)
        == -1) throw new SQLiteException("Could not write document");
  }

  public synchronized void song(JSONObject song) {
    String id = song.optString("id");
    if (id.isEmpty()) return;
    String encoded = song.toString();
    if (encoded.equals(songCache.get(id))) return;
    ContentValues v = new ContentValues();
    v.put("id", id);
    v.put("data", encoded);
    if (getWritableDatabase()
            .insertWithOnConflict("songs", null, v, SQLiteDatabase.CONFLICT_REPLACE)
        == -1) throw new SQLiteException("Could not save song");
    songCache.put(id, encoded);
  }

  public synchronized JSONObject song(String id) {
    try {
      String cached = songCache.get(id);
      if (cached != null) return new JSONObject(cached);
      try (Cursor c =
          getReadableDatabase().rawQuery("SELECT data FROM songs WHERE id=?", new String[] {id})) {
        if (!c.moveToFirst()) return null;
        String encoded = c.getString(0);
        JSONObject result = new JSONObject(encoded);
        songCache.put(id, encoded);
        return result;
      }
    } catch (Exception e) {
      return null;
    }
  }

  private long eventsRevision = System.currentTimeMillis();

  public synchronized long eventsRevision() {
    return eventsRevision;
  }

  public synchronized void event(JSONObject event) {
    eventsRevision++;
    ContentValues v = new ContentValues();
    v.put("data", event.toString());
    SQLiteDatabase d = getWritableDatabase();
    d.insert("events", null, v);
    d.execSQL(
        "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 10000)");
  }

  public synchronized JSONArray events() {
    JSONArray a = new JSONArray();
    try (Cursor c = getReadableDatabase().rawQuery("SELECT data FROM events ORDER BY id", null)) {
      while (c.moveToNext())
        try {
          a.put(new JSONObject(c.getString(0)));
        } catch (Exception ignored) {
        }
    }
    return a;
  }

  public synchronized void replaceEvents(JSONArray events) {
    eventsRevision++;
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      d.delete("events", null, null);
      for (int i = Math.max(0, events.length() - 10000); i < events.length(); i++) {
        JSONObject e = events.optJSONObject(i);
        if (e != null && e.optDouble("sec", -1) >= 0 && e.optDouble("sec", 61) <= 60) {
          ContentValues v = new ContentValues();
          v.put("data", e.toString());
          d.insertOrThrow("events", null, v);
        }
      }
      d.setTransactionSuccessful();
    } finally {
      d.endTransaction();
    }
  }

  public synchronized void restoreLibrary(String value, JSONObject settings, JSONArray events) {
    SQLiteDatabase d = getWritableDatabase();
    d.beginTransaction();
    try {
      write("library", value);
      write("settings", settings.toString());
      replaceEvents(events);
      JSONObject songs = new JSONObject(value).getJSONObject("songs");
      java.util.Iterator<String> ids = songs.keys();
      while (ids.hasNext()) song(songs.getJSONObject(ids.next()));
      d.setTransactionSuccessful();
    } catch (JSONException e) {
      throw new IllegalArgumentException("Invalid backup", e);
    } finally {
      d.endTransaction();
      songCache.evictAll();
    }
  }

  public JSONObject settings() {
    try {
      String s = read("settings");
      return s == null ? new JSONObject() : new JSONObject(s);
    } catch (Exception e) {
      return new JSONObject();
    }
  }
}
