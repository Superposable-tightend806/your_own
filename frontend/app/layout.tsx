import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ChatSessionProvider } from "@/context/ChatSessionContext";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Your Own",
  description: "No corporation. No censorship. No limits.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-black">
      <body className={`${geistSans.variable} antialiased bg-black text-white`}>
        <ChatSessionProvider>
          {children}
        </ChatSessionProvider>
      </body>
    </html>
  );
}
