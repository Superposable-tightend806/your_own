import type { ImageSourcePropType } from "react-native";

const NGROK_IMAGE_HEADERS = { "ngrok-skip-browser-warning": "true" };

function normalizeBackendUrl(backendUrl: string): string {
  return backendUrl.replace(/\/$/, "");
}

export function resolveChatImageUri(uri: string, backendUrl: string): string | null {
  if (!uri) return null;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  if (uri.startsWith("file://") || uri.startsWith("content://")) return uri;
  if (uri.startsWith("/")) {
    const normalized = normalizeBackendUrl(backendUrl);
    return normalized ? `${normalized}${uri}` : null;
  }
  return null;
}

export function buildChatImageSource(uri: string, backendUrl: string): ImageSourcePropType | null {
  const resolved = resolveChatImageUri(uri, backendUrl);
  if (!resolved) return null;
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
    return { uri: resolved, headers: NGROK_IMAGE_HEADERS };
  }
  return { uri: resolved };
}
