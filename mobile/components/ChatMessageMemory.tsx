import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { ChromaFact } from "@/lib/types";

export default function ChatMessageMemory({ chromaFacts }: { chromaFacts: ChromaFact[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!chromaFacts.length) return null;

  return (
    <>
      <TouchableOpacity onPress={() => setExpanded((value) => !value)} style={s.toggle}>
        <Text style={s.toggleText}>
          {"<>"} memory {expanded ? "hide" : "show"}
        </Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={s.panel}>
          {chromaFacts.map((fact, index) => (
            <View key={fact.id || index} style={s.fact}>
              <View style={s.factHeader}>
                <Text style={s.category}>{fact.category || "memory"}</Text>
                <View style={s.meta}>
                  <Text style={s.metaText}>{fact.time_label}</Text>
                  {fact.impressive > 0 ? (
                    <Text style={s.stars}>{"★".repeat(Math.min(fact.impressive, 4))}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={s.factText}>{fact.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  toggle: { marginTop: 8, alignSelf: "flex-start" },
  toggleText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  panel: {
    marginTop: 8,
    width: "88%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.02)",
    padding: 12,
    gap: 12,
  },
  fact: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 10,
  },
  factHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  category: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 9,
    letterSpacing: 2,
  },
  stars: { color: "rgba(255,255,255,0.3)", fontSize: 10 },
  factText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    lineHeight: 18,
  },
});
