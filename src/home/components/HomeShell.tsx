"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Menu, MenuItem } from "@/components/ui/controls";
import { BRAND, Logo } from "@/components/brand";
import { ChevronDownIcon, CloseIcon, FolderIcon, GridIcon, HelpIcon, PlusIcon, SearchIcon, SettingsIcon, TemplateIcon } from "@/components/ui/icons";
import { refreshLibrary } from "../library";
import { initials, useProfileName } from "../profile";
import { homeUi, newProjectHref, useHomeUi } from "../ui";

const NAV = [
  { href: "/", label: "Projects", Icon: FolderIcon, match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/new", label: "New project", Icon: PlusIcon, match: (p: string) => p.startsWith("/new") },
  { href: "/house-plans", label: "House plans", Icon: GridIcon, match: (p: string) => p.startsWith("/house-plans") },
  { href: "/templates", label: "Templates", Icon: TemplateIcon, match: (p: string) => p.startsWith("/templates") },
  { href: "/help", label: "Help", Icon: HelpIcon, match: (p: string) => p.startsWith("/help") },
  { href: "/settings", label: "Settings", Icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
] as const;

/** Sidebar, header and notices shared by every home page. */
export function HomeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The library lives in IndexedDB; reload it on arrival and when returning to the tab.
  useEffect(() => {
    void refreshLibrary();
    const onVisible = () => document.visibilityState === "visible" && void refreshLibrary();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="home-shell">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      <div className="home-main">
        {/* The new-project page has its own breadcrumb and close button instead. */}
        {!pathname.startsWith("/new") && <HomeHeader />}
        <main id="content" className="home-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <HomeNotice />
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="home-sidebar">
      <Link href="/" className="home-brand">
        <Logo withName />
      </Link>
      <nav className="home-nav" aria-label="Main">
        {NAV.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
              <Icon width={20} height={20} />
              {label}
            </Link>
          );
        })}
      </nav>
      <ProfileMenu />
    </aside>
  );
}

function ProfileMenu() {
  const router = useRouter();
  const name = useProfileName();
  return (
    <Menu
      label="Profile"
      className="home-profile"
      summary={
        <span className="home-profile-chip">
          <span className="avatar" aria-hidden>
            {initials(name) || <Logo size={16} />}
          </span>
          <span className="home-profile-name">{name || "Your workspace"}</span>
          <ChevronDownIcon width={16} height={16} />
        </span>
      }
    >
      <MenuItem onSelect={() => router.push("/settings")}>{name ? "Profile and settings" : "Add your name…"}</MenuItem>
      <MenuItem onSelect={() => router.push("/help")}>Help</MenuItem>
    </Menu>
  );
}

function HomeHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useHomeUi((s) => s.query);
  const searchable = pathname === "/" || pathname.startsWith("/projects");
  return (
    <header className="home-header">
      <Link href="/" className="home-brand home-brand-compact" aria-label={`${BRAND.name} home`}>
        <Logo size={24} />
      </Link>
      <div className="home-search">
        <SearchIcon width={18} height={18} />
        <input
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
          value={query}
          data-testid="project-search"
          onChange={(e) => {
            homeUi.setState({ query: e.target.value });
            if (!searchable) router.push("/projects");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") homeUi.setState({ query: "" });
          }}
        />
      </div>
      <Link href={newProjectHref()} className="btn btn-primary btn-md" data-testid="new-project">
        <PlusIcon width={18} height={18} />
        New project
      </Link>
    </header>
  );
}

function HomeNotice() {
  const notice = useHomeUi((s) => s.notice);
  if (!notice) return null;
  return (
    <div className={`home-notice home-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} data-testid="home-notice">
      <span>{notice.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => homeUi.setState({ notice: null })}>
        <CloseIcon width={16} height={16} />
      </button>
    </div>
  );
}
