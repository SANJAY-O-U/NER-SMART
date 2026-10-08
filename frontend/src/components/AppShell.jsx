import Header from "./Header";
import { Sidebar, MobileNav, useActiveSection, scrollToSection } from "./Sidebar";

/**
 * Application frame: sidebar + sticky header (+ mobile section chips). It owns presentation only;
 * every handler and flag is passed straight through to Header unchanged.
 *
 * `withNav` is false for the loading / error states, where no dashboard sections exist to scroll to.
 */
export default function AppShell({ children, withNav = true, ...headerProps }) {
  const [active, setActive] = useActiveSection();

  const navigate = (id) => {
    setActive(id);
    scrollToSection(id);
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-slate-900 md:flex">
      {withNav && <Sidebar active={active} onNavigate={navigate} />}
      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-[1200]">
          <Header {...headerProps} />
          {withNav && <MobileNav active={active} onNavigate={navigate} />}
        </div>
        {children}
      </div>
    </div>
  );
}
