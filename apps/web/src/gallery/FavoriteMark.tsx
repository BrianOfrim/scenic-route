export function FavoriteMark({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.8 14.7 9l5.8.9-4.2 4.1 1 5.8L12 17.2 6.7 19.8l1-5.8L3.5 9.9 9.3 9 12 3.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

