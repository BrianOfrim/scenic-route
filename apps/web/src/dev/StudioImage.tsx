import { useEffect, useRef, useState } from "react";
import type { PosterRecord } from "../api";
import { studioImage } from "./studioImages";

export function StudioThumbnail({ userId, poster, alt }: { userId: string; poster: PosterRecord; alt: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState(poster.thumbDataUrl);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(false);
    // Older saved candidates may lack thumbUrl; never download their originals for the grid.
    void studioImage(userId, poster.thumbUrl || `/api/posters/${poster.posterId}/thumb.webp`)
      .then(url => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [visible, userId, poster.posterId, poster.thumbUrl, attempt]);
  return <span ref={host} className="studio-thumbnail">
    {src && <img src={src} alt={alt} decoding="async" />}
    {!src && <span className="studio-image-status">{error ? "Image unavailable" : "Loading thumbnail…"}</span>}
    {error && <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setAttempt(n => n + 1); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setAttempt(n => n + 1); } }}>Retry thumbnail</span>}
  </span>;
}

export function StudioPreview({ userId, poster, onClose }: { userId: string; poster: PosterRecord; onClose: () => void }) {
  const [thumbnail, setThumbnail] = useState(poster.thumbDataUrl);
  const [full, setFull] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void studioImage(userId, poster.thumbUrl || `/api/posters/${poster.posterId}/thumb.webp`)
      .then(url => { if (!cancelled) setThumbnail(url); }).catch(() => {});
    void studioImage(userId, poster.url || `/api/posters/${poster.posterId}/image.png`, true)
      .then(url => { if (!cancelled) setFull(url); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load full-size image"); });
    return () => { cancelled = true; };
  }, [userId, poster.posterId, poster.thumbUrl, poster.url, attempt]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="theme-batch-lightbox" role="dialog" aria-modal="true" aria-label="Poster preview" onClick={onClose}>
    <div className="studio-preview-actions" onClick={e => e.stopPropagation()}>
      <button autoFocus className="button" onClick={onClose}>Close preview</button>
      {!full && !error && <span role="status">Loading full-size image…</span>}
      {error && <><span role="alert">{error}</span><button className="button" onClick={() => setAttempt(n => n + 1)}>Retry full-size image</button></>}
    </div>
    <div className="studio-preview-image" onClick={e => e.stopPropagation()}>
      {(full || thumbnail) && <img src={full || thumbnail} alt={full ? "Full poster preview" : "Poster preview (thumbnail while full-size loads)"} />}
    </div>
  </div>;
}
