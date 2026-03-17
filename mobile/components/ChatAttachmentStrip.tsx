import React from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { buildChatImageSource } from "@/lib/chatImages";
import type { DraftAttachment } from "@/lib/types";

export default function ChatAttachmentStrip({
  attachments,
  backendUrl,
  onRemove,
}: {
  attachments: DraftAttachment[];
  backendUrl: string;
  onRemove: (attachmentId: string) => void;
}) {
  if (!attachments.length) return null;

  return (
    <View style={s.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {attachments.map((attachment) => {
          const source = buildChatImageSource(attachment.serverUrl ?? attachment.localUri, backendUrl);
          return (
            <View key={attachment.id} style={s.wrap}>
              {source ? (
                <Image source={source} style={s.thumb} resizeMode="cover" />
              ) : (
                <View style={[s.thumb, s.fallback]}>
                  <Text style={s.fallbackText}>image</Text>
                </View>
              )}
              {attachment.status === "uploading" ? (
                <View style={s.uploading}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              ) : null}
              <TouchableOpacity style={s.remove} onPress={() => onRemove(attachment.id)}>
                <Text style={s.removeText}>×</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  strip: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingVertical: 8,
  },
  scroll: { paddingHorizontal: 16, gap: 8 },
  wrap: { position: "relative" },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  fallbackText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { color: "#fff", fontSize: 11, lineHeight: 14 },
  uploading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2,
  },
});
