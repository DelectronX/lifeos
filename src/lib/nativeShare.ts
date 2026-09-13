import { isNativePlatform } from './nativeBridge';

/**
 * Shares a blob via the OS share sheet on native platforms. Writes it to the
 * Cache directory first (Share.share needs a real file:// URI, not a blob:
 * URL), then hands that URI to @capacitor/share. Returns `false` (never
 * throws) if native sharing is unavailable so the caller can fall back to a
 * plain download link, matching the guarded pattern in `nativeBridge.ts`.
 */
export async function shareBlobNative(blob: Blob, fileName: string, title: string): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const base64 = await blobToBase64(blob);
    const safeName = `${Date.now()}-${fileName.replace(/[^a-z0-9.\-_]+/gi, '_')}`;
    await Filesystem.writeFile({ path: safeName, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });
    await Share.share({ title, url: uri, dialogTitle: title });
    return true;
  } catch (e) {
    console.warn('Native share unavailable:', e);
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the `data:<mime>;base64,` prefix — Filesystem.writeFile wants
      // the raw base64 payload only.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
