import { expect, test } from "@playwright/test";

test("loads the map explorer and opens a company page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Guadeloupe Entreprises")).toBeVisible();
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 15_000 });
  const mapBounds = await page.locator(".map-canvas").boundingBox();
  expect(mapBounds?.height).toBeGreaterThan(500);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const searchResponse = page.waitForResponse((response) => response.url().includes("/api/search?q=Basse-Terre") && response.ok());
  await page.getByLabel("Recherche").fill("Basse-Terre");
  await searchResponse;
  const firstResult = page.getByRole("listitem").filter({ hasText: /BASSE-TERRE ·/ }).first();
  await expect(firstResult).toBeVisible();
  await expect(firstResult).toContainText("BASSE-TERRE");
  await firstResult.click();
  await expect(page.locator(".map-layout")).toHaveAttribute("data-detail-open", "true", { timeout: 10_000 });
  await expect(page.locator(".sheet, .detail-panel").getByRole("link", { name: "Fiche complète" }).first()).toBeVisible();
});

test("shares filters through the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Filtres/ }).click();
  await page.getByLabel("Commune").selectOption({ label: "LES ABYMES" });
  await expect(page).toHaveURL(/commune=LES(\+|%20)ABYMES/);
  await expect(page.locator(".metric-row span").first()).toContainText("visibles");
});

test("navigates structured suggestions for a public director", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Recherche").fill("dirigeant:lady bird");
  const suggestion = page.getByRole("option").filter({ hasText: "LADY BIRD" }).first();
  await expect(suggestion).toBeVisible({ timeout: 20_000 });
  await expect(suggestion).toContainText("mandat");
  await page.getByRole("combobox", { name: "Recherche" }).press("ArrowDown");
  await page.getByRole("combobox", { name: "Recherche" }).press("Enter");
  await expect(page.getByLabel("Détail établissement").getByRole("heading", { name: "RHUM DAMOISEAU" })).toBeVisible();
});

test("persists advanced SIRENE filters in the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Filtres/ }).click();
  await page.getByLabel("Tranche d'effectif").selectOption("12");
  await page.getByLabel("Siège uniquement").check();
  await page.getByLabel("Employeur déclaré").check();
  await expect(page).toHaveURL(/workforce=12/);
  await expect(page).toHaveURL(/headOffice=true/);
  await expect(page).toHaveURL(/employer=true/);
});

test("searches a public legal officer without exposing personal details", async ({ page }) => {
  const response = await page.request.get("/api/search?q=LADY%20BIRD");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { results: Array<{ matchType: string; matchedOfficer: { name: string; role: string } | null }> };
  const match = payload.results.find((result) => result.matchType === "dirigeant" && result.matchedOfficer?.name === "LADY BIRD");
  expect(match?.matchedOfficer?.role).toBe("Président de SAS");
  expect(JSON.stringify(payload)).not.toMatch(/date_de_naissance|nationalite|telephone|email/i);
});

test("finds an establishment through an observed public service signal", async ({ page }) => {
  const response = await page.request.get("/api/search?q=seafood");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { results: Array<{ siren: string; source?: string; matchedSignal?: string }> };
  const match = payload.results.find((result) => result.siren === "794502682");
  expect(match?.source).toBe("OpenStreetMap");
  expect(match?.matchedSignal).toContain("seafood");
});

test("keeps realtime suggestions local and bounded", async ({ page }) => {
  const response = await page.request.get("/api/search?q=restauration&suggest=true");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { metadata?: { officialSearch?: boolean }; suggestions?: unknown[] };
  expect(payload.metadata?.officialSearch).toBe(false);
  expect(payload.suggestions?.length).toBeGreaterThan(0);
});

test("tolerates a bounded typo without loading the full database", async ({ page }) => {
  const response = await page.request.get("/api/search?q=restaurtion&suggest=true");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { results: Array<{ siren: string; name: string; description: string }> };
  expect(payload.results.some((result) => result.siren === "884077884")).toBeTruthy();
  expect(payload.results.length).toBeLessThanOrEqual(24);
});

test("renders public website enrichment server-side", async ({ page }) => {
  await page.route("**/api/companies/130005481/intelligence", (route) => route.abort());
  await page.goto("/entreprises/baie-mahault/france-travail-130005481");
  await expect(page.getByRole("link", { name: "Site web" })).toHaveAttribute("href", "https://www.francetravail.fr/accueil/");
  const schema = await page.locator('script[type="application/ld+json"]').textContent();
  expect(schema).toContain("francetravail.fr");
  await expect(page.getByText("Source de description: activité NAF")).toBeVisible();
});

