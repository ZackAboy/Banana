import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-3xl font-semibold">We couldn’t find that page.</h1>
      <Link href="/" className="mt-6 inline-block underline">
        Back to Banana Lens
      </Link>
    </main>
  );
}
