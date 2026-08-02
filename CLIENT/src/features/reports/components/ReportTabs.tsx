/**
 * URL-synced tab bar for the consolidated report pages.
 *
 * WHY THE URL AND NOT useState
 * ----------------------------
 * These tabs replace what used to be twelve sidebar destinations. If tab state
 * lived only in React, everything those links could do would quietly regress:
 * you couldn't bookmark the Returns report, couldn't send it to someone,
 * refreshing would bounce you to the first tab, and Back would leave the page
 * entirely instead of returning to the previous tab.
 *
 * `?tab=` keeps all of that working, and lets the old /admin/reports/returns
 * style URLs redirect to the owning tab instead of 404ing.
 *
 * `replace` is used when writing the default tab so landing on a page doesn't
 * push a duplicate history entry you'd have to press Back through twice.
 */

import { useSearchParams } from "react-router";
import { cn } from "@/utils/cn";

export interface ReportTabDef {
  /** URL value — this is the contract with the legacy redirects. */
  id: string;
  label: string;
  /** Rendered only while this tab is active, so idle reports issue no queries. */
  render: () => React.ReactNode;
}

export function useReportTab(tabs: ReportTabDef[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = tabs[0]?.id ?? "";
  const requested = searchParams.get("tab");

  // An unknown ?tab= (stale bookmark, typo) resolves to the first tab rather
  // than rendering an empty page.
  const active = tabs.some((t) => t.id === requested) ? (requested as string) : fallback;

  const setActive = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    // Each tab switch IS a history entry — Back should step back through tabs,
    // which is what the old one-route-per-report navigation did.
    setSearchParams(next);
  };

  return { active, setActive };
}

interface ReportTabsProps {
  tabs: ReportTabDef[];
  active: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist, e.g. "Sales reports". */
  label: string;
}

export function ReportTabs({ tabs, active, onChange, label }: ReportTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`report-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`report-panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              selected
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The whole page: tab bar plus the active panel.
 *
 * Only the active tab is rendered. Each report page owns its own filter state
 * and data hooks, so mounting all of them would fire every report's queries on
 * every visit — the opposite of what consolidating the navigation is for.
 */
export function TabbedReportPage({ tabs, label }: { tabs: ReportTabDef[]; label: string }) {
  const { active, setActive } = useReportTab(tabs);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <ReportTabs tabs={tabs} active={active} onChange={setActive} label={label} />
      <div
        role="tabpanel"
        id={`report-panel-${current?.id ?? ""}`}
        aria-labelledby={`report-tab-${current?.id ?? ""}`}
      >
        {current?.render()}
      </div>
    </div>
  );
}
