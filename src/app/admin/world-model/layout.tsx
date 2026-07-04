import { WorldModelNav } from "@/components/world-model/WorldModelNav";

export default function WorldModelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7f6]">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold text-ink">世界模型</h1>
            <p className="text-xs text-ink/60">私有认知管理后台</p>
          </div>
          <WorldModelNav />
        </div>
      </header>
      {children}
    </div>
  );
}
