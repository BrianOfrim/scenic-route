import { useState } from "react";

export async function sharePoster(url: string, filename: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return true;
    }
    await navigator.share({ url, title: filename });
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return true;
    return false;
  }
}

export function ShareButton({
  url,
  filename,
  className = "text-btn",
}: {
  url: string;
  filename: string;
  className?: string;
}) {
  const [available] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );
  if (!available) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void sharePoster(url, filename);
      }}
    >
      Share
    </button>
  );
}
