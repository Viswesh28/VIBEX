import { Capacitor, registerPlugin } from "@capacitor/core";
export const native = Capacitor.isNativePlatform();
export const Audio = registerPlugin("VibexAudio");

const images = new Map();
export function cachedArtwork(url) {
  if (!native || !url) return Promise.resolve(url);
  if (url.startsWith("file://"))
    return Promise.resolve(Capacitor.convertFileSrc(url));
  if (!images.has(url)) {
    if (images.size > 500) images.clear();
    images.set(
      url,
      Audio.artwork({ url })
        .then(({ uri }) =>
          uri.startsWith("file://") ? Capacitor.convertFileSrc(uri) : uri,
        )
        .catch(() => url),
    );
  }
  return images.get(url);
}
