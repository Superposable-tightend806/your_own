"use client";

import { createContext, useContext, useRef, useState, ReactNode } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
  recalledMemories?: RecalledMemory[];
  chromaFacts?: ChromaFact[];
  pairId?: string;
  createdAt?: string;
}

export interface RecalledMemory {
  pair_id: string;
  score: number;
  cosine: number;
  kw_boost: number;
  exact_boost: number;
  best_sentence: string;
  best_role: "user" | "assistant";
  focus_matched: string[];
  created_at?: string | null;
  relative_time_label?: string;
  user_text: string;
  assistant_text: string;
}

export interface ChromaFact {
  id: string;
  text: string;
  category: string;
  impressive: number;
  time_label: string;
}

interface ChatSessionContextValue {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  clearMessages: () => void;
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  // Lives at app root — survives navigation between /chat and /dashboard
  const [messages, setMessages] = useState<Message[]>([]);

  const clearMessages = () => setMessages([]);

  return (
    <ChatSessionContext.Provider value={{ messages, setMessages, clearMessages }}>
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used inside ChatSessionProvider");
  return ctx;
}
