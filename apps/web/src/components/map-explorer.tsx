"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Building2, ChevronDown, Crosshair, Database, ExternalLink, Filter, Layers3, List, MapPin, Moon, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, SlidersHorizontal, Sun, Users, X } from "lucide-react";
import maplibregl, { Map, MapGeoJSONFeature } from "maplibre-gl";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { activeDatasetKind, datasetMetadata, establishments } from "@/data/establishment-store";

type MapFeatureProperties = {
  kind: "cluster" | "establishment";
  count?: number;
  label?: string;
  id?: string;
  siren?: string;
  name?: string;
  sector?: string;
  commune?: string;
  description?: string;
  verified?: boolean;
  slug?: string;
  establishmentId?: string;
  siret?: string;
  legalName?: string;
  nafCode?: string;
  address?: string;
  url?: string;
};

type ExplorerEntry = {
  establishmentId: string;
  siren: string;
  siret: string;
  name: string;
  legalName: string;
  commune: string;
  sector: string;
  nafCode: string;
  address: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  slug: string;
  url: string;
  matchType?: "entreprise" | "dirigeant";
  matchedOfficer?: { name: string; role: string } | null;
  source?: string;
  sourceUpdatedAt?: string | null;
};

type SearchSuggestion = {
  id: string;
  kind: "company" | "director" | "commune" | "sector";
  title: string;
  subtitle: string;
  source: string;
  result?: ExplorerEntry;
};

