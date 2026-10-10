import { useState } from "react";

export function GalleryImagePlaceholder({ failed = false }: { failed?: boolean }) {
  return (
    <div className="gallery-thumbnail-placeholder" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none">
        <rect x="9" y="9" width="46" height="46" rx="4" />
        <circle cx="23" cy="23" r="4" />
        <path d="m10 46 15-15 10 10 9-9 11 11" />
      </svg>
      <small>{failed ? "Image unavailable" : "Loading image…"}</small>
    </div>
  );
}

/** Reserve a visible row before later metadata pages tell us about its other images. */
export function GalleryLoadingCards({ knownCount, loading }: { knownCount: number; loading: boolean }) {
  const count = loading ? Math.max(0, 6 - knownCount) : 0;
  return Array.from({ length: count }, (_, index) => (
    <div className="gallery-card gallery-loading-card" key={index} aria-hidden="true">
      <div className="gallery-thumbnail"><GalleryImagePlaceholder /></div>
      <div className="gallery-loading-caption"><i /><i /></div>
    </div>
  ));
}

/** Keep captions and card geometry visible independently of image downloads. */
export function GalleryThumbnail({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className={`gallery-thumbnail${loaded ? " loaded" : ""}`}>
      {!loaded && <GalleryImagePlaceholder failed={failed} />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        ref={(image) => {
          if (image?.complete && image.naturalWidth > 0) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
