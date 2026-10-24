import type { Metadata, Viewport } from "next";
import { PhotoCaptureScreen } from "@/app/people/_components/PhotoCaptureScreen";

export const metadata: Metadata = { title: "Employee photo" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17222A" };

/** Phone capture page: outside the (shell) group, so no sidebar. */
export default async function PhotoCapturePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PhotoCaptureScreen token={token} />;
}
