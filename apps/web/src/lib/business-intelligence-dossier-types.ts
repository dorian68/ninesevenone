export type DossierConfidence = "high" | "medium" | "low";
export type DossierEvidenceKind = "fact" | "absence" | "warning";

export type DossierEvidence = {
  id: string;
  label: string;
  value: string;
  source: string;
  sourceUrl: string | null;
  referenceDate: string | null;
  confidence: DossierConfidence;
  kind: DossierEvidenceKind;
  scope?: string | null;
};

export type DossierSection = {
  id: string;
  title: string;
  intro: string;
  evidence: DossierEvidence[];
};

export type DossierTimelineItem = {
  id: string;
  date: string;
  label: string;
  detail: string | null;
  source: string;
  sourceUrl: string | null;
  confidence: number;
};

export type DossierPressMention = {
  title: string;
  url: string;
  domain: string | null;
  publishedAt: string | null;
  source: string;
  confidence: number;
};

export type DossierGovernanceEdge = {
  id: string;
  from: string;
  to: string;
  role: string;
  referenceDate: string | null;
  source: string;
  sourceUrl: string | null;
};

export type BusinessIntelligenceDossier = {
  version: "1";
  siren: string;
  retrievedAt: string;
  summary: string;
  description: {
    text: string;
    source: string;
    sourceUrl: string | null;
    evidence: string;
    confidence: DossierConfidence;
    referenceDate: string | null;
  };
  highlights: DossierEvidence[];
  sections: DossierSection[];
  timeline: DossierTimelineItem[];
  press: DossierPressMention[];
  governance: {
    edges: DossierGovernanceEdge[];
    note: string;
  };
  coverage: {
    observedSources: number;
    totalSources: number;
    evidenceCount: number;
    sources: Array<{
      source: string;
      status: "ok" | "empty" | "unavailable";
      detail: string | null;
      sourceUrl: string | null;
    }>;
  };
  limits: string[];
};
