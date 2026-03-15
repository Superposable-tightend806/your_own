/**
 * Chat screen with SSE streaming, inverted FlatList, markdown and image attachments.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { apiFetch, apiFetchStreaming, loadSettings, loadWorkbenchLatest } from "@/lib/api";
import type { HistoryPair, Message } from "@/lib/types";
import MessageContent from "@/components/MessageContent";
import { WorkbenchDotsBtn, WorkbenchBar } from "@/components/WorkbenchTicker";

const HISTORY_BATCH = 25;
const MAX_IMAGES = 4;

// Vision-capable models — must match backend VISION_MODELS
const VISION_MODELS = new Set([
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.1",
  "openai/gpt-5.4",
]);

interface ImageAttachment {
  uri: string;      // local file URI
  mimeType: string; // e.g. "image/jpeg"
  fileName: string;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pairToMessages(pair: HistoryPair): Message[] {
  const out: Message[] = [];
  if (pair.user_text) {
    out.push({ id: `${pair.pair_id}-user`, role: "user", content: pair.user_text, pairId: pair.pair_id });
  }
  if (pair.assistant_text) {
    out.push({ id: `${pair.pair_id}-assistant`, role: "assistant", content: pair.assistant_text, pairId: pair.pair_id });
  }
  return out;
}

// ── Message bubble ────────────────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({
  msg,
  isStreamingLast,
}: {
  msg: Message;
  isStreamingLast: boolean;
}) {
  const isUser = msg.role === "user";
  const imageUrls = msg.imageUrls ?? (msg.imageUrl ? [msg.imageUrl] : []);
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {imageUrls.length > 0 && (
          <View style={styles.attachedImages}>
            {imageUrls.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.attachedImage} resizeMode="cover" />
            ))}
          </View>
        )}
        {msg.content ? (
          <MessageContent
            content={msg.content}
            role={msg.role}
            isStreaming={isStreamingLast}
            showCursor={isStreamingLast && !isUser}
          />
        ) : null}
      </View>
    </View>
  );
});

// ── Chat screen ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [aiName, setAiName] = useState("CHAT");
  const [workbenchText, setWorkbenchText] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  // Image attachments
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [canAttach, setCanAttach] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const chunkBufRef = useRef("");
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);

  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // ── Load initial data ───────────────────────────────────────────────────────

  useEffect(() => {
    void loadHistory(null);
    loadSettings()
      .then(s => {
        if (s.ai_name) setAiName(s.ai_name.toUpperCase());
        if (s.model) setCanAttach(VISION_MODELS.has(s.model));
      })
      .catch(() => {});
    loadWorkbenchLatest()
      .then(r => { if (r.text) setWorkbenchText(r.text); })
      .catch(() => {});
  }, []);

  // ── Image picker ────────────────────────────────────────────────────────────

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: MAX_IMAGES - attachments.length,
    });

    if (result.canceled) return;

    const newAttachments: ImageAttachment[] = result.assets.map((asset, i) => ({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `image_${i}.jpg`,
    }));

    setAttachments(prev => [...prev, ...newAttachments].slice(0, MAX_IMAGES));
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // ── History ─────────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async (before?: string | null) => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ account_id: "default", limit_pairs: String(HISTORY_BATCH) });
      if (before) params.set("before", before);

      const res = await apiFetch(`/api/chat/history?${params}`);
      if (!res.ok) throw new Error(res.status === 401 ? "auth" : `${res.status}`);

      const data = await res.json() as { pairs: HistoryPair[]; next_before?: string | null; has_more: boolean };
      const loaded = data.pairs.flatMap(pairToMessages);

      setMessages(prev => before ? [...loaded, ...prev] : loaded);
      setCursor(data.next_before ?? null);
      setHasMore(Boolean(data.has_more));
      if (!before) setInitialLoaded(true);
    } catch (err) {
      console.warn("[chat] loadHistory error:", err);
      if (!before) setInitialLoaded(true);
    } finally {
      setLoadingHistory(false);
    }
  }, [loadingHistory]);

  // ── Streaming helpers ───────────────────────────────────────────────────────

  const flushChunkBuf = useCallback(() => {
    rafRef.current = null;
    const text = chunkBufRef.current;
    if (!text) return;
    chunkBufRef.current = "";
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (!last || last.role !== "assistant") return prev;
      updated[updated.length - 1] = { ...last, content: last.content + text };
      return updated;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushChunkBuf);
    }
  }, [flushChunkBuf]);

  const flushNow = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    flushChunkBuf();
  }, [flushChunkBuf]);

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;

    const previewUris = attachments.map(a => a.uri);
    const userMsg: Message = {
      id: makeId("user"),
      role: "user",
      content: text,
      imageUrls: previewUris.length > 0 ? previewUris : undefined,
    };
    setMessages(prev => [...prev, userMsg, { id: makeId("assistant"), role: "assistant", content: "" }]);
    setInput("");
    const sentAttachments = [...attachments];
    setAttachments([]);
    setStreaming(true);

    try {
      abortRef.current = new AbortController();

      let body: FormData | string;
      let headers: Record<string, string>;

      if (sentAttachments.length > 0) {
        // Multipart form-data when images are attached
        const form = new FormData();
        form.append("messages", JSON.stringify([...messages, userMsg].map(m => ({ role: m.role, content: m.content }))));
        form.append("web_search", "false");
        form.append("account_id", "default");
        for (const att of sentAttachments) {
          form.append("images", { uri: att.uri, name: att.fileName, type: att.mimeType } as any);
        }
        body = form;
        headers = {};
      } else {
        // URL-encoded (no images) — preferred for streaming compatibility
        const params = new URLSearchParams();
        params.append("messages", JSON.stringify([...messages, userMsg].map(m => ({ role: m.role, content: m.content }))));
        params.append("web_search", "false");
        params.append("account_id", "default");
        body = params.toString();
        headers = { "Content-Type": "application/x-www-form-urlencoded" };
      }

      const response = await apiFetchStreaming("/api/chat", {
        method: "POST",
        body,
        headers,
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Auth failed — reconnect in Settings" : `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Streaming not supported");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = typeof value === "string" ? value : decoder.decode(value, { stream: true });
        sseBuffer += chunk;

        const events = sseBuffer.split("\n\n");
        sseBuffer = events.pop() ?? "";

        for (const event of events) {
          const eventType = event.split("\n").find(l => l.startsWith("event: "))?.slice(7).trim();
          const dataLines = event.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6));
          if (!dataLines.length) continue;
          const chunk = dataLines.join("\n");
          if (chunk === "[DONE]") break;

          if (eventType === "rewrite") {
            try {
              const { text: newText } = JSON.parse(chunk);
              flushNow();
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") updated[updated.length - 1] = { ...last, content: newText };
                return updated;
              });
            } catch { /* ignore */ }
            continue;
          }

          if (eventType && ["memory", "skill", "search_start", "search_results",
            "web_start", "web_done", "image_start", "image_ready"].includes(eventType)) {
            continue;
          }

          chunkBufRef.current += chunk;
          scheduleFlush();
        }
      }
      flushNow();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      flushNow();
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: errMsg.includes("Auth failed") ? errMsg : `[connection error: ${errMsg}]` };
        }
        return updated;
      });
    } finally {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      chunkBufRef.current = "";
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => { abortRef.current?.abort(); setStreaming(false); };

  const renderItem = ({ item, index }: { item: Message; index: number }) => (
    <MessageBubble msg={item} isStreamingLast={streaming && index === 0} />
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!initialLoaded) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: aiName }} />
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 56}
    >
      <Stack.Screen
        options={{
          title: aiName,
          headerRight: () => (
            <WorkbenchDotsBtn open={workbenchOpen} onPress={() => setWorkbenchOpen(v => !v)} />
          ),
        }}
      />
      <WorkbenchBar open={workbenchOpen} text={workbenchText} />

      <FlatList
        ref={flatListRef}
        data={reversedMessages}
        keyExtractor={m => m.id}
        renderItem={renderItem}
        inverted
        contentContainerStyle={styles.list}
        onEndReached={() => { if (hasMore && !loadingHistory) void loadHistory(cursor); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingHistory ? <ActivityIndicator color="#fff" style={{ marginTop: 12 }} /> : null}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>start typing</Text>
          </View>
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* Image previews strip */}
      {attachments.length > 0 && (
        <View style={styles.previewStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewScroll}>
            {attachments.map((att, i) => (
              <View key={i} style={styles.previewWrap}>
                <Image source={{ uri: att.uri }} style={styles.previewThumb} resizeMode="cover" />
                <TouchableOpacity style={styles.previewRemove} onPress={() => removeAttachment(i)}>
                  <Text style={styles.previewRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {canAttach && (
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={pickImages}
            disabled={attachments.length >= MAX_IMAGES}
          >
            <Text style={[styles.attachIcon, attachments.length >= MAX_IMAGES && { opacity: 0.3 }]}>⊕</Text>
          </TouchableOpacity>
        )}
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={streaming ? handleStop : handleSend}
          disabled={!streaming && !input.trim() && attachments.length === 0}
        >
          <Text style={styles.sendBtnText}>{streaming ? "stop" : "send"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", transform: [{ scaleY: -1 }] },
  emptyText: { color: "rgba(255,255,255,0.3)", textAlign: "center", fontSize: 12, letterSpacing: 4, textTransform: "uppercase" },

  bubbleWrap: { marginBottom: 16, maxWidth: "85%" },
  bubbleWrapRight: { alignSelf: "flex-end" },
  bubbleWrapLeft: { alignSelf: "flex-start" },
  bubble: { borderRadius: 0, padding: 12 },
  bubbleUser: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  bubbleAssistant: { backgroundColor: "transparent" },

  attachedImages: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  attachedImage: { width: 160, height: 120, borderRadius: 2 },

  previewStrip: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingVertical: 8,
    backgroundColor: "#000",
  },
  previewScroll: { paddingHorizontal: 16, gap: 8 },
  previewWrap: { position: "relative" },
  previewThumb: { width: 64, height: 64, borderRadius: 2 },
  previewRemove: {
    position: "absolute", top: -6, right: -6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  previewRemoveText: { color: "#fff", fontSize: 11, lineHeight: 14 },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  attachBtn: { paddingBottom: 6 },
  attachIcon: { color: "rgba(255,255,255,0.4)", fontSize: 22 },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    fontWeight: "300",
    minHeight: 36,
    maxHeight: 140,
    paddingVertical: 8,
    textAlignVertical: "top",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  sendBtn: { paddingBottom: 6, minWidth: 40, alignItems: "flex-end" },
  sendBtnText: { color: "rgba(255,255,255,0.55)", fontSize: 9, letterSpacing: 4, textTransform: "uppercase" },
});
