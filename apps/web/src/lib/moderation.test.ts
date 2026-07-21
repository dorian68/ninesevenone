import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "guad-moderation-"));
(process as unknown as { env: Record<string, string | undefined> }).env.MODERATION_DB_PATH = join(temporaryDirectory, "moderation.sqlite");

let moderation: typeof import("./moderation-db");

beforeAll(async () => {
  moderation = await import("./moderation-db");
});

afterAll(() => {
  moderation.closeModerationDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("moderation workflows", () => {
  it("publishes approved declared fields without changing official facts", () => {
    const siren = "123456789";
    const claim = moderation.createCompanyClaim({
      siren,
      claimantName: "Responsable de test",
      professionalEmail: "contact@example.test",
      companyRole: "Responsable",
      evidenceUrl: "https://example.test/entreprise",
      message: "La demande est accompagnée d’un justificatif professionnel public."
    });
    expect(claim?.status).toBe("pending");
    const approvedClaim = moderation.reviewCompanyClaim(claim!.id, "approved", "Justificatif contrôlé", "DATA_ADMIN");
    expect(approvedClaim?.status).toBe("approved");
    expect(moderation.getApprovedClaimForUpdate(claim!.id, siren, "CONTACT@EXAMPLE.TEST")?.id).toBe(claim!.id);

    const update = moderation.createCompanyUpdateRequest({
      siren,
      claimId: claim!.id,
      professionalEmail: claim!.professionalEmail,
      payload: { siteWeb: "https://example.test", descriptionCourte: "Présentation déclarée de l’activité locale." }
    });
    expect(update?.status).toBe("pending");
    const approvedUpdate = moderation.reviewCompanyUpdateRequest(update!.id, "approved", "Information publiée comme déclarée", "DATA_ADMIN");
    expect(approvedUpdate?.status).toBe("approved");
    expect(moderation.getCompanyDeclaredOverride(siren)).toMatchObject({ siteWeb: "https://example.test", descriptionCourte: "Présentation déclarée de l’activité locale." });
    expect(moderation.getVerifiedCompanySirens([siren]).has(siren)).toBe(true);
  });
});
