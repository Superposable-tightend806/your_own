import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";

import ChatImageRail from "@/components/ChatImageRail";
import { buildChatImageSource } from "@/lib/chatImages";

function ChatImageCard({ uri, backendUrl }: { uri: string; backendUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => buildChatImageSource(uri, backendUrl), [backendUrl, uri]);

  if (!source || failed) {
    return (
      <View style={[s.image, s.fallback]}>
        <Text style={s.fallbackText}>image unavailable</Text>
      </View>
    );
  }

  return (
    <View style={s.imageWrap}>
      <Image
        source={source as any}
        style={s.image}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setFailed(true);
          setLoading(false);
        }}
      />
      {loading ? (
        <View style={s.loading}>
          <ActivityIndicator size="small" color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

export default function ChatMessageImages({
  imageUrls,
  backendUrl,
}: {
  imageUrls: string[];
  backendUrl: string;
}) {
  if (!imageUrls.length) return null;

  return (
    <ChatImageRail>
      {imageUrls.map((uri, index) => (
        <ChatImageCard key={`${uri}-${index}`} uri={uri} backendUrl={backendUrl} />
      ))}
    </ChatImageRail>
  );
}

const s = StyleSheet.create({
  imageWrap: { width: 160, height: 120 },
  image: {
    width: 160,
    height: 120,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 2,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  fallbackText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
