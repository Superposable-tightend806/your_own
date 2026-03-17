import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import MessageContent from "@/components/MessageContent";
import ChatMessageImages from "@/components/ChatMessageImages";
import ChatMessageMemory from "@/components/ChatMessageMemory";
import type { Message } from "@/lib/types";
import { resolveChatImageUri } from "@/lib/chatImages";

export default React.memo(function ChatMessageBubble({
  msg,
  isStreamingLast,
  backendUrl,
}: {
  msg: Message;
  isStreamingLast: boolean;
  backendUrl: string;
}) {
  const isUser = msg.role === "user";
  const imageUrls = useMemo(
    () =>
      (msg.imageUrls ?? (msg.imageUrl ? [msg.imageUrl] : []))
        .filter((uri): uri is string => Boolean(resolveChatImageUri(uri, backendUrl))),
    [backendUrl, msg.imageUrl, msg.imageUrls],
  );
  const hasMemory = !isUser && (msg.chromaFacts?.length ?? 0) > 0;

  return (
    <View style={[s.wrap, isUser ? s.wrapRight : s.wrapLeft]}>
      <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}>
        <ChatMessageImages imageUrls={imageUrls} backendUrl={backendUrl} />
        {(msg.content || (msg.role === "assistant" && isStreamingLast)) ? (
          <MessageContent
            content={msg.content}
            role={msg.role}
            isStreaming={isStreamingLast}
            showCursor={isStreamingLast && !isUser}
            backendUrl={backendUrl}
          />
        ) : null}
      </View>
      {hasMemory ? <ChatMessageMemory chromaFacts={msg.chromaFacts ?? []} /> : null}
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { marginBottom: 16, maxWidth: "85%" },
  wrapRight: { alignSelf: "flex-end" },
  wrapLeft: { alignSelf: "flex-start" },
  bubble: { borderRadius: 0, padding: 12 },
  bubbleUser: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  bubbleAssistant: { backgroundColor: "transparent" },
});
