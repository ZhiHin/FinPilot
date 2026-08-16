import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-4 text-center">
      <h1 className="text-[24px] font-semibold text-ink">Page not found</h1>
      <p className="text-[13px] text-ink-secondary">
        That page doesn’t exist (or isn’t built yet — FinPilot never fakes a screen).
      </p>
      <Link href="/overview" className="text-[13px] font-medium text-accent hover:underline">
        Back to Overview
      </Link>
    </div>
  );
}
