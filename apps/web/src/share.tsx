import { useState, type ReactNode } from "react";

export async function sharePoster(url: string, filename: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
    // Poster URLs require the current session; recipients cannot open them.
    return false;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return true;
    return false;
  }
}

export function ShareButton({
  url,
  filename,
  className = "text-btn",
  children,
}: {
  url: string;
  filename: string;
  className?: string;
  children?: ReactNode;
}) {
  const [available] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  if (!available) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label="Share"
      title="Share"
      onClick={() => {
        void sharePoster(url, filename);
      }}
    >
      {children ?? "Share"}
    </button>
  );
}
