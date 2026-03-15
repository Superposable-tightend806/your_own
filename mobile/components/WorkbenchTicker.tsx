/**
 * WorkbenchTicker — a thin collapsible bar that scrolls the latest
 * workbench note as a looping ticker.
 *
 * Shows three dots (•••) as a toggle button. Tapping expands a bar
 * that continuously scrolls the AI's last note from right to left.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const TICKER_HEIGHT = 30;
const SCROLL_SPEED_PX_PER_SEC = 60;

interface Props {
  text: string | null;
}

export default function WorkbenchTicker({ text }: Props) {
  const [open, setOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  // Bar slide-in animation
  const barHeight = useRef(new Animated.Value(0)).current;

  // Ticker scroll animation
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollAnim = useRef<Animated.CompositeAnimation | null>(null);

  // Toggle open/close
  const toggle = () => setOpen(v => !v);

  useEffect(() => {
    Animated.timing(barHeight, {
      toValue: open ? TICKER_HEIGHT : 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [open]);

  // Start / restart scroll when text or container width changes
  useEffect(() => {
    if (!open || !text || containerWidth === 0 || textWidth === 0) return;

    scrollAnim.current?.stop();

    const totalDistance = containerWidth + textWidth;
    const duration = (totalDistance / SCROLL_SPEED_PX_PER_SEC) * 1000;

    scrollX.setValue(containerWidth); // start offscreen right

    scrollAnim.current = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -textWidth,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    scrollAnim.current.start();

    return () => { scrollAnim.current?.stop(); };
  }, [open, text, containerWidth, textWidth]);

  const onContainerLayout = (e: LayoutChangeEvent) =>
    setContainerWidth(e.nativeEvent.layout.width);

  const onTextLayout = (e: LayoutChangeEvent) =>
    setTextWidth(e.nativeEvent.layout.width);

  return (
    <View>
      {/* Dots toggle button — sits in the header area passed from chat */}
      <TouchableOpacity onPress={toggle} style={sty.dotsBtn} activeOpacity={0.6}>
        <Text style={[sty.dots, open && sty.dotsActive]}>•••</Text>
      </TouchableOpacity>

      {/* Collapsible ticker bar */}
      <Animated.View style={[sty.bar, { height: barHeight }]}>
        <View style={sty.overflow} onLayout={onContainerLayout}>
          <Animated.Text
            style={[sty.tickerText, { transform: [{ translateX: scrollX }] }]}
            onLayout={onTextLayout}
            numberOfLines={1}
          >
            {text ?? ""}
          </Animated.Text>
        </View>
      </Animated.View>
    </View>
  );
}

const sty = StyleSheet.create({
  dotsBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    letterSpacing: 4,
  },
  dotsActive: {
    color: "rgba(255,255,255,0.7)",
  },
  bar: {
    backgroundColor: "#000",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  overflow: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  tickerText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: "300",
    position: "absolute",
    whiteSpace: "nowrap",
  } as any,
});