const initialCenter: [number, number] = [-61.565, 16.19];
const initialZoom = 8.8;
const guadeloupeBounds: [[number, number], [number, number]] = [[-61.86, 15.78], [-60.95, 16.55]];
const navigationBounds: [[number, number], [number, number]] = [[-62.8, 14.3], [-59.9, 18.2]];
const initialMapDataUrl = "/api/map/establishments?bbox=-62.2,15.52,-60.62,16.78&zoom=9";
const formatNumber = new Intl.NumberFormat("fr-FR").format;
const baseMapStyles = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/fiord"
} as const;
function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(value: string, rawQuery: string) {
  const token = rawQuery.replace(/^(dirigeant|mandataire|directeur)\s*:\s*/i, "").trim();
  if (!token) return value;
  const parts = value.split(new RegExp(`(${escapeRegExp(token)})`, "ig"));
  return parts.map((part, index) => part.toLocaleLowerCase("fr") === token.toLocaleLowerCase("fr") ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function MapExplorer() {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRequestRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const appliedThemeRef = useRef<"light" | "dark">("light");
  const initialViewAppliedRef = useRef(false);
  const filterStateRef = useRef({ sector: "", commune: "", verified: false, workforceBand: "", headOffice: false, employer: false, postalCode: "", recent: false });
  const [selectedEntry, setSelectedEntry] = useState<ExplorerEntry | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ properties: MapFeatureProperties; x: number; y: number } | null>(null);
  const [resultCount, setResultCount] = useState<number>(Number((datasetMetadata as { geolocatedCount?: number }).geolocatedCount ?? establishments.length));
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ExplorerEntry[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(window.localStorage.getItem("guad-search-history") ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string").slice(0, 6) : [];
    } catch {
      return [];
    }
  });
  const [sector, setSector] = useState("");
  const [commune, setCommune] = useState("");
  const [verified, setVerified] = useState(false);
  const [workforceBand, setWorkforceBand] = useState("");
  const [headOffice, setHeadOffice] = useState(false);
  const [employer, setEmployer] = useState(false);
  const [postalCode, setPostalCode] = useState("");
  const [recent, setRecent] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const sectors = useMemo(() => [...new Set(establishments.map((entry) => entry.secteurNormalise))].sort(), []);
  const communes = useMemo(() => [...new Set(establishments.map((entry) => entry.commune))].sort(), []);
  const workforceOptions = useMemo(() => [
    ["00", "0 salarié"], ["01", "1 à 2 salariés"], ["02", "3 à 5 salariés"], ["03", "6 à 9 salariés"], ["11", "10 à 19 salariés"], ["12", "20 à 49 salariés"], ["21", "50 à 99 salariés"], ["22", "100 à 199 salariés"], ["31", "200 à 249 salariés"], ["32", "250 à 499 salariés"], ["41", "500 à 999 salariés"], ["42", "1 000 à 1 999 salariés"], ["51", "2 000 à 4 999 salariés"], ["52", "5 000 à 9 999 salariés"], ["53", "10 000 salariés ou plus"]] as Array<[string, string]>, []);
  const selectedId = selectedEntry?.establishmentId ?? null;
  filterStateRef.current = { sector, commune, verified, workforceBand, headOffice, employer, postalCode, recent };

  async function requestSearch(rawQuery: string, withSuggestions: boolean) {
    searchRequestRef.current?.abort();
    const controller = new AbortController();
    searchRequestRef.current = controller;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const suffix = withSuggestions ? "&suggest=true" : "";
      const response = await fetch("/api/search?q=" + encodeURIComponent(rawQuery) + suffix, { signal: controller.signal });
      if (!response.ok) throw new Error("Recherche indisponible");
      const data = await response.json() as { results: ExplorerEntry[]; suggestions?: SearchSuggestion[] };
      if (controller.signal.aborted) return;
      setSearchResults(data.results);
      if (withSuggestions) {
        setSuggestions(data.suggestions ?? []);
        setSuggestionsOpen(true);
        setActiveSuggestion(-1);
      } else {
        setSuggestions([]);
        setSuggestionsOpen(false);
        setActiveSuggestion(-1);
      }
    } catch (error) {
      if (!isAbortError(error)) setSearchError(error instanceof Error ? error.message : "Recherche indisponible");
    } finally {
      if (searchRequestRef.current === controller && !controller.signal.aborted) setSearchLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const restoreFilters = window.setTimeout(() => {
      setSector(params.get("sector") ?? "");
      setCommune(params.get("commune") ?? "");
      setVerified(params.get("verified") === "true");
      setWorkforceBand(params.get("workforce") ?? "");
      setHeadOffice(params.get("headOffice") === "true");
      setEmployer(params.get("employer") === "true");
      setPostalCode(params.get("postalCode") ?? "");
      setRecent(params.get("recent") === "true");
    }, 0);
    const controller = new AbortController();
    fetch("/api/search", { signal: controller.signal })
      .then((response) => response.json())
      .then((data: { results: ExplorerEntry[] }) => setSearchResults(data.results.slice(0, 8)))
      .catch((error: Error) => {
        if (error.name !== "AbortError") console.error("Initial search failed", error);
      });
    return () => {
      window.clearTimeout(restoreFilters);
      controller.abort();
      };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseMapStyles.light,
      center: initialCenter,
      zoom: initialZoom,
      maxBounds: navigationBounds,
      minZoom: 8,
      maxZoom: 19,
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    map.on("error", (event) => {
      if (!isAbortError(event.error)) console.warn("Fond cartographique:", event.error?.message ?? event.error);
    });

    const addBusinessLayers = () => {
      if (!map.getSource("guad-communes")) {
        map.addSource("guad-communes", {
          type: "geojson",
          data: "/data/guad-communes.geojson"
        });
      }
      if (!map.getLayer("guad-communes-fill")) {
        map.addLayer({
          id: "guad-communes-fill",
          type: "fill",
          source: "guad-communes",
          paint: {
            "fill-color": "#6bbf9c",
            "fill-opacity": 0.14
          }
        });
      }
      if (!map.getLayer("guad-communes-outline")) {
        map.addLayer({
          id: "guad-communes-outline",
          type: "line",
          source: "guad-communes",
          paint: {
            "line-color": "#006b5d",
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 1.6],
            "line-opacity": 0.72
          }
        });
      }
      if (!map.getSource("establishments")) {
        map.addSource("establishments", {
          type: "geojson",
          data: initialMapDataUrl
        });
      }
      if (!map.getLayer("clusters")) {
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "establishments",
          filter: ["==", ["get", "kind"], "cluster"],
          paint: {
            "circle-color": "#006b5d",
            "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 11, 50, 16, 1000, 22],
            "circle-opacity": 0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
      if (!map.getLayer("cluster-labels")) {
        map.addLayer({
          id: "cluster-labels",
          type: "symbol",
          source: "establishments",
          filter: ["==", ["get", "kind"], "cluster"],
          layout: { "text-field": ["coalesce", ["get", "label"], ["to-string", ["get", "count"]]], "text-font": ["Noto Sans Bold"], "text-size": 12 },
          paint: { "text-color": "#ffffff" }
        });
      }
      if (!map.getLayer("points")) {
        map.addLayer({
          id: "points",
          type: "circle",
          source: "establishments",
          filter: ["==", ["get", "kind"], "establishment"],
          paint: {
            "circle-color": ["case", ["==", ["get", "verified"], true], "#2369d8", "#d75f32"],
            "circle-radius": ["case", ["==", ["get", "id"], selectedId ?? ""], 10, 7],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
      refreshMapData(map);
    };

    const handleStyleReady = () => {
      addBusinessLayers();
      setMapStatus("ready");
      if (initialViewAppliedRef.current) return;
      initialViewAppliedRef.current = true;
      const desktop = window.matchMedia("(min-width: 1101px)").matches;
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      if (mobile) map.once("moveend", () => map.panBy([0, 85], { duration: 0 }));
      map.fitBounds(guadeloupeBounds, {
        padding: desktop ? { top: 54, right: 70, bottom: 62, left: 420 } : { top: mobile ? 190 : 54, right: 32, bottom: 70, left: 32 },
        duration: 0
      });
    };
    map.on("style.load", handleStyleReady);
    map.once("load", handleStyleReady);
    if (map.isStyleLoaded()) handleStyleReady();
    map.on("moveend", () => refreshMapData(map));

    map.on("click", "clusters", (event) => {
      const coordinates = (event.features?.[0].geometry as GeoJSON.Point).coordinates as [number, number];
      map.easeTo({ center: coordinates, zoom: Math.min(map.getZoom() + 2, 13) });
    });
    map.on("click", "points", (event) => {
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
      if (!feature) return;
      const properties = feature.properties as MapFeatureProperties;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const establishmentId = properties.establishmentId ?? properties.id;
      if (establishmentId && properties.siren && properties.name) {
        setSelectedEntry({
          establishmentId,
          siren: properties.siren,
          siret: properties.siret ?? "Non renseigné",
          name: properties.name,
          legalName: properties.legalName ?? properties.name,
          commune: properties.commune ?? "Guadeloupe",
          sector: properties.sector ?? "Secteur non renseigné",
          nafCode: properties.nafCode ?? "Non renseigné",
          address: properties.address ?? properties.commune ?? "Adresse non renseignée",
          description: properties.description ?? "Description non disponible.",
          latitude: coordinates[1],
          longitude: coordinates[0],
          verified: Boolean(properties.verified),
          slug: properties.slug ?? "etablissement",
          url: properties.url ?? `/entreprises/${(properties.commune ?? "guadeloupe").toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${properties.slug ?? "etablissement"}-${properties.siren}`
        });
      }
      if (window.matchMedia("(max-width: 760px)").matches) {
        setHovered(null);
      }
    });
    map.on("mouseenter", "points", (event) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
      if (!feature) return;
      const properties = feature.properties as MapFeatureProperties;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      const width = containerRef.current?.clientWidth ?? 0;
      const height = containerRef.current?.clientHeight ?? 0;
      const x = Math.max(12, Math.min(event.point.x + 16, width - 326));
      const y = Math.max(12, Math.min(event.point.y + 16, height - 250));
      hoverTimer.current = setTimeout(() => setHovered({ properties, x, y }), 120);
    });
    map.on("mouseleave", "points", () => {
      map.getCanvas().style.cursor = "";
      scheduleHoverClose();
    });

    mapRef.current = map;
    return () => {
      mapRequestRef.current?.abort();
      map.remove();
    };
    // MapLibre owns this DOM island; create it once and drive data updates through sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (sector) params.set("sector", sector);
    if (commune) params.set("commune", commune);
    if (verified) params.set("verified", "true");
    if (workforceBand) params.set("workforce", workforceBand);
    if (headOffice) params.set("headOffice", "true");
    if (employer) params.set("employer", "true");
    if (postalCode) params.set("postalCode", postalCode);
    if (recent) params.set("recent", "true");
    window.history.replaceState(null, "", params.size ? `?${params.toString()}` : "/");
    if (mapRef.current?.isStyleLoaded()) refreshMapData(mapRef.current);
  }, [sector, commune, verified, workforceBand, headOffice, employer, postalCode, recent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("points")) return;
    const emphasizedId = selectedId ?? highlightedId ?? "";
    map.setPaintProperty("points", "circle-radius", ["case", ["==", ["get", "id"], emphasizedId], 11, 7]);
    map.setPaintProperty("points", "circle-stroke-width", ["case", ["==", ["get", "id"], emphasizedId], 4, 2]);
  }, [highlightedId, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    setMapStatus("loading");
    map.setStyle(baseMapStyles[theme], { diff: false });
  }, [theme]);

  useEffect(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    searchRequestRef.current?.abort();
    if (normalizedQuery.length < 2) {
      return undefined;
    }
    const timer = window.setTimeout(() => { void requestSearch(query, true); }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  function scheduleHoverClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(null), 180);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setSuggestionsOpen(true);
    setActiveSuggestion(-1);
    const normalizedQuery = nextQuery.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setSuggestions([]);
      setSearchLoading(false);
      setSearchError(null);
    }
  }

  function rememberSearch(value: string) {
    const clean = value.trim();
    if (clean.length < 2) return;
    setSearchHistory((current) => {
      const next = [clean, ...current.filter((item) => item.toLocaleLowerCase("fr") !== clean.toLocaleLowerCase("fr"))].slice(0, 6);
      window.localStorage.setItem("guad-search-history", JSON.stringify(next));
      return next;
    });
  }

  function selectSuggestion(suggestion: SearchSuggestion) {
    rememberSearch(query || suggestion.title);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    if (suggestion.result) {
      centerOn(suggestion.result);
      return;
    }
    if (suggestion.kind === "commune") setCommune(suggestion.title);
    if (suggestion.kind === "sector") setSector(suggestion.title);
    setQuery("");
    setSuggestions([]);
    setSearchError(null);
    setSearchLoading(false);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const showingHistory = !query.trim() && searchHistory.length > 0;
    const count = showingHistory ? searchHistory.length : suggestions.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % count);
      return;
    }
    if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActiveSuggestion((current) => (current <= 0 ? count - 1 : current - 1));
      return;
    }
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (showingHistory && activeSuggestion >= 0) {
        updateQuery(searchHistory[activeSuggestion]);
        setSuggestionsOpen(true);
        return;
      }
      if (!showingHistory && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        selectSuggestion(suggestions[activeSuggestion]);
        return;
      }
      rememberSearch(query);
      setSuggestionsOpen(false);
      if (query.trim().length >= 2) void requestSearch(query.trim(), false);
    }
  }

  async function refreshMapData(map: Map) {
    mapRequestRef.current?.abort();
    const controller = new AbortController();
    mapRequestRef.current = controller;
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
    const params = new URLSearchParams({ bbox, zoom: map.getZoom().toFixed(2) });
    const filters = filterStateRef.current;
    if (filters.sector) params.set("sector", filters.sector);
    if (filters.commune) params.set("commune", filters.commune);
    if (filters.verified) params.set("verified", "true");
    if (filters.workforceBand) params.set("workforce", filters.workforceBand);
    if (filters.headOffice) params.set("headOffice", "true");
    if (filters.employer) params.set("employer", "true");
    if (filters.postalCode) params.set("postalCode", filters.postalCode);
    if (filters.recent) params.set("recent", "true");
    try {
      const response = await fetch(`/api/map/establishments?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Map data request failed (${response.status})`);
      const data = await response.json();
      if (controller.signal.aborted) return;
      const source = map.getSource("establishments") as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: data.features ?? [] });
      setResultCount(data.metadata?.resultCount ?? 0);
    } catch (error) {
      if (!isAbortError(error)) console.error(error);
    }
  }

  function centerOn(entry: ExplorerEntry) {
    setSelectedEntry(entry);
    if (entry.longitude === null || entry.latitude === null) return;
    mapRef.current?.easeTo({
      center: [entry.longitude, entry.latitude],
      zoom: 13,
      padding: window.matchMedia("(min-width: 1101px)").matches ? { top: 70, right: 420, bottom: 70, left: 400 } : { top: 70, right: 24, bottom: 70, left: 24 }
    });
  }

  function resetView() {
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const map = mapRef.current;
    if (!map) return;
    if (mobile) map.once("moveend", () => map.panBy([0, 85], { duration: 0 }));
    map.fitBounds(guadeloupeBounds, {
      padding: window.matchMedia("(min-width: 1101px)").matches ? { top: 54, right: selectedEntry ? 420 : 70, bottom: 62, left: 420 } : { top: mobile ? 190 : 54, right: 32, bottom: 70, left: 32 },
      duration: 700
    });
  }

  function toggleExplorer(nextOpen: boolean) {
    setPanelOpen(nextOpen);
    const map = mapRef.current;
    if (!map || !window.matchMedia("(min-width: 1101px)").matches) return;
    map.easeTo({
      padding: {
        top: 54,
        right: selectedEntry ? 420 : 70,
        bottom: 62,
        left: nextOpen ? 420 : 70
      },
      duration: 320
    });
  }

  const isSearching = query.trim().length >= 2;

  return (
    <section className="map-layout" aria-label="Exploration des établissements de Guadeloupe" data-detail-open={Boolean(selectedEntry)} data-searching={isSearching} data-panel-open={panelOpen}>
      {panelOpen ? <aside className="toolbar" aria-label="Panneau d'exploration">
        <div className="panel-section explorer-intro">
          <div className="explorer-heading-row">
            <div>
              <div className="panel-kicker">
                <MapPin size={15} aria-hidden="true" />
                Explorer l&apos;archipel
              </div>
              <h1 className="explorer-title">La carte des entreprises</h1>
            </div>
            <div className="explorer-heading-actions">
              <button className="icon-button" type="button" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Activer le mode sombre" : "Activer le mode clair"} title={theme === "light" ? "Mode sombre" : "Mode clair"}>
                {theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
              </button>
              <button className="icon-button desktop-only" type="button" onClick={() => toggleExplorer(false)} aria-label="Masquer le panneau" title="Masquer le panneau">
                <PanelLeftClose size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="metric-row explorer-summary" aria-live="polite">
            <span><strong>{formatNumber(resultCount)}</strong> visibles dans cette vue</span>
            <span>{formatNumber(datasetMetadata.establishmentCount)} référencés</span>
          </div>
        </div>
        <div className="panel-section">
          <div className="search-box">
            <label className="label sr-only" htmlFor="search">Recherche</label>
            <div className="search-input-wrap">
              <Search className="search-input-icon" size={19} aria-hidden="true" />
              <input
                ref={searchInputRef}
                id="search"
                className="input search-input"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Entreprise, secteur, NAF, commune…"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen}
                aria-controls="search-suggestions"
                aria-activedescendant={activeSuggestion >= 0 ? query.trim() ? `search-suggestion-${activeSuggestion}` : `search-history-${activeSuggestion}` : undefined}
              />
              {query ? <button className="search-clear" type="button" onClick={() => updateQuery("")} aria-label="Effacer la recherche"><X size={16} /></button> : null}
              {suggestionsOpen && (searchLoading || searchError || suggestions.length > 0 || (!query.trim() && searchHistory.length > 0)) ? <div id="search-suggestions" className="search-suggestions" role="listbox" aria-label="Suggestions de recherche">
                {!query.trim() ? searchHistory.map((item, index) => <button
                  id={`search-history-${index}`}
                  className="search-suggestion"
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  key={`history-${item}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => { updateQuery(item); setSuggestionsOpen(true); searchInputRef.current?.focus(); }}
                >
                  <Search size={16} aria-hidden="true" />
                  <span><strong>{item}</strong><small>Recherche récente</small></span>
                  <span className="search-suggestion-kind">récent</span>
                </button>) : null}
                {suggestions.map((suggestion, index) => <button
                  id={`search-suggestion-${index}`}
                  className="search-suggestion"
                  type="button"
                  role="option"
                  aria-selected={activeSuggestion === index}
                  key={suggestion.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {suggestion.kind === "director" ? <Users size={16} aria-hidden="true" /> : suggestion.kind === "commune" ? <MapPin size={16} aria-hidden="true" /> : suggestion.kind === "sector" ? <Filter size={16} aria-hidden="true" /> : <Building2 size={16} aria-hidden="true" />}
                  <span><strong>{highlightText(suggestion.title, query)}</strong><small>{suggestion.subtitle}</small></span>
                  <span className="search-suggestion-kind">{suggestion.kind === "director" ? "mandat" : suggestion.kind === "commune" ? "commune" : suggestion.kind === "sector" ? "secteur" : "entreprise"}</span>
                </button>)}
                {searchLoading ? <div className="search-suggestion-status" role="status">Recherche en cours…</div> : null}
                {searchError ? <div className="search-suggestion-status search-suggestion-error" role="alert">{searchError}</div> : null}
                {isSearching && !searchLoading && !searchError && suggestions.length === 0 ? <div className="search-suggestion-status">Aucune suggestion pour cette recherche.</div> : null}
              </div> : null}
            </div>
          </div>
          <div className="quick-actions">
            <button className="button filter-trigger" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Filtres
              {(sector || commune || verified || workforceBand || headOffice || employer || postalCode || recent) ? <span className="filter-count">{Number(Boolean(sector)) + Number(Boolean(commune)) + Number(verified) + Number(Boolean(workforceBand)) + Number(headOffice) + Number(employer) + Number(Boolean(postalCode)) + Number(recent)}</span> : null}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={resetView} aria-label="Voir toute la Guadeloupe">
              <Crosshair size={17} aria-hidden="true" />
            </button>
            <button className="icon-button mobile-only" type="button" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Activer le mode sombre" : "Activer le mode clair"}>
              {theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {filtersOpen ? <div className="panel-section filters-panel">
          <h2 className="title"><Filter size={17} aria-hidden="true" /> Affiner la carte</h2>
          <div className="filter-grid">
            <label className="filter-row">
              <span className="label">Secteur</span>
              <select className="input" value={sector} onChange={(event) => setSector(event.target.value)}>
                <option value="">Tous les secteurs</option>
                {sectors.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="filter-row">
              <span className="label">Commune</span>
              <select className="input" value={commune} onChange={(event) => setCommune(event.target.value)}>
                <option value="">Toutes les communes</option>
                {communes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="filter-row">
              <span className="label">Tranche d&apos;effectif</span>
              <select className="input" value={workforceBand} onChange={(event) => setWorkforceBand(event.target.value)}>
                <option value="">Toutes les tranches</option>
                {workforceOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <label className="filter-row">
              <span className="label">Code postal</span>
              <input className="input" inputMode="numeric" pattern="971[0-9]{2}" maxLength={5} value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="97100" />
            </label>
            <label className="badge" style={{ justifyContent: "space-between" }}>
              <span><ShieldCheck size={15} aria-hidden="true" /> Fiches vérifiées</span>
              <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
            </label>
            <label className="badge" style={{ justifyContent: "space-between" }}>
              <span><Building2 size={15} aria-hidden="true" /> Siège uniquement</span>
              <input type="checkbox" checked={headOffice} onChange={(event) => setHeadOffice(event.target.checked)} />
            </label>
            <label className="badge" style={{ justifyContent: "space-between" }}>
              <span><Users size={15} aria-hidden="true" /> Employeur déclaré</span>
              <input type="checkbox" checked={employer} onChange={(event) => setEmployer(event.target.checked)} />
            </label>
            <label className="badge" style={{ justifyContent: "space-between" }}>
              <span>Créé depuis 24 mois</span>
              <input type="checkbox" checked={recent} onChange={(event) => setRecent(event.target.checked)} />
            </label>
            <button className="button" onClick={() => { setSector(""); setCommune(""); setVerified(false); setWorkforceBand(""); setHeadOffice(false); setEmployer(false); setPostalCode(""); setRecent(false); }}>
              <X size={16} aria-hidden="true" /> Réinitialiser
            </button>
          </div>
        </div> : null}
        {isSearching ? <div className="panel-section results-section">
          <h2 className="title"><List size={17} aria-hidden="true" /> Résultats visibles</h2>
          <p className="small muted" aria-live="polite">{searchResults.length} correspondance{searchResults.length > 1 ? "s" : ""} pour « {query.trim()} ».</p>
          <div className="company-list" role="list">
            {searchResults.map((entry) => (
              <button
                key={entry.establishmentId}
                className="company-card"
                data-selected={selectedId === entry.establishmentId}
                type="button"
                role="listitem"
                aria-label={`Sélectionner ${entry.name}`}
                onFocus={() => setHighlightedId(entry.establishmentId)}
                onBlur={() => setHighlightedId(null)}
                onMouseEnter={() => setHighlightedId(entry.establishmentId)}
                onMouseLeave={() => setHighlightedId(null)}
                onClick={() => centerOn(entry)}
              >
                <h3 className="title">{entry.name}</h3>
                <p className="small muted">{entry.commune} · {entry.sector}</p>
                {entry.matchedOfficer ? <p className="small search-match"><strong>{entry.matchedOfficer.name}</strong> · {entry.matchedOfficer.role}</p> : null}
                <div className="badge-row">
                  <span className="badge">{entry.nafCode}</span>
                  {entry.matchType === "dirigeant" ? <span className="badge officer-badge"><ShieldCheck size={14} /> mandat public</span> : null}
                  {entry.verified ? <span className="badge"><ShieldCheck size={14} /> vérifiée</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div> : null}
      </aside> : <button className="open-explorer-button" type="button" onClick={() => toggleExplorer(true)} aria-label="Ouvrir la recherche et les filtres">
        <PanelLeftOpen size={18} aria-hidden="true" />
        <span>Explorer</span>
      </button>}

      <div className="map-wrap">
        <div ref={containerRef} className="map-canvas" aria-label="Carte interactive de la Guadeloupe" />
        {mapStatus !== "ready" ? (
          <div className="map-loading" data-status={mapStatus} role="status">
            <Layers3 size={24} aria-hidden="true" />
            <span>{mapStatus === "loading" ? "Chargement du fond cartographique…" : "Le fond cartographique est temporairement indisponible."}</span>
          </div>
        ) : null}
        <div className="map-overlay">
          <Database size={15} aria-hidden="true" />
          <span title={datasetMetadata.source}><strong>{activeDatasetKind === "real" ? "Données publiques" : "Données locales"}</strong> · mise à jour {datasetMetadata.referenceDate}</span>
        </div>
        <div className="map-legend" aria-label="Légende de la carte">
          <span><i className="legend-dot standard" aria-hidden="true" /> Établissement</span>
          <span><i className="legend-dot verified" aria-hidden="true" /> Fiche vérifiée</span>
          <span><i className="legend-dot cluster" aria-hidden="true" /> Regroupement</span>
        </div>
        {hovered ? (
          <div
            className="preview-card"
            style={{ left: hovered.x, top: hovered.y }}
            onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleHoverClose}
          >
            <h3 className="title">{hovered.properties.name}</h3>
            <p className="small muted">{hovered.properties.sector} · {hovered.properties.commune}</p>
            <p className="small">{hovered.properties.description}</p>
            <div className="badge-row">
              {hovered.properties.verified ? <span className="badge"><ShieldCheck size={14} /> fiche vérifiée</span> : <span className="badge">données publiques non vérifiées</span>}
            </div>
            <Link className="button primary" href={`/entreprises/${encodeURIComponent((hovered.properties.commune ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-"))}/${hovered.properties.slug}-${hovered.properties.siren}`} style={{ marginTop: 12 }}>
              Voir la fiche <ExternalLink size={15} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>

      {selectedEntry ? <aside className="detail-panel" aria-label="Détail établissement">
          <CompanyPanel entry={selectedEntry} onClose={() => setSelectedEntry(null)} onCenter={() => centerOn(selectedEntry)} />
      </aside> : null}

      {selectedEntry ? <div className="sheet" role="dialog" aria-label="Détail établissement" aria-modal="false"><CompanyPanel entry={selectedEntry} onClose={() => setSelectedEntry(null)} onCenter={() => centerOn(selectedEntry)} /></div> : null}
    </section>
  );
}

function CompanyPanel({ entry, onClose, onCenter }: { entry: ExplorerEntry; onClose: () => void; onCenter: () => void }) {
  return (
    <>
      <div className="panel-section">
        <div className="detail-heading-actions">
          <span className="detail-eyebrow">Aperçu établissement</span>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer le détail"><X size={17} aria-hidden="true" /></button>
        </div>
        <div className="badge-row">
          <span className="badge"><Building2 size={14} /> Établissement actif</span>
          {entry.verified ? <span className="badge"><ShieldCheck size={14} /> fiche vérifiée</span> : null}
        </div>
        <h2 className="title" style={{ fontSize: "1.35rem", marginTop: 10 }}>{entry.name}</h2>
        {entry.legalName !== entry.name ? <p className="small muted">{entry.legalName}</p> : null}
        <p>{entry.description}</p>
        <Link className="button primary" href={entry.url as Route}>Fiche complète</Link>
      </div>
      <div className="panel-section">
        <h3 className="title">Informations publiques</h3>
        <p className="small"><MapPin size={15} aria-hidden="true" /> {entry.address}</p>
        <p className="small">SIREN {entry.siren} · SIRET {entry.siret}</p>
        <p className="small">NAF {entry.nafCode} · {entry.sector}</p>
      </div>
      <div className="panel-section">
        <h3 className="title">Transparence</h3>
        <p className="small muted">Description factuelle générée automatiquement depuis le code NAF. Source publique non vérifiée par l&apos;établissement.</p>
        <div className="badge-row">
          <Link className="button" href={`${entry.url}#transparence` as Route}>Sources et corrections</Link>
          <button className="button" type="button" onClick={onCenter}><Crosshair size={15} /> Centrer</button>
        </div>
      </div>
    </>
  );
}
