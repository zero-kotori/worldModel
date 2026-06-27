import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f6] px-6 text-ink">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">页面不存在</h1>
        <Link href="/admin/world-model" className="inline-flex rounded-md bg-moss px-4 py-2 text-sm font-medium text-white hover:bg-moss/90">
          返回世界模型
        </Link>
      </div>
    </main>
  );
}
