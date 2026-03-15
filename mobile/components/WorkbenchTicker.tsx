/**
 * WorkbenchBar — collapsible ticker bar showing the latest workbench note.
 *
 * Usage:
 *   // In headerRight:
 *   <WorkbenchDotsBtn open={open} onPress={() => setOpen(v => !v)} />
 *
 *   // In screen body (right below the header):
 *   <WorkbenchBar open={open} text={text} />
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ── Dots toggle button (goes in Stack.Screen headerRight) ─────────────────────

export function WorkbenchDotsBtn({
  open,
  onPress,
}: {
  open: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={sty.dotsBtn} activeOpacity={0.6}>
      <Text style={[sty.dots, open && sty.dotsOpen]}>•••</Text>
    </TouchableOpacity>
  );
}

// ── Collapsible ticker bar (goes in screen body) ──────────────────────────────

const BAR_H = 64;
const FONT_SIZE = 12;
const SPEED = 55; // px per second

export function WorkbenchBar({
  open,
  text,
}: {
  open: boolean;
  text: string | null;
}) {
  const barH = useRef(new Animated.Value(0)).current;
  const scrollX = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);

  // Slide bar open / close
  useEffect(() => {
    Animated.timing(barH, {
      toValue: open ? BAR_H : 0,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [open]);

  // Start / stop marquee
  useEffect(() => {
    animRef.current?.stop();
    if (!open || !text || containerW === 0 || textW === 0) return;

    scrollX.setValue(containerW); // start offscreen right
    const duration = ((containerW + textW) / SPEED) * 1000;

    animRef.current = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -textW,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animRef.current.start();

    return () => { animRef.current?.stop(); };
  }, [open, text, containerW, textW]);

  if (!text) return null;

  return (
    <Animated.View style={[sty.bar, { height: barH }]}>
      {/* Measure container width */}
      <View
        style={sty.inner}
        onLayout={e => setContainerW(e.nativeEvent.layout.width)}
      >
        {/* Hidden clone — measures true text width without wrapping */}
        <Text
          numberOfLines={1}
          style={[sty.tickerText, sty.hidden]}
          onLayout={e => setTextW(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>

        {/* Scrolling text */}
        <Animated.Text
          numberOfLines={1}
          style={[sty.tickerText, { transform: [{ translateX: scrollX }] }]}
        >
          {text}
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sty = StyleSheet.create({
  dotsBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dots: {
    color: "rgba(255,255,255,0.28)",
    fontSize: 13,
    letterSpacing: 4,
  },
  dotsOpen: {
    color: "rgba(255,255,255,0.7)",
  },
  bar: {
    backgroundColor: "#000",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  inner: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  tickerText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: FONT_SIZE,
    fontWeight: "300",
    letterSpacing: 0.4,
  },
  hidden: {
    position: "absolute",
    opacity: 0,
  },
});
