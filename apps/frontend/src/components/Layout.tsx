import {
  Gauge,
  ListChecks,
  MailCheck,
  Menu,
  SearchCheck,
  UploadCloud
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";

const navItems = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/verify-list", label: "Verify List", icon: UploadCloud },
  { to: "/jobs", label: "Lists", icon: ListChecks },
  { to: "/manual", label: "Manual Verify", icon: SearchCheck }
];

export function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-ink">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-line bg-white px-4 py-5 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-600 text-white">
            <MailCheck size={21} aria-hidden />
          </div>
          <div>
            <div className="text-lg font-semibold leading-5">NoBounce</div>
            <div className="text-xs text-slate-500">Arken Tech Solutions</div>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-emerald-50 text-emerald-800"
                      : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                  )
                }
              >
                <Icon size={18} aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="focus-ring rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle navigation"
          >
            <Menu size={22} aria-hidden />
          </button>
          <div className="hidden text-sm font-medium text-slate-500 lg:block">
            nobounce.arkentechsolutions.com
          </div>
          <div className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            Backend only Reacher access
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {open && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/20 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