test("uses the public data studio for shortlists and targeted CV drafts", async ({ page }) => {
  await page.goto("/outils");
  await expect(page.getByRole("heading", { name: "Transformer la donnée en action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Entreprises à qualifier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Ajouter" }).first().click();
  await expect(page.getByText("1 / 50", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exporter CSV" })).toBeEnabled();
  await page.getByRole("tab", { name: "CV ciblé" }).click();
  await page.getByLabel("Nom affiché").fill("Profil test");
  await page.getByLabel("Poste recherché").fill("Chargé de projet");
  await page.getByRole("button", { name: "Générer le brouillon" }).click();
  await expect(page.locator(".cv-output")).toContainText("Profil test");
  await expect(page.locator(".cv-output")).toContainText("NOTE DE TRANSPARENCE");
});

test("persists a shortlist and saved search in the workspace", async ({ page }) => {
  await page.goto("/outils");
  await page.getByLabel("Recherche entreprise ou secteur").fill("restauration");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("Recherche enregistrée");
  await page.getByRole("button", { name: "Ajouter" }).first().click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Shortlist enregistrée");
  await page.reload();
  await expect(page.getByText("1 / 50", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 recherche\(s\), 1 shortlist\(s\)/)).toBeVisible();
  await page.evaluate(() => fetch("/api/workspace", { method: "DELETE" }));
});

test("uses a selected BI profile as a factual CV target", async ({ page }) => {
  await page.route("**/api/companies/*/intelligence", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      retrievedAt: "2026-07-19T10:00:00.000Z",
      companyProfile: {
        summary: "Entreprise enregistrée dans l’activité « Conseil en gestion ».",
        activity: { code: "70.22Z", label: "Conseil pour les affaires et autres conseils de gestion" },
        services: [{ label: "Audit organisationnel", source: "Site professionnel public", confidence: "high" }],
        signals: [{ label: "Site professionnel public identifié", detail: "1 site", source: "Sites publics", confidence: "medium" }],
        size: { workforceBand: "10 à 19 salariés", workforceYear: 2025, companyCategory: "PME", establishmentCount: 1, employerEstablishmentCount: 1 },
        coverage: { observedSources: 3, evidenceCount: 4 }
      },
      bodacc: { total: 5 },
      publicContracts: { total: 2, totalAmount: 12500 },
      press: { total: 3, cacheStatus: "partial" },
      recruitment: { status: "empty", total: 0 },
      websites: { descriptionsCount: 1, offeringsCount: 1, accessibleSitesCount: 1 },
      annuaire: { dirigeants: [{ displayName: "DIRIGEANT PUBLIC", role: "Président" }] },
      patents: { total: 2, grantedCount: 1, technologySectionCount: 1 },
      financialRatios: { total: 3, latestClosingDate: "2025-12-31" }
    })
  }));
  await page.goto("/outils");
  await page.getByRole("button", { name: "BI" }).first().click();
  await expect(page.getByText("Lecture BI")).toBeVisible();
  await expect(page.getByText("Audit organisationnel", { exact: true })).toBeVisible();
  await expect(page.locator(".studio-facts").first()).toContainText("Événements BODACC");
  await expect(page.locator(".studio-facts").first()).toContainText("Marchés publics");
  await expect(page.locator(".studio-facts").first()).toContainText("Mentions presse");
  await expect(page.getByText(/Autres signaux BI/)).toBeVisible();
  await page.getByRole("button", { name: "Proposition", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Préparer une proposition commerciale" })).toBeVisible();
  await page.getByLabel("Objectif ou besoin à valider").fill("Clarifier le besoin avec le prospect");
  await page.getByLabel("Prestations proposées").fill("Audit initial");
  await page.getByRole("button", { name: "Générer la proposition" }).click();
  await expect(page.locator(".cv-output")).toContainText("CONTEXTE PUBLIC OBSERVÉ");
  await expect(page.locator(".cv-output")).toContainText("Commande publique publiée");
  await page.getByRole("tab", { name: "Prospection" }).click();
  await page.getByRole("button", { name: "BI" }).first().click();
  await expect(page.getByText("Lecture BI")).toBeVisible();
  await page.getByRole("button", { name: "Cibler le CV" }).click();
  await expect(page.getByText("Cible sélectionnée")).toBeVisible();
  await page.getByLabel("Nom affiché").fill("Profil ciblé");
  await page.getByRole("button", { name: "Générer le brouillon" }).click();
  await expect(page.locator(".cv-output")).toContainText("ENTREPRISE CIBLE");
  await expect(page.locator(".cv-output")).toContainText("Audit organisationnel");
  await expect(page.locator(".cv-output")).toContainText("Taille publiée");
  await expect(page.locator(".cv-output")).toContainText("Commande publique publiée");
  await expect(page.locator(".cv-output")).toContainText("Innovation publiée");
});

test("opens and exports a sourced business intelligence dossier", async ({ page }) => {
  await page.route("**/api/companies/*/intelligence", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      retrievedAt: "2026-07-19T10:00:00.000Z",
      companyProfile: {
        summary: "Activité publiée dans le conseil en gestion.",
        activity: { code: "70.22Z", label: "Conseil pour les affaires et autres conseils de gestion" },
        services: [{ label: "Audit organisationnel", source: "Site professionnel public", confidence: "high" }],
        signals: [{ label: "Site professionnel public identifié", detail: "1 site", source: "Sites publics", confidence: "medium" }],
        size: { workforceBand: "10 à 19 salariés", workforceYear: 2025, companyCategory: "PME", establishmentCount: 1, employerEstablishmentCount: 1 },
        coverage: { observedSources: 3, evidenceCount: 4 }
      },
      bodacc: { total: 2 },
      publicContracts: { total: 1, totalAmount: 12500 },
      press: { total: 1, cacheStatus: "partial" },
      recruitment: { status: "empty", total: 0 },
      websites: { descriptionsCount: 1, offeringsCount: 1, accessibleSitesCount: 1 },
      annuaire: { dirigeants: [{ displayName: "DIRIGEANT PUBLIC", role: "Président" }] },
      patents: { total: 1, grantedCount: 1, technologySectionCount: 1 },
      financialRatios: { total: 2, latestClosingDate: "2025-12-31" }
    })
  }));
  await page.route("**/api/companies/*/dossier", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      version: "1",
      siren: "101259794",
      retrievedAt: "2026-07-19T10:00:00.000Z",
      summary: "Activité publiée dans le conseil en gestion.",
      description: { text: "Activité publiée dans le conseil en gestion.", source: "Site professionnel public", sourceUrl: "https://example.test", evidence: "Extrait publié", confidence: "high", referenceDate: "2026-07-19" },
      highlights: [{ id: "activity", label: "Activité principale publiée", value: "Conseil en gestion · 70.22Z", source: "SIRENE", sourceUrl: "https://example.test", referenceDate: "2026-07-01", confidence: "high", kind: "fact" }],
      sections: [{ id: "identity", title: "Activité et prestations", intro: "Faits observés.", evidence: [{ id: "service", label: "Prestation observée", value: "Audit organisationnel", source: "Site professionnel public", sourceUrl: "https://example.test", referenceDate: "2026-07-19", confidence: "high", kind: "fact" }] }],
      timeline: [{ id: "event", date: "2026-03-11", label: "Création publiée", detail: "Baie-Mahault", source: "BODACC", sourceUrl: "https://example.test", confidence: 1 }],
      press: [{ title: "Mention publique", url: "https://example.test/press", domain: "example.test", publishedAt: "2026-02-01", source: "Veille média", confidence: 0.5 }],
      governance: { edges: [{ id: "edge", from: "DIRIGEANT PUBLIC", to: "Entreprise Innovation E2E", role: "Président", referenceDate: "2026-07-01", source: "RNE", sourceUrl: "https://example.test" }], note: "Mandats légaux publiés uniquement." },
      coverage: { observedSources: 3, totalSources: 4, evidenceCount: 3, sources: [{ source: "SIRENE", status: "ok", detail: null, sourceUrl: "https://example.test" }, { source: "Presse", status: "empty", detail: null, sourceUrl: "https://example.test" }] },
      limits: ["La presse n’est pas exhaustive."]
    })
  }));
  await page.goto("/outils");
  await page.getByRole("button", { name: "BI" }).first().click();
  await page.getByRole("button", { name: "Ouvrir le dossier BI" }).click();
  await expect(page.getByText("Dossier sourcé")).toBeVisible();
  await expect(page.getByLabel(/Dossier BI de/).getByText("Audit organisationnel", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Dossier BI de/).locator("summary").filter({ hasText: "Mandats légaux publiés" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exporter Markdown" })).toBeEnabled();
});

test("returns a bounded sourced dossier without personal fields", async ({ page }) => {
  const response = await page.request.get("/api/companies/303091086/dossier");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { siren: string; sections: unknown[]; coverage: { evidenceCount: number }; governance: { edges: unknown[] } };
  expect(payload.siren).toBe("303091086");
  expect(payload.sections.length).toBeGreaterThanOrEqual(3);
  expect(payload.coverage.evidenceCount).toBeGreaterThan(0);
  expect(payload.governance.edges.length).toBeGreaterThan(0);
  expect(JSON.stringify(payload)).not.toMatch(/date_de_naissance|nationalite|telephone_personnel|adresse_personnelle/i);
});

test("stores a public report and claim for server-side moderation", async ({ page }) => {
  const report = await page.request.post("/api/companies/303091086/report", {
    data: { category: "factual_error", message: "Le libellé de cette fiche doit être vérifié par un administrateur." }
  });
  expect(report.status()).toBe(201);
  const claim = await page.request.post("/api/companies/303091086/claim", {
    data: {
      claimantName: "Demandeur de test",
      professionalEmail: "test@example.invalid",
      companyRole: "Responsable",
      evidenceUrl: "https://example.invalid/proof",
      message: "Je demande une vérification de cette fiche avec un justificatif professionnel public.",
      consent: true
    }
  });
  expect(claim.status()).toBe(201);
  const unauthorized = await page.request.get("/api/admin/reports");
  expect(unauthorized.status()).toBe(401);
  expect((await page.request.get("/api/admin/updates?status=pending")).status()).toBe(401);
  expect((await page.request.get("/api/admin/audit")).status()).toBe(401);
  expect((await page.request.post("/api/companies/303091086/update-request", { data: { claimId: "00000000-0000-0000-0000-000000000000", professionalEmail: "contact@example.com", siteWeb: "https://example.com" } })).status()).toBe(403);
});

test("explores sourced business intelligence on a company page", async ({ page }) => {
  await page.route("**/api/companies/101259794/intelligence", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      retrievedAt: "2026-07-18T10:00:00.000Z",
      methodology: "Correspondance exacte par SIREN/SIRET.",
      timeline: [{
        id: "bodacc-A1",
        date: "2026-03-11",
        label: "Création publiée",
        detail: "Baie-Mahault · SAS",
        source: "BODACC",
        sourceUrl: "https://www.bodacc.fr/",
        confidence: 1
      }],
      statuses: [
        { source: "SIRENE", status: "ok" },
        { source: "RNA", status: "ok" },
        { source: "Annuaire", status: "ok" },
        { source: "Organismes de formation", status: "ok" },
        { source: "Conventions & OPCO", status: "ok" },
        { source: "Brevets", status: "ok" },
        { source: "Ratios financiers", status: "ok" },
        { source: "Bilans détaillés", status: "ok" },
        { source: "Géorisques ICPE", status: "ok" },
        { source: "SCDL", status: "ok" },
        { source: "ADEME Aides", status: "ok" },
        { source: "Fonds vert", status: "ok" },
        { source: "France Relance", status: "ok" },
        { source: "OSM", status: "ok" },
        { source: "Sites publics", status: "ok" },
        { source: "ADEME RGE", status: "ok" },
        { source: "BODACC", status: "ok" },
        { source: "DECP", status: "ok" },
        { source: "Presse", status: "ok" }
      ],
      officialProfile: {
        total: 1,
        socialEconomy: true,
        missionCompany: true,
        associationId: null,
        companyCategory: "PME",
        companyCategoryYear: 2023,
        workforceBandCode: "11",
        workforceBand: "10 à 19 salariés",
        workforceYear: 2023,
        periodStartDate: "2024-05-03",
        lastProcessedAt: "2026-06-12T14:10:00",
        periodCount: 4,
        establishmentCount: 2,
        headOfficeCount: 1,
        employerEstablishmentCount: 2,
        datedWorkforceEstablishmentCount: 2,
        sourceReferenceDate: "2026-07-01",
        source: "StockUniteLegale SIRENE INSEE/data.gouv.fr"
      },
      association: {
        total: 1,
        activeCount: 1,
        dissolvedCount: 0,
        statusConflictCount: 0,
        purposeCount: 1,
        publicUtilityCount: 0,
        identifierWarningCount: 0,
        qualityWarningCount: 0,
        sourceReferenceDate: "2026-07-01",
        sourceUrl: "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale",
        license: "Licence Ouverte 2.0",
        profiles: [{
          rnaId: "W9G1000001",
          formerId: null,
          siret: "10125979400010",
          identifierStatus: "rna_exact_siret_match",
          matchConfidence: 1,
          publicUtilityId: null,
          creationDate: "2020-01-02",
          declarationDate: "2026-02-03",
          publicationDate: "2020-01-10",
          dissolutionDate: null,
          natureCode: "D",
          groupType: "S",
          title: "ASSOCIATION DE TEST E2E",
          shortTitle: "TEST E2E",
          purpose: "Développer des actions culturelles ouvertes au public.",
          purposeCodes: ["006000"],
          website: null,
          status: "active",
          updatedAt: "2026-02-03 10:00:00",
          sourceReferenceDate: "2026-07-01",
          sourceUrl: "https://www.data.gouv.fr/datasets/rna-agrege-a-lechelle-nationale"
        }]
      },
      annuaire: {
        total: 1,
        financials: [{ year: "2025", revenue: 460000, netIncome: 38000 }],
        labels: ["Certification Qualiopi"],
        aidSignals: ["Aide ADEME signalée"],
        agreements: ["IDCC 1486"],
        companyCategory: "PME",
        workforceBand: "10 à 19 salariés",
        workforceYear: "2025",
        naf25: "Services spécialisés",
        establishments: 2,
        openEstablishments: 2,
        dirigeants: [{ displayName: "DIRIGEANT PUBLIC", role: "Président", officerType: "personne physique", relatedSiren: null, sourceUpdatedAt: "2026-07-01" }],
        sourceUrl: "https://annuaire-entreprises.data.gouv.fr/"
      },
      governanceNetwork: {
        mode: "published_legal_mandates",
        nodes: [
          { id: "person:dirigeant-public", kind: "person", label: "DIRIGEANT PUBLIC", siren: null, roles: ["Président"] },
          { id: "company:101259794", kind: "company", label: "Entreprise Innovation E2E", siren: "101259794", roles: [] }
        ],
        edges: [{ id: "edge-1", source: "person:dirigeant-public", target: "company:101259794", role: "Président", sourceUpdatedAt: "2026-07-01" }],
        note: "Réseau construit à partir des mandats légaux publiés."
      },
      trainingOrganizations: {
        total: 1,
        displayedCount: 1,
        guadeloupeCount: 1,
        outsideCount: 0,
        activeLocalCount: 1,
        qualityCount: 1,
        specialtyCount: 1,
        metricsCount: 1,
        qualityTrainingCount: 1,
        qualitySkillsCount: 0,
        qualityVaeCount: 0,
        qualityApprenticeshipCount: 1,
        earliestDeclarationDate: "2026-05-26",
        latestDeclarationDate: "2026-05-26",
        latestExerciseEndDate: "2025-12-31",
        truncated: false,
        sourceRowCount: 164453,
        matchedCompanyCount: 1404,
        sourceUpdatedAt: "2026-07-18T15:24:26Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail",
        license: "Licence Ouverte",
        profiles: [{
          id: "training-1",
          siren: "101259794",
          siret: "10125979400010",
          matchScope: "active_local_establishment",
          matchConfidence: 1,
          registrationLocationScope: "guadeloupe",
          activityDeclarationNumber: "01971234567",
          previousActivityNumbers: null,
          postalCode: "97122",
          city: "BAIE-MAHAULT",
          regionCode: "01",
          isQualityCertified: true,
          qualityCategories: ["Actions de formation", "Actions de formation par apprentissage"],
          lastDeclarationDate: "2026-05-26",
          exerciseStartDate: "2025-01-01",
          exerciseEndDate: "2025-12-31",
          specialties: [
            { code: "227", label: "Energie, génie climatique" },
            { code: "255", label: "Electricité, électronique" }
          ],
          traineeCount: 2211,
          entrustedTraineeCount: 774,
          trainerCount: 40,
          resourceTitle: "Liste publique des Organismes de Formation (format CSV)",
          resourceUrl: "https://www.monactiviteformation.emploi.gouv.fr/mon-activite-formation/public/listePubliqueOF?format=csv",
          resourceLastModified: "2026-07-18T15:18:30Z",
          sourceUpdatedAt: "2026-07-18T15:24:26Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/liste-publique-des-organismes-de-formation-l-6351-7-1-du-code-du-travail",
          license: "Licence Ouverte",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      professionalEquality: {
        total: 3,
        displayedCount: 3,
        calculableCount: 2,
        nonCalculableCount: 1,
        directCount: 3,
        uesCount: 0,
        guadeloupeCount: 3,
        earliestYear: 2023,
        latestYear: 2025,
        latestCalculableYear: 2025,
        latestScore: 94,
        scoreDelta: 3,
        sourceRowCount: 214040,
        matchedCompanyCount: 460,
        sourceUpdatedAt: "2026-07-18T00:02:48Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
        egaproUrl: "https://egapro.travail.gouv.fr/consulter-index",
        license: "Licence Ouverte 2.0",
        declarations: [{
          id: "equality-2025",
          siren: "101259794",
          declaringSiren: "101259794",
          matchScope: "exact_declarant",
          matchConfidence: 1,
          referenceYear: 2025,
          structureType: "company",
          workforceBand: "50 à 250",
          uesName: null,
          uesMemberCount: null,
          declarationLocationScope: "guadeloupe",
          declaringRegion: "Guadeloupe",
          declaringDepartment: "Guadeloupe",
          declaringCountry: "FRANCE",
          nafCode: "62.02A",
          nafLabel: "Conseil en systèmes et logiciels informatiques",
          indexScore: 94,
          indexStatus: "calculated",
          indicators: [
            { key: "payGap", label: "Écart de rémunération", score: 39, maximum: 40, status: "calculated" },
            { key: "raiseGap", label: "Écart de taux d’augmentation", score: 30, maximum: 35, status: "calculated" },
            { key: "maternityReturn", label: "Retour de congé maternité", score: 15, maximum: 15, status: "calculated" },
            { key: "highestRemuneration", label: "Dix plus hautes rémunérations", score: 10, maximum: 10, status: "calculated" }
          ],
          resourceTitle: "Index Egalité Professionnelle F/H",
          resourceUrl: "https://egapro.travail.gouv.fr/index-egalite-fh.xlsx",
          resourceLastModified: "2026-07-18T02:02:48Z",
          sourceUpdatedAt: "2026-07-18T00:02:48Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
          egaproUrl: "https://egapro.travail.gouv.fr/consulter-index",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "equality-2024",
          siren: "101259794",
          declaringSiren: "101259794",
          matchScope: "exact_declarant",
          matchConfidence: 1,
          referenceYear: 2024,
          structureType: "company",
          workforceBand: "50 à 250",
          uesName: null,
          uesMemberCount: null,
          declarationLocationScope: "guadeloupe",
          declaringRegion: "Guadeloupe",
          declaringDepartment: "Guadeloupe",
          declaringCountry: "FRANCE",
          nafCode: "62.02A",
          nafLabel: "Conseil en systèmes et logiciels informatiques",
          indexScore: 91,
          indexStatus: "calculated",
          indicators: [],
          resourceTitle: "Index Egalité Professionnelle F/H",
          resourceUrl: "https://egapro.travail.gouv.fr/index-egalite-fh.xlsx",
          resourceLastModified: "2026-07-18T02:02:48Z",
          sourceUpdatedAt: "2026-07-18T00:02:48Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
          egaproUrl: "https://egapro.travail.gouv.fr/consulter-index",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "equality-2023",
          siren: "101259794",
          declaringSiren: "101259794",
          matchScope: "exact_declarant",
          matchConfidence: 1,
          referenceYear: 2023,
          structureType: "company",
          workforceBand: "50 à 250",
          uesName: null,
          uesMemberCount: null,
          declarationLocationScope: "guadeloupe",
          declaringRegion: "Guadeloupe",
          declaringDepartment: "Guadeloupe",
          declaringCountry: "FRANCE",
          nafCode: "62.02A",
          nafLabel: "Conseil en systèmes et logiciels informatiques",
          indexScore: null,
          indexStatus: "not_calculable",
          indicators: [{ key: "payGap", label: "Écart de rémunération", score: null, maximum: 40, status: "not_calculable" }],
          resourceTitle: "Index Egalité Professionnelle F/H",
          resourceUrl: "https://egapro.travail.gouv.fr/index-egalite-fh.xlsx",
          resourceLastModified: "2026-07-18T02:02:48Z",
          sourceUpdatedAt: "2026-07-18T00:02:48Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/index-egalite-professionnelle-f-h-des-entreprises-de-50-salaries-ou-plus",
          egaproUrl: "https://egapro.travail.gouv.fr/consulter-index",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      collectiveAgreements: {
        total: 1,
        displayedCount: 1,
        agreementCount: 2,
        agreementEstablishmentCount: 1,
        substantiveAgreementCount: 2,
        escapeAgreementCount: 0,
        distinctIdccCount: 2,
        multiIdccEstablishmentCount: 1,
        titledAgreementCount: 2,
        opcoAssignmentCount: 1,
        assignedOpcoCount: 1,
        opcoAnomalyCount: 0,
        effectiveOpcoCount: 1,
        effectiveOpcos: ["AKTO"],
        crossSourceDifferenceCount: 0,
        idccReferenceMonth: "2026-05",
        siroReferenceMonth: "2026-04",
        sourceRowCount: 5935136,
        matchedCompanyCount: 16520,
        sourceUpdatedAt: "2026-07-16T08:23:14Z",
        siroSourceUpdatedAt: "2026-05-11T07:50:25Z",
        idccSourceUrl: "https://www.data.gouv.fr/datasets/liste-des-conventions-collectives-par-entreprise-siret",
        siroSourceUrl: "https://www.data.gouv.fr/datasets/table-siret-opco",
        kaliSourceUrl: "https://github.com/SocialGouv/kali-data",
        kaliVersion: "3.479.0",
        license: "Licence Ouverte 2.0",
        establishments: [{
          siret: "10125979400010",
          commune: "BAIE-MAHAULT",
          isHeadOffice: true,
          employer: true,
          idccDifference: false,
          agreements: [{
            id: "agreement-1",
            idcc: "1486",
            status: "declared_code",
            label: "Bureaux d’études techniques",
            title: "Convention collective nationale des bureaux d’études techniques",
            shortTitle: "Bureaux d’études techniques",
            kaliId: "KALICONT000005635173",
            baseTextStatus: "VIGUEUR_ETEN",
            legifranceUrl: "https://www.legifrance.gouv.fr/liste/idcc?facetteIdcc=1486",
            referenceMonth: "2026-05"
          }, {
            id: "agreement-2",
            idcc: "3127",
            status: "declared_code",
            label: "Entreprises de services à la personne",
            title: "Convention collective nationale des entreprises de services à la personne",
            shortTitle: "Entreprises de services à la personne",
            kaliId: "KALICONT000044594539",
            baseTextStatus: "VIGUEUR_ETEN",
            legifranceUrl: "https://www.legifrance.gouv.fr/liste/idcc?facetteIdcc=3127",
            referenceMonth: "2026-05"
          }],
          opco: {
            id: "opco-1",
            idcc: "1486",
            idccStatus: "declared_code",
            idccLabel: "Bureaux d’études techniques",
            ownerOpco: "ATLAS",
            managingOpco: "AKTO",
            effectiveOpco: "AKTO",
            status: "assigned",
            referenceMonth: "2026-04"
          }
        }]
      },
      patents: {
        total: 2,
        displayedCount: 2,
        applicationCount: 7,
        grantedCount: 1,
        internationalCount: 1,
        epoCount: 1,
        titleCount: 2,
        abstractCount: 2,
        earliestApplicationDate: "2018-02-22",
        latestApplicationDate: "2024-01-10",
        applicationAuthorityCount: 4,
        technologyCount: 14,
        technologySectionCount: 3,
        sections: [
          { code: "C", label: "Chimie et métallurgie", familyCount: 2 },
          { code: "A", label: "Nécessités courantes de la vie", familyCount: 1 }
        ],
        truncated: false,
        sourceApplicantRows: 949226,
        matchedCompanyCount: 70,
        indexedFamilyCount: 19588,
        indexedApplicationCount: 66233,
        applicantsSourceUpdatedAt: "2026-05-11T13:57:55Z",
        familiesSourceUpdatedAt: "2025-06-11T22:00:00Z",
        technologiesSourceUpdatedAt: "2026-05-11T14:16:07Z",
        applicantsSourceUrl: "https://www.data.gouv.fr/datasets/deposants-des-brevets-1",
        familiesSourceUrl: "https://www.data.gouv.fr/datasets/familles-de-brevets",
        technologiesSourceUrl: "https://www.data.gouv.fr/datasets/technologies-des-familles-de-brevets",
        license: "Licence Ouverte 2.0",
        scope: "national_legal_unit",
        families: [{
          id: "patent-family-1",
          familyDocdb: "80218316",
          familyInpadoc: "548403661",
          applicantNames: ["Entreprise Innovation E2E"],
          applicationCount: 6,
          firstPublicationDate: "2025-07-10",
          firstApplicationDate: "2024-01-10",
          epoApplication: true,
          internationalApplication: true,
          granted: false,
          firstGrantDate: null,
          title: "Procédé documenté de valorisation de biomasse",
          abstract: "L’invention publiée décrit un procédé de transformation de biomasse dans des conditions contrôlées.",
          technologyCount: 9,
          sections: [{ code: "C", label: "Chimie et métallurgie" }],
          classes: [{ code: "C12", label: "BIOCHEMISTRY" }],
          subclasses: [{ code: "C12P", label: "FERMENTATION PROCESSES" }],
          scanrUrl: "https://scanr.enseignementsup-recherche.gouv.fr/patents/80218316",
          scope: "national_legal_unit",
          sourceUpdatedAt: "2025-06-11T22:00:00Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/familles-de-brevets",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "patent-family-2",
          familyDocdb: "62167530",
          familyInpadoc: "494771056",
          applicantNames: ["Entreprise Innovation E2E"],
          applicationCount: 1,
          firstPublicationDate: "2019-08-23",
          firstApplicationDate: "2018-02-22",
          epoApplication: false,
          internationalApplication: false,
          granted: true,
          firstGrantDate: "2022-05-27",
          title: "Système de fabrication à faible teneur en gluten",
          abstract: "Le résumé public décrit un système de fabrication associé.",
          technologyCount: 5,
          sections: [{ code: "A", label: "Nécessités courantes de la vie" }],
          classes: [{ code: "A21", label: "BAKING EDIBLE DOUGHS" }],
          subclasses: [{ code: "A21D", label: "TREATMENT OF FLOUR OR DOUGH" }],
          scanrUrl: "https://scanr.enseignementsup-recherche.gouv.fr/patents/62167530",
          scope: "national_legal_unit",
          sourceUpdatedAt: "2025-06-11T22:00:00Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/familles-de-brevets",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      financialRatios: {
        total: 3,
        publicCount: 2,
        partiallyConfidentialCount: 1,
        completeCount: 2,
        simplifiedCount: 1,
        consolidatedCount: 0,
        earliestClosingDate: "2023-12-31",
        latestClosingDate: "2024-12-31",
        matchedCompanyCount: 9281,
        indexedExerciseCount: 35009,
        sourceRowCount: 6542232,
        sourceUpdatedAt: "2026-06-01T15:27:20Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
        license: "Licence Ouverte 2.0",
        scope: "national_legal_unit",
        definitions: [{
          field: "chiffre_d_affaires",
          label: "Chiffre_d_affaires",
          unit: "EUR",
          description: "Revenu total généré par l’entreprise",
          formulaCompleteOrConsolidated: "FL",
          formulaSimplified: "210+214+218"
        }],
        exercises: [{
          id: "finance-c-2024",
          closingDate: "2024-12-31",
          statementType: "C",
          confidentiality: "Public",
          partiallyConfidential: false,
          dateQuality: "published",
          metricCount: 19,
          revenue: 16710965,
          grossMargin: 9582210,
          ebe: 810752,
          ebit: 484376,
          netIncome: 415919,
          debtRatio: 29.458,
          liquidityRatio: 161.331,
          assetAgeRatio: 61.2,
          financialAutonomy: 39.904,
          operatingWorkingCapitalRatio: 15.208,
          interestCoverage: 3.174,
          cashFlowToRevenue: 4.267,
          repaymentCapacity: 1.028,
          ebeMargin: 4.852,
          currentPreTaxToRevenue: 2.745,
          operatingWorkingCapitalDays: 54.748,
          stockRotationDays: 13.16,
          customerCreditDays: 87.237,
          supplierCreditDays: 41.08,
          sourceUpdatedAt: "2026-06-01T15:27:20Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "finance-c-2023",
          closingDate: "2023-12-31",
          statementType: "C",
          confidentiality: "Partiellement confidentiel",
          partiallyConfidential: true,
          dateQuality: "published",
          metricCount: 19,
          revenue: null,
          grossMargin: null,
          ebe: null,
          ebit: null,
          netIncome: -139367,
          debtRatio: 79.596,
          liquidityRatio: 284.277,
          assetAgeRatio: 48.1,
          financialAutonomy: 47.997,
          operatingWorkingCapitalRatio: null,
          interestCoverage: 2.1,
          cashFlowToRevenue: null,
          repaymentCapacity: 2.8,
          ebeMargin: null,
          currentPreTaxToRevenue: null,
          operatingWorkingCapitalDays: null,
          stockRotationDays: null,
          customerCreditDays: 62,
          supplierCreditDays: 31,
          sourceUpdatedAt: "2026-06-01T15:27:20Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "finance-s-2024",
          closingDate: "2024-12-31",
          statementType: "S",
          confidentiality: "Public",
          partiallyConfidential: false,
          dateQuality: "published",
          metricCount: 19,
          revenue: 1234000,
          grossMargin: 640000,
          ebe: 102000,
          ebit: 81000,
          netIncome: 61000,
          debtRatio: 24,
          liquidityRatio: 155,
          assetAgeRatio: 44,
          financialAutonomy: 45,
          operatingWorkingCapitalRatio: 12,
          interestCoverage: 4,
          cashFlowToRevenue: 5,
          repaymentCapacity: 1.2,
          ebeMargin: 8.2,
          currentPreTaxToRevenue: 4.4,
          operatingWorkingCapitalDays: 43,
          stockRotationDays: 11,
          customerCreditDays: 55,
          supplierCreditDays: 34,
          sourceUpdatedAt: "2026-06-01T15:27:20Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/ratios-financiers-bce-inpi",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      detailedFinancials: {
        total: 2,
        partiallyConfidentialCount: 1,
        earliestClosingDate: "2023-12-31",
        latestClosingDate: "2024-12-31",
        matchedCompanyCount: 8700,
        indexedStatementCount: 32000,
        rawCellCount: 4100000,
        sourceUpdatedAt: "2026-02-10T08:23:27Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet",
        fullFormUrl: "https://www.impots.gouv.fr/formulaire/2050-liasse/liasse-fiscale-du-regime-reel-normal-en-matiere-de-bic-et-dis",
        simplifiedFormUrl: "https://www.impots.gouv.fr/formulaire/2033-sd/liasse-bicsi-regime-rsi-tableaux-ndeg-2033-sd-2033-g-sd",
        license: "Licence Ouverte 2.0",
        scope: "national_legal_unit",
        statements: [{
          id: "detail-c-2024", closingDate: "2024-12-31", statementType: "C", confidentiality: "Public", partiallyConfidential: false, dateQuality: "published",
          cellCount: 119, metricCount: 24, balanceSheetTotal: 10978420, equity: 4381040, provisions: 125000, financialDebt: 2471000, totalDebt: 6472370,
          fixedAssetsGross: 7250000, fixedAssetsNet: 4218000, currentAssetsGross: 7284420, currentAssetsNet: 6760420, inventoryGross: 642000, inventoryNet: 612000,
          tradeReceivablesGross: 4380000, tradeReceivablesNet: 4210000, cashAndSecuritiesNet: 1578420, tradePayables: 1884000, taxSocialDebt: 1054000, capital: 900000,
          revenue: 16710965, operatingResult: 484376, currentPreTaxResult: 458720, netIncome: 415919, personnelCosts: 4381000, externalPurchases: 5128000, taxes: 318000,
          sourceUpdatedAt: "2026-02-10T08:23:27Z", datasetUrl: "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet", resourceUrl: "https://static.data.gouv.fr/detail.parquet", license: "Licence Ouverte 2.0", licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }, {
          id: "detail-c-2023", closingDate: "2023-12-31", statementType: "C", confidentiality: "Partiellement confidentiel", partiallyConfidential: true, dateQuality: "published",
          cellCount: 76, metricCount: 17, balanceSheetTotal: 8210000, equity: 3940000, provisions: 95000, financialDebt: 1810000, totalDebt: 4175000,
          fixedAssetsGross: 5010000, fixedAssetsNet: 2910000, currentAssetsGross: 5570000, currentAssetsNet: 5300000, inventoryGross: 510000, inventoryNet: 498000,
          tradeReceivablesGross: 3140000, tradeReceivablesNet: 3010000, cashAndSecuritiesNet: 1270000, tradePayables: 1330000, taxSocialDebt: 870000, capital: 900000,
          revenue: null, operatingResult: null, currentPreTaxResult: null, netIncome: null, personnelCosts: null, externalPurchases: null, taxes: null,
          sourceUpdatedAt: "2026-02-10T08:23:27Z", datasetUrl: "https://www.data.gouv.fr/datasets/donnees-financieres-detaillees-des-entreprises-format-parquet", resourceUrl: "https://static.data.gouv.fr/detail.parquet", license: "Licence Ouverte 2.0", licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      environmentalCompliance: {
        total: 1,
        displayedCount: 1,
        activeSiretCount: 1,
        authorizationCount: 1,
        registrationCount: 0,
        sevesoCount: 0,
        iedCount: 1,
        nationalPriorityCount: 1,
        latestSourceUpdate: "2026-07-17T19:32:59Z",
        latestInspectionDate: "2026-04-12",
        inspectionCount: 1,
        rubricCount: 1,
        documentCount: 1,
        indexedInstallationCount: 329,
        matchedCompanyCount: 288,
        sourceUpdatedAt: "2026-07-17T19:32:59Z",
        sourceUrl: "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
        license: "Licence Ouverte 2.0",
        truncated: false,
        installations: [{
          id: "icpe-1",
          aiotCode: "0006900001",
          siret: "10125979400011",
          matchScope: "exact_active_siret",
          address: "Zone industrielle · 97122 · Baie-Mahault",
          postalCode: "97122",
          communeCode: "97103",
          commune: "Baie-Mahault",
          nafDivision: "35",
          longitude: -61.59,
          latitude: 16.25,
          categories: ["Industrie"],
          nationalPriority: true,
          sevesoStatus: "Non Seveso",
          ied: true,
          activityStatus: "En exploitation avec titre",
          inspectionService: "DEAL Guadeloupe",
          regime: "Autorisation",
          sourceUpdatedAt: "2026-07-17T19:32:59Z",
          detailUrl: "https://www.georisques.gouv.fr/risques/installations/donnees/details/0006900001",
          sourceUrl: "https://www.georisques.gouv.fr/donnees/bases-de-donnees/installations-industrielles",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://github.com/etalab/licence-ouverte/blob/master/LO.md",
          inspections: [{ id: "inspection-1", inspectionDate: "2026-04-12", documentDate: "2026-04-13", documentType: "Rapport d’inspection", documentUrl: "https://www.georisques.gouv.fr/public/inspection" }],
          rubrics: [{ id: "rubric-1", number: "2910", nature: "Installation de combustion", paragraph: "A-2", authorizedRegime: "Autorisation", totalQuantity: "12,5", unit: "MW", reasonDate: "2025-02-01" }],
          documents: [{ id: "document-1", documentDate: "2025-02-02", documentType: "Arrêté préfectoral", documentUrl: "https://www.georisques.gouv.fr/public/document" }]
        }]
      },
      publicGrants: {
        total: 1,
        displayedCount: 1,
        totalAmount: 25000,
        earliestDate: "2024-05-10",
        latestDate: "2024-05-10",
        authorityCount: 1,
        sourceCount: 1,
        activeEstablishmentCount: 0,
        historicalEstablishmentCount: 1,
        associationMatchCount: 0,
        truncated: false,
        catalogDatasetCount: 53,
        openDatasetCount: 33,
        importedResourceCount: 52,
        sourceReferenceDate: "2026-07-01",
        importedAt: "2026-07-18T23:45:34Z",
        schemaUrl: "https://schema.data.gouv.fr/scdl/subventions/",
        catalogUrl: "https://www.data.gouv.fr/datasets/?schema=scdl%2Fsubventions",
        grants: [{
          id: "grant-1",
          siret: "10125979499999",
          rnaId: null,
          beneficiaryName: "SCORPHTATTOO JARRY",
          awardingAuthority: "Région Test",
          awardingAuthoritySiret: "11111111100011",
          conventionDate: "2024-05-10",
          decisionReference: "DEC-2024-42",
          purpose: "Programme de transformation numérique",
          amount: 25000,
          nature: "numéraire",
          paymentConditions: "versement unique",
          paymentPeriod: "2024-06-01/2024-12-31",
          raeId: null,
          euNotification: false,
          subsidyPercentage: 100,
          aidScheme: "Transition numérique",
          matchMethod: "exact_company_siret",
          matchConfidence: 0.98,
          beneficiaryScope: "company_historical_establishment",
          sourceReferenceDate: "2026-07-01",
          sourceLastModified: "2026-07-01T10:00:00Z",
          sourceOccurrenceCount: 1,
          datasetTitle: "Conventions de subvention test",
          datasetUrl: "https://www.data.gouv.fr/datasets/test",
          resourceTitle: "Subventions 2024",
          resourceUrl: "https://example.com/subventions.csv",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      ademeAids: {
        total: 1,
        displayedCount: 1,
        totalAmount: 48000,
        activeLocalCount: 1,
        activeLocalAmount: 48000,
        companyScopeCount: 0,
        companyScopeAmount: 0,
        schemeCount: 1,
        earliestDate: "2026-02-10",
        latestDate: "2026-02-10",
        truncated: false,
        sourceRowCount: 39160,
        sourceUpdatedAt: "2026-07-18T07:00:20Z",
        sourceUrl: "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe",
        dataGouvUrl: "https://www.data.gouv.fr/datasets/les-aides-financieres-de-lademe-1",
        license: "Licence Ouverte / Open Licence",
        aids: [{
          id: "ademe-aid-1",
          siret: "10125979400010",
          scope: "active_local_establishment",
          matchConfidence: 1,
          awardingAuthority: "ADEME",
          awardingAuthoritySiret: "38529030900454",
          conventionDate: "2026-02-10",
          decisionReference: "ADEME-2026-42",
          beneficiaryName: "SCORPHTATTOO JARRY",
          purpose: "Installation solaire sur l’établissement guadeloupéen",
          aidScheme: "Fonds chaleur",
          amount: 48000,
          nature: "aide en numéraire",
          paymentConditions: "Unique",
          paymentPeriod: "2026-03-01_2027-03-01",
          raeId: null,
          euNotification: false,
          sourceUpdatedAt: "2026-07-18T07:00:20Z",
          sourceUrl: "https://data.ademe.fr/datasets/les-aides-financieres-de-l'ademe",
          dataGouvUrl: "https://www.data.gouv.fr/datasets/les-aides-financieres-de-lademe-1",
          license: "Licence Ouverte / Open Licence",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence"
        }]
      },
      fondsVert: {
        total: 1,
        displayedCount: 1,
        totalAmount: 180000,
        guadeloupeCount: 1,
        guadeloupeAmount: 180000,
        outsideCount: 0,
        outsideAmount: 0,
        unknownLocationCount: 0,
        activeLocalCount: 1,
        activeLocalAmount: 180000,
        schemeCount: 1,
        earliestYear: 2025,
        latestYear: 2025,
        truncated: false,
        sourceRowCount: 25240,
        resourceCount: 3,
        excludedResourceCount: 1,
        sourceUpdatedAt: "2026-06-22T08:56:24Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes",
        license: "Licence Ouverte 2.0",
        projects: [{
          id: "fonds-vert-1",
          year: 2025,
          siren: "101259794",
          siret: "10125979400010",
          beneficiaryIdentifier: "10125979400010",
          identifierType: "siret",
          matchScope: "active_local_establishment",
          matchConfidence: 1,
          projectLocationScope: "guadeloupe",
          projectName: "Rénovation énergétique du site de Baie-Mahault",
          projectSummary: "Le projet porte sur la rénovation énergétique du bâtiment professionnel.",
          committedAmount: 180000,
          beneficiaryName: "SCORPHTATTOO JARRY",
          beneficiaryLegalForm: "SAS",
          dossierNumber: "FV-2025-42",
          commitmentNumber: "EJ-2025-42",
          operatorNumber: null,
          operator: "État",
          scheme: "Rénovation énergétique",
          axis: null,
          region: "Guadeloupe",
          department: "Guadeloupe",
          departmentCode: "971",
          commune: "Baie-Mahault",
          communeCode: "97103",
          resourceTitle: "fonds-vert-2025-export.csv",
          resourceUrl: "https://static.data.gouv.fr/fonds-vert-2025-export.csv",
          resourceLastModified: "2026-06-22T08:56:23Z",
          sourceUpdatedAt: "2026-06-22T08:56:24Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/fonds-vert-liste-des-projets-subventionnes",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      franceRelance: {
        total: 1,
        displayedCount: 1,
        guadeloupeCount: 1,
        outsideCount: 0,
        unknownLocationCount: 0,
        activeLocalCount: 1,
        descriptionCount: 1,
        co2MetricCount: 1,
        measureCount: 1,
        sectorCount: 1,
        earliestDate: "2022-03-21",
        latestDate: "2022-03-21",
        truncated: false,
        sourceRowCount: 3080,
        sourceUpdatedAt: "2022-04-08T17:07:56Z",
        sourceUrl: "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets",
        portalUrl: "https://data.economie.gouv.fr/explore/dataset/plan-de-relance/",
        license: "Licence Ouverte 2.0",
        individualAmountsAvailable: false,
        projects: [{
          id: "france-relance-1",
          siren: "101259794",
          siret: "10125979400010",
          beneficiaryIdentifier: "10125979400010",
          identifierType: "siret",
          matchScope: "active_local_establishment",
          matchConfidence: 1,
          projectLocationScope: "guadeloupe",
          beneficiaryName: "SCORPHTATTOO JARRY",
          companyType: "TPE / PME",
          recoveryAxis: "Verdissement",
          measure: "Efficacité énergétique et évolution des procédés dans l’industrie",
          measureLabel: "Décarbonation de l’industrie",
          projectDescription: "Le projet public porte sur une nouvelle installation industrielle plus performante.",
          sector: "Chimie et Matériaux",
          expectedCo2Tonnes: 42.5,
          updateDate: "2022-03-21",
          region: "Guadeloupe",
          department: "Guadeloupe",
          departmentCode: "971",
          commune: "Baie-Mahault",
          postalCode: "97122",
          latitude: 16.24,
          longitude: -61.56,
          resourceTitle: "plan-de-relance.csv",
          resourceUrl: "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/plan-de-relance/exports/csv",
          resourceLastModified: "2022-04-08T17:07:56Z",
          sourceUpdatedAt: "2022-04-08T17:07:56Z",
          datasetUrl: "https://www.data.gouv.fr/datasets/plan-de-relance-projets-industriels-liste-geolocalisation-et-description-synthetique-des-projets",
          portalUrl: "https://data.economie.gouv.fr/explore/dataset/plan-de-relance/",
          license: "Licence Ouverte 2.0",
          licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
        }]
      },
      osmPresence: {
        total: 1,
        websites: ["https://example.com"],
        phones: ["+590 590 00 00 00"],
        categories: ["Service · Conseil"],
        openingHoursCount: 1,
        accessibilityCount: 1,
        socialProfilesCount: 1,
        activeMatchesCount: 1,
        staleReferencesCount: 0,
        sourceReferenceDate: "2026-07-17T22:24:43Z",
        importedAt: "2026-07-18T10:00:00Z",
        license: "ODbL 1.0",
        attribution: "© OpenStreetMap contributors",
        sourceUrl: "https://download.geofabrik.de/europe/france/guadeloupe.html",
        profiles: [{
          id: "node/1",
          siret: "10125979400010",
          name: "Point d’accueil test",
          brand: null,
          operator: null,
          category: "Service · Conseil",
          website: "https://example.com",
          phone: "+590 590 00 00 00",
          openingHours: "Mo-Fr 08:00-17:00",
          wheelchair: "yes",
          internetAccess: null,
          address: "Jarry, Baie-Mahault",
          description: "Implantation professionnelle publiée dans OpenStreetMap.",
          latitude: 16.24,
          longitude: -61.56,
          services: [{ key: "service", value: "business consulting" }],
          socialProfiles: [{ platform: "instagram", url: "https://instagram.com/example" }],
          sourceUrl: "https://www.openstreetmap.org/node/1",
          establishmentStatus: "active_match",
          matchConfidence: 1,
          dataConfidence: 0.8
        }]
      },
      websites: {
        total: 1,
        accessibleSitesCount: 1,
        descriptionsCount: 1,
        offeringsCount: 2,
        socialProfilesCount: 1,
        blockedCount: 0,
        errorCount: 0,
        generatedAt: "2026-07-18T20:00:00Z",
        methodology: "Homepage uniquement; RFC 9309; aucun HTML brut ni email.",
        descriptions: [{
          text: "L’entreprise présente des prestations de conseil et d’accompagnement professionnel.",
          source: "jsonld",
          confidence: 0.9,
          siteName: "Site professionnel",
          url: "https://example.com",
          establishmentStatus: "active_match",
          fetchedAt: "2026-07-18T20:00:00Z"
        }],
        offerings: [{
          name: "Audit organisationnel",
          source: "jsonld",
          confidence: 0.9,
          siteName: "Site professionnel",
          url: "https://example.com",
          establishmentStatus: "active_match"
        }, {
          name: "Accompagnement stratégique",
          source: "service_section_heading",
          confidence: 0.65,
          siteName: "Site professionnel",
          url: "https://example.com",
          establishmentStatus: "active_match"
        }],
        sites: [{
          id: "101259794-10125979400010-https://example.com",
          siret: "10125979400010",
          sourceName: "Site professionnel",
          inputUrl: "https://example.com",
          url: "https://example.com",
          hostname: "example.com",
          robotsStatus: "allowed",
          fetchStatus: "ok",
          httpStatus: 200,
          title: "Site professionnel",
          description: "L’entreprise présente des prestations de conseil et d’accompagnement professionnel.",
          descriptionSource: "jsonld",
          offerings: [],
          socialProfiles: [],
          structuredTypes: ["Organization"],
          language: "fr",
          restricted: false,
          lastModified: null,
          fetchedAt: "2026-07-18T20:00:00Z",
          errorDetail: null,
          establishmentStatus: "active_match",
          descriptionConfidence: 0.9
        }]
      },
      rge: {
        total: 1,
        activeCount: 1,
        historicalCount: 0,
        domains: ["Isolation thermique"],
        organizations: ["qualibat"],
        truncated: false,
        sourceUpdatedAt: "2026-07-18T03:01:13Z",
        sourceUrl: "https://data.ademe.fr/datasets/historique-rge",
        license: "Licence Ouverte 2.0",
        qualifications: [{
          id: "RGE-1",
          siret: "10125979400010",
          companyName: "SCORPHTATTOO JARRY",
          qualificationCode: "7122",
          qualificationName: "Isolation thermique par l’intérieur",
          certificateName: "Qualibat",
          domains: ["Isolation thermique"],
          metaDomain: "Travaux d’efficacité énergétique",
          organization: "qualibat",
          forIndividuals: true,
          startDate: "2026-01-01",
          endDate: "2027-01-01",
          status: "active",
          certificateUrl: "https://example.com/certificat.pdf",
          updatedAt: "2026-07-18T03:01:13Z",
          confidence: 1
        }]
      },
      bodacc: {
        total: 1,
        activities: ["Activité officielle déclarée."],
        events: [{ id: "A1", date: "2026-03-11", title: "Création", city: "Baie-Mahault", legalForm: "SAS", capital: 1000, capitalCurrency: "EUR", url: "https://www.bodacc.fr/" }]
      },
      publicContracts: {
        total: 1,
        totalAmount: 120000,
        contracts: [{ id: "M1", title: "Marché de services", date: "2026-01-10", amount: 120000, durationMonths: 12, buyer: "Acheteur public", cpvLabel: "Services", executionPlace: "Guadeloupe", sourceUrl: "https://data.economie.gouv.fr/" }]
      },
      press: {
        total: 1,
        mentions: [{ title: "Une entreprise se développe", url: "https://example.com/article", domain: "example.com", publishedAt: "2026-06-12", sourceCountry: "France", confidence: 0.58 }]
      },
      companyProfile: {
        summary: "L’entreprise présente des prestations de conseil et d’accompagnement professionnel.",
        descriptionSource: "official_website",
        descriptionConfidence: "high",
        descriptionEvidence: "Extrait publié sur un site professionnel relié à l’unité légale ou à un établissement.",
        activity: { code: "62.02A", label: "Conseil en systèmes et logiciels informatiques" },
        services: [{ label: "Audit organisationnel", source: "Site professionnel public", sourceUrl: "https://example.com", confidence: "high" }],
        size: { workforceBand: "10 à 19 salariés", workforceYear: 2025, companyCategory: "PME", establishmentCount: 2, employerEstablishmentCount: 2, source: "SIRENE INSEE", sourceReferenceDate: "2026-07-01" },
        signals: [{ label: "Certification Qualiopi", detail: null, source: "Annuaire des Entreprises", sourceUrl: "https://annuaire-entreprises.data.gouv.fr/", referenceDate: "2026-07-01", confidence: "high" }],
        proofs: [{ label: "Activité principale", detail: "Conseil en systèmes et logiciels informatiques · 62.02A", source: "SIRENE / Annuaire des Entreprises", sourceUrl: "https://annuaire-entreprises.data.gouv.fr/", referenceDate: "2026-07-01", confidence: "high" }],
        coverage: { observedSources: 4, evidenceCount: 3, generatedAt: "2026-07-18T20:00:00Z" }
      }
    })
  }));
  await page.goto("/entreprises/baie-mahault/scorphtattoo-jarry-101259794");
  await expect(page.getByRole("heading", { name: "Signaux business vérifiables" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profil officiel SIRENE" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profil d’activité consolidé" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chronologie des signaux publics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Création publiée" })).toBeVisible();
  await expect(page.getByText("Audit organisationnel", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Société à mission", { exact: true })).toBeVisible();
  await expect(page.getByText("établissements actifs", { exact: true })).toBeVisible();
  await expect(page.getByText("employeurs déclarés", { exact: true })).toBeVisible();
  await expect(page.getByText("Activité officielle déclarée.")).toBeVisible();
  await page.getByRole("tab", { name: "Gouvernance" }).click();
  await expect(page.getByRole("heading", { name: "Réseau de mandats publiés" })).toBeVisible();
  await expect(page.getByText("DIRIGEANT PUBLIC", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Association" }).click();
  await expect(page.getByRole("heading", { name: "ASSOCIATION DE TEST E2E" })).toBeVisible();
  await expect(page.getByText("Développer des actions culturelles ouvertes au public.")).toBeVisible();
  await page.getByRole("tab", { name: "Prestations" }).click();
  await expect(page.getByRole("heading", { name: "Audit organisationnel" })).toBeVisible();
  await expect(page.getByText("L’entreprise présente des prestations de conseil et d’accompagnement professionnel.")).toBeVisible();
  await page.getByRole("tab", { name: "Formation" }).click();
  await expect(page.getByRole("heading", { name: "NDA 01971234567" })).toBeVisible();
  await expect(page.getByText("Energie, génie climatique")).toBeVisible();
  await expect(page.getByText("Actions de formation par apprentissage")).toBeVisible();
  await expect(page.getByText("2 211", { exact: true })).toBeVisible();
  await expect(page.getByText(/dernier bilan pédagogique et financier publié/)).toBeVisible();
  await page.getByRole("tab", { name: "Égalité F/H" }).click();
  await expect(page.getByRole("heading", { name: "Index de l’égalité professionnelle" })).toBeVisible();
  await expect(page.getByText("94 points sur 100")).toBeVisible();
  await expect(page.getByText("+3 points par rapport au résultat calculable précédent.")).toBeVisible();
  await expect(page.getByText("Écart de rémunération").first()).toBeVisible();
  await expect(page.getByText(/ne décrivent aucune rémunération individuelle/)).toBeVisible();
  await page.getByRole("tab", { name: "Conventions & OPCO" }).click();
  await expect(page.getByRole("heading", { name: "Conventions collectives et OPCO" })).toBeVisible();
  await expect(page.getByText("Bureaux d’études techniques", { exact: true })).toBeVisible();
  await expect(page.getByText("ATLAS est l’OPCO de rattachement; AKTO assure la gestion territoriale.")).toBeVisible();
  await expect(page.getByText(/ne déterminent pas à eux seuls le texte juridiquement applicable/)).toBeVisible();
  await page.getByRole("tab", { name: "Brevets & innovation" }).click();
  await expect(page.getByRole("heading", { name: "Brevets et empreinte technologique" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Procédé documenté de valorisation de biomasse" })).toBeVisible();
  await expect(page.getByText("Chimie et métallurgie", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/ne prouve pas que l’invention a été créée/)).toBeVisible();
  await page.getByRole("tab", { name: "Analyse financière" }).click();
  await expect(page.getByRole("heading", { name: "Trajectoire financière publiée" })).toBeVisible();
  await expect(page.getByText("16 710 965 €", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("29,46 %", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bilan de l’exercice" })).toBeVisible();
  await expect(page.getByText("10 978 420 €", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compte de résultat détaillé" })).toBeVisible();
  await expect(page.getByText(/Correspondance exacte SIREN \+ date de clôture/)).toBeVisible();
  await page.locator(".financial-controls select").selectOption("finance-c-2023");
  await expect(page.getByText("Diffusion partielle", { exact: true })).toBeVisible();
  await expect(page.getByText(/Les zéros techniques de la source ne sont pas affichés/)).toBeVisible();
  await expect(page.getByText(/compte de résultat détaillé n’est pas restitué/)).toBeVisible();
  await expect(page.getByText(/ni un score de crédit/)).toBeVisible();
  await page.getByRole("tab", { name: "Environnement & ICPE" }).click();
  await expect(page.getByRole("heading", { name: "Installations et activité réglementée" })).toBeVisible();
  await expect(page.getByText("Installation de combustion")).toBeHidden();
  await page.getByText("1 rubrique réglementaire").click();
  await expect(page.getByText("Installation de combustion")).toBeVisible();
  await expect(page.getByText(/ne prouve ni incident, ni infraction/)).toBeVisible();
  await expect(page.getByText("Établissement actif exact")).toBeVisible();
  await page.getByRole("tab", { name: "Profil & labels" }).click();
  await expect(page.getByRole("cell", { name: "460 000 €" })).toBeVisible();
  await expect(page.getByText("Certification Qualiopi")).toBeVisible();
  await page.getByRole("tab", { name: "Subventions publiques" }).click();
  await expect(page.getByRole("heading", { name: "Programme de transformation numérique" })).toBeVisible();
  await expect(page.getByText("Ancien SIRET ou établissement hors stock actif local")).toBeVisible();
  await expect(page.getByText(/sans preuve de versement/)).toBeVisible();
  await page.getByRole("tab", { name: "Aides ADEME" }).click();
  await expect(page.getByRole("heading", { name: "Installation solaire sur l’établissement guadeloupéen" })).toBeVisible();
  await expect(page.getByText("Établissement actif en Guadeloupe")).toBeVisible();
  await expect(page.getByText("Fonds chaleur")).toBeVisible();
  await page.getByRole("tab", { name: "Fonds vert" }).click();
  await expect(page.getByRole("heading", { name: "Rénovation énergétique du site de Baie-Mahault" })).toBeVisible();
  await expect(page.getByText("Projet localisé en Guadeloupe")).toBeVisible();
  await expect(page.getByText("SIRET actif guadeloupéen exact")).toBeVisible();
  await page.getByRole("tab", { name: "France Relance" }).click();
  await expect(page.getByRole("heading", { name: "Efficacité énergétique et évolution des procédés dans l’industrie" })).toBeVisible();
  await expect(page.getByText("Le projet public porte sur une nouvelle installation industrielle plus performante.")).toBeVisible();
  await expect(page.getByText("42,5 t équivalent CO₂")).toBeVisible();
  await expect(page.getByText(/ne publie aucun montant individuel/)).toBeVisible();
  await page.getByRole("tab", { name: "Présence locale" }).click();
  await expect(page.getByRole("heading", { name: "Point d’accueil test" })).toBeVisible();
  await expect(page.getByText("Accessible en fauteuil roulant")).toBeVisible();
  await page.getByRole("tab", { name: "Qualifications" }).click();
  await expect(page.getByRole("heading", { name: "Isolation thermique par l’intérieur" })).toBeVisible();
  await page.getByRole("tab", { name: "Événements" }).click();
  await expect(page.getByRole("heading", { name: "Création" })).toBeVisible();
  await page.getByRole("tab", { name: "Marchés publics" }).click();
  await expect(page.getByRole("heading", { name: "Marché de services" })).toBeVisible();
  await page.getByRole("tab", { name: "Presse" }).click();
  await expect(page.getByRole("heading", { name: "Une entreprise se développe" })).toBeVisible();
});
