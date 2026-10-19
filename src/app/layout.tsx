import type { Metadata, Viewport } from "next";
import { PinchZoomGuard } from "@/components/common/PinchZoomGuard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Acute-Notes",
  description: "A fast infinite canvas where anything can become real, structured content.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PinchZoomGuard />
        {children}
      </body>
    </html>
  );
}
