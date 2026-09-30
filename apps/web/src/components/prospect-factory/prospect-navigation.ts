export type TrackingView = "rows" | "kanban" | "market" | "map";
export type MapReturnView = TrackingView | "explore";
export type AccountMapNavigationState = {
  mode: "organization" | "decision";
  presentation: "graph" | "table" | null;
  opportunityId: string | null;
  nodeQuery: string;
  kind: string;
  status: string;
};

export function withAccountMapNavigation(baseUrl: string, state: AccountMapNavigationState) {
  const url = new URL(baseUrl, "https://guad.invalid");
  const values: Record<string, string | null> = {
    crmMapMode: state.mode === "decision" ? state.mode : null,
    crmMapPresentation: state.presentation,
    crmMapOpportunity: state.opportunityId,
    crmMapNodeQuery: state.nodeQuery || null,
    crmMapKind: state.kind || null,
    crmMapStatus: state.status || null
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}`;
}

export function trackingViewFromValue(value: string | null): TrackingView {
  return value === "rows" || value === "kanban" || value === "market" || value === "map" ? value : "market";
}

export function accountMapReturnUrl(
  accountId: string,
  sourceView: MapReturnView,
  currentSearch = "",
  drawerId?: string | null,
  drawerTab?: string | null
) {
  const params = new URLSearchParams(currentSearch);
  params.set("workspace", sourceView === "explore" ? "explore" : "tracking");
  if (sourceView !== "explore") params.set("crmView", sourceView);
  params.set("crmAccount", accountId);
  if (sourceView === "market") params.set("crmMarketAccount", accountId);
  if (sourceView === "map") params.set("crmMapAccount", accountId);
  if (drawerId) params.set("crmDrawer", drawerId); else params.delete("crmDrawer");
  if (drawerId && drawerTab) params.set("crmDrawerTab", drawerTab); else params.delete("crmDrawerTab");
  return `/prospects?${params}`;
}

export function accountMapUrl(
  accountId: string,
  sourceView: MapReturnView,
  currentSearch = "",
  drawerId?: string | null,
  drawerTab?: string | null
) {
  const returnTo = accountMapReturnUrl(accountId, sourceView, currentSearch, drawerId, drawerTab);
  return `/prospects/cartographie/${encodeURIComponent(accountId)}?${new URLSearchParams({ returnTo })}`;
}

export function safeAccountMapReturnUrl(value: string | null | undefined, accountId: string) {
  const fallback = accountMapReturnUrl(accountId, "map");
  if (!value || value.length > 8_000 || !/^\/prospects(?:\?|$)/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://guad.invalid");
    return url.origin === "https://guad.invalid" && url.pathname === "/prospects"
      ? `${url.pathname}${url.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
