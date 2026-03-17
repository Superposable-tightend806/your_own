/**
 * Chat screen with SSE streaming, inverted FlatList, markdown and image attachments.
 * Uses react-native-keyboard-controller for proper keyboard handling in chat layout.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ScrollViewProps,
} from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  type KeyboardChatScrollViewProps,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, apiFetchStreaming, getBackendUrl, loadSettings, loadWorkbenchLatest } from "@/lib/api";
import type { HistoryPair, Message } from "@/lib/types";
import MessageContent from "@/components/MessageContent";
import { WorkbenchDotsBtn, WorkbenchBar } from "@/components/WorkbenchTicker";

const HISTORY_BATCH = 25;
const MAX_IMAGES = 4;
const EMULATED_CHUNK = 3;
const EMULATED_DELAY = 22;

const VISION_MODELS = new Set([
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.1",
  "openai/gpt-5.4",
]);

interface ImageAttachment {
  uri: string;
  mimeType: string;
  fileName: string;
  serverUrl?: string;
  uploading?: boolean;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pairToMessages(pair: HistoryPair, baseUrl: string): Message[] {
  const out: Message[] = [];
  const userImageUrls = pair.user_image_urls?.length
    ? pair.user_image_urls.map((u) => (u.startsWith("http") ? u : `${baseUrl.replace(/\/$/, "")}${u}`))
    : undefined;
  if (pair.user_text || userImageUrls?.length) {
    out.push({
      id: `${pair.pair_id}-user`,
      role: "user",
      content: pair.user_text ?? "",
      pairId: pair.pair_id,
      imageUrls: userImageUrls,
    });
  }
  if (pair.assistant_text) {
    out.push({ id: `${pair.pair_id}-assistant`, role: "assistant", content: pair.assistant_text, pairId: pair.pair_id });
  }
  return out;
}

// ── Message bubble ───────────────────────────────────────────────────────────

function AttachedImage({ uri }: { uri: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri }}
      style={styles.attachedImage}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const MessageBubble = React.memo(function MessageBubble({
  msg,
  isStreamingLast,
}: {
  msg: Message;
  isStreamingLast: boolean;
}) {
  const [memoryExpanded, setMemoryExpanded] = React.useState(false);
  const isUser = msg.role === "user";
  const imageUrls = (msg.imageUrls ?? (msg.imageUrl ? [msg.imageUrl] : []))
    .filter((u) => u && (u.startsWith("http") || u.startsWith("file://") || u.startsWith("content://")));
  const hasMemory = !isUser && (msg.chromaFacts?.length ?? 0) > 0;
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {imageUrls.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachedImages}>
            {imageUrls.map((uri, i) => (
              <AttachedImage key={`${uri}-${i}`} uri={uri} />
            ))}
          </ScrollView>
        )}
        {(msg.content || (msg.role === "assistant" && isStreamingLast)) ? (
          <MessageContent
            content={msg.content}
            role={msg.role}
            isStreaming={isStreamingLast}
            showCursor={isStreamingLast && !isUser}
          />
        ) : null}
      </View>
      {hasMemory && (
        <>
          <TouchableOpacity
            onPress={() => setMemoryExpanded((v) => !v)}
            style={styles.memoryToggle}
          >
            <Text style={styles.memoryToggleText}>
              {"<>"} memory {memoryExpanded ? "hide" : "show"}
            </Text>
          </TouchableOpacity>
          {memoryExpanded && (
            <View style={styles.memoryPanel}>
              {msg.chromaFacts!.map((fact, fi) => (
                <View key={fact.id || fi} style={styles.memoryFact}>
                  <View style={styles.memoryFactHeader}>
                    <Text style={styles.memoryFactCategory}>{fact.category || "memory"}</Text>
                    <View style={styles.memoryFactMeta}>
                      <Text style={styles.memoryFactMetaText}>{fact.time_label}</Text>
                      {fact.impressive > 0 && (
                        <Text style={styles.memoryFactStars}>{"★".repeat(Math.min(fact.impressive, 4))}</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.memoryFactText}>{fact.text}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
});

// ── Chat scroll wrapper for KeyboardChatScrollView + FlatList ────────────────

type ChatScrollRef = React.ElementRef<typeof KeyboardChatScrollView>;

const ChatScrollView = React.forwardRef<
  ChatScrollRef,
  ScrollViewProps & KeyboardChatScrollViewProps
>(({ inverted, ...props }, ref) => {
  const { bottom } = useSafeAreaInsets();
  return (
    <KeyboardChatScrollView
      ref={ref}
      inverted={inverted}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      keyboardDismissMode="interactive"
      offset={bottom}
      {...props}
    />
  );
});

// ── Chat screen ──────────────────────────────────────────────────────────────

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

  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [canAttach, setCanAttach] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const chunkBufRef = useRef("");
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);
  const backendUrlRef = useRef("");

  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => <ChatScrollView {...props} />,
    [],
  );

  // ── Load initial data ────────────────────────────────────────────────────

  useEffect(() => {
    getBackendUrl().then(u => { backendUrlRef.current = u.replace(/\/$/, ""); }).catch(() => {});
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

  // ── Image picker ─────────────────────────────────────────────────────────

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
      uploading: true,
    }));

    const startIdx = attachments.length;
    setAttachments(prev => [...prev, ...newAttachments].slice(0, MAX_IMAGES));

    for (let i = 0; i < newAttachments.length; i++) {
      const att = newAttachments[i];
      const idx = startIdx + i;
      const form = new FormData();
      form.append("image", { uri: att.uri, name: att.fileName, type: att.mimeType } as any);
      try {
        const res = await apiFetch("/api/upload", { method: "POST", body: form });
        if (res.ok) {
          const { url } = await res.json() as { url: string };
          setAttachments(prev =>
            prev.map((a, j) => (j === idx ? { ...a, serverUrl: url, uploading: false } : a)),
          );
        } else {
          setAttachments(prev => prev.filter((_, j) => j !== idx));
        }
      } catch {
        setAttachments(prev => prev.filter((_, j) => j !== idx));
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // ── History ──────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async (before?: string | null) => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ account_id: "default", limit_pairs: String(HISTORY_BATCH) });
      if (before) params.set("before", before);

      const res = await apiFetch(`/api/chat/history?${params}`);
      if (!res.ok) throw new Error(res.status === 401 ? "auth" : `${res.status}`);

      const baseUrl = await getBackendUrl();
      const data = await res.json() as { pairs: HistoryPair[]; next_before?: string | null; has_more: boolean };
      const loaded = data.pairs.flatMap((p) => pairToMessages(p, baseUrl));

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

  // ── Streaming helpers ──────────────────────────────────────────────────

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

  // ── Send ─────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    const ready = attachments.filter(a => !a.uploading && a.serverUrl);
    if ((!text && ready.length === 0) || streaming) return;

    const baseUrl = await getBackendUrl();
    const prefix = baseUrl.replace(/\/$/, "");
    const serverUrls = ready.map(a => a.serverUrl!);
    const fullImageUrls = serverUrls.map(u => (u.startsWith("http") ? u : `${prefix}${u}`));

    const userMsg: Message = {
      id: makeId("user"),
      role: "user",
      content: text,
      imageUrls: fullImageUrls.length > 0 ? fullImageUrls : undefined,
    };
    setMessages(prev => [...prev, userMsg, { id: makeId("assistant"), role: "assistant", content: "" }]);
    setInput("");
    setAttachments([]);
    setStreaming(true);

    try {
      abortRef.current = new AbortController();
      const msgPayload = JSON.stringify([...messages, userMsg].map(m => ({ role: m.role, content: m.content })));

      const params = new URLSearchParams();
      params.append("messages", msgPayload);
      params.append("web_search", "false");
      params.append("account_id", "default");
      if (serverUrls.length > 0) {
        params.append("image_urls", JSON.stringify(serverUrls));
      }

      const response = await apiFetchStreaming("/api/chat", {
        method: "POST",
        body: params.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(response.status === 401 ? "Auth failed — reconnect in Settings" : `HTTP ${response.status}`);
      }

      const SKIP_EVENTS = new Set([
        "skill", "search_start", "search_results",
        "web_start", "web_done", "image_start", "image_ready",
        "image_urls",
      ]);

      if (response.body) {
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

            if (eventType === "memory") {
              try {
                const { chroma_facts } = JSON.parse(chunk) as { chroma_facts?: Array<{ id: string; text: string; category: string; impressive: number; time_label: string }> };
                if (chroma_facts?.length) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === "assistant") {
                      updated[updated.length - 1] = { ...last, chromaFacts: chroma_facts };
                    }
                    return updated;
                  });
                }
              } catch { /* ignore */ }
              continue;
            }

            if (eventType && SKIP_EVENTS.has(eventType)) continue;

            chunkBufRef.current += chunk;
            scheduleFlush();
          }
        }
        flushNow();
      }
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

  // ── Render ─────────────────────────────────────────────────────────────

  if (!initialLoaded) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: aiName }} />
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
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
        renderScrollComponent={renderScrollComponent}
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

      <KeyboardStickyView style={styles.stickyInput}>
        {attachments.length > 0 && (
          <View style={styles.previewStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewScroll}>
              {attachments.map((att, i) => (
                <View key={i} style={styles.previewWrap}>
                  <Image source={{ uri: att.serverUrl ? `${backendUrlRef.current}${att.serverUrl}` : att.uri }} style={styles.previewThumb} resizeMode="cover" />
                  {att.uploading && (
                    <View style={styles.previewUploading}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                  <TouchableOpacity style={styles.previewRemove} onPress={() => removeAttachment(i)}>
                    <Text style={styles.previewRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

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
            disabled={!streaming && (!input.trim() && attachments.filter(a => !a.uploading).length === 0 || attachments.some(a => a.uploading))}
          >
            <Text style={styles.sendBtnText}>{streaming ? "stop" : "send"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

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

  attachedImages: { flexDirection: "row", gap: 6, marginBottom: 8 },
  attachedImage: { width: 160, height: 120, borderRadius: 2 },

  memoryToggle: { marginTop: 8, alignSelf: "flex-start" },
  memoryToggleText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  memoryPanel: {
    marginTop: 8,
    width: "88%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
    padding: 12,
    gap: 12,
  },
  memoryFact: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 10,
  },
  memoryFactHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  memoryFactCategory: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  memoryFactMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  memoryFactMetaText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 9,
    letterSpacing: 2,
  },
  memoryFactStars: { color: "rgba(255,255,255,0.3)", fontSize: 10 },
  memoryFactText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    lineHeight: 18,
  },

  stickyInput: {
    backgroundColor: "#000",
  },

  previewStrip: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingVertical: 8,
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
  previewUploading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2,
  },

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
