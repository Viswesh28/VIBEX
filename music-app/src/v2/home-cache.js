// Disposable Home metadata only. Never persist signed audio URLs or audio bytes here.
export function metadataOnly(value) {
  if (Array.isArray(value)) return value.map(metadataOnly);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "downloadUrl",
              "localUri",
              "encrypted_media_url",
              "streamUrl",
            ].includes(key),
        )
        .map(([key, item]) => [key, metadataOnly(item)]),
    );
  return value;
}

export function createHomeCache(
  load,
  {
    read,
    write,
    now = Date.now,
    online = () => true,
    ttl = 15 * 60_000,
    maxAge = 7 * 86400_000,
    maxEntries = 12,
    maxBytes = 2 * 1024 * 1024,
  },
) {
  let entries = new Map(),
    ready,
    epoch = 0;
  const pending = new Map();
  const init = () =>
    (ready ||= Promise.resolve()
      .then(read)
      .then((saved) => {
        if (saved?.version !== 1 || !Array.isArray(saved.entries)) return;
        for (const [key, entry] of saved.entries
          .filter(Array.isArray)
          .slice(-maxEntries)) {
          if (
            typeof key === "string" &&
            entry?.data &&
            Number.isFinite(entry.at) &&
            entry.at <= now() &&
            now() - entry.at < maxAge &&
            JSON.stringify(entry).length * 2 <= maxBytes
          )
            entries.set(key, entry);
        }
        trim();
      })
      .catch(() => {})); // A corrupt/missing disposable cache must not block music.
  function trim() {
    for (const [key, entry] of entries)
      if (now() - entry.at >= maxAge || entry.at > now()) entries.delete(key);
    while (
      entries.size > maxEntries ||
      (entries.size && JSON.stringify([...entries]).length * 2 > maxBytes)
    )
      entries.delete(entries.keys().next().value);
  }
  const persist = () =>
    Promise.resolve(write({ version: 1, entries: [...entries] })).catch(
      () => {},
    );
  return {
    async get(key, { saver = false, refresh = false } = {}) {
      await init();
      trim();
      const hit = entries.get(key);
      if (hit && !refresh && (saver || !online() || now() - hit.at < ttl))
        return {
          data: hit.data,
          at: hit.at,
          saved: true,
          stale: now() - hit.at >= ttl,
          offline: !online(),
        };
      if (pending.has(key)) return pending.get(key);
      const generation = epoch;
      const request = Promise.resolve()
        .then(() => load(key))
        .then(async (data) => {
          if (generation === epoch) {
            const entry = { data: metadataOnly(data), at: now() };
            entries.delete(key);
            entries.set(key, entry);
            trim();
            await persist();
          }
          return {
            data,
            at: now(),
            saved: false,
            stale: false,
            offline: false,
          };
        })
        .catch((error) => {
          if (hit && now() - hit.at < maxAge)
            return {
              data: hit.data,
              at: hit.at,
              saved: true,
              stale: true,
              offline: true,
            };
          throw error;
        })
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
      return request;
    },
    async clear() {
      await init();
      epoch++;
      entries.clear();
      pending.clear();
      await persist();
    },
  };
}
