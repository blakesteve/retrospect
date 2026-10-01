import Image from "next/image";
import Link from "next/link";

/** Logo + wordmark nav link, used on every page except the landing hero. */
export function Wordmark() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 text-ink-3 hover:text-gold transition-colors text-sm tracking-[0.2em] uppercase"
    >
      <Image
        src="/retrospect-logo-tp.PNG"
        alt=""
        width={28}
        height={28}
        className="rounded-full"
      />
      Retrospect
    </Link>
  );
}
