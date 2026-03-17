import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

export default function ChatImageRail({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: 120, marginBottom: 8 },
  row: { flexDirection: "row", gap: 6 },
});
