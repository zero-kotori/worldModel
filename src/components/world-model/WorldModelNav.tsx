"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { worldModelSections } from "@/lib/world-model-navigation";

function isActiveSection(pathname: string, href: string) {
  if (href === "/admin/world-model") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorldModelNav() {
  const pathname = usePathname() ?? "/admin/world-model";

  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {worldModelSections.map((section) => {
        const active = isActiveSection(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-md border border-moss bg-moss px-3 py-2 font-semibold text-white shadow-sm"
                : "rounded-md border border-transparent px-3 py-2 text-ink/70 hover:bg-moss/10 hover:text-moss"
            }
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
