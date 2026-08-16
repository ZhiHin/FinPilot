/** Keyboard users jump straight to content; visible only on focus. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-raised focus:px-4 focus:py-2 focus:text-ink focus:shadow-raised"
    >
      {label}
    </a>
  );
}
