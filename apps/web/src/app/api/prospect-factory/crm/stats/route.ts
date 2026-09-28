import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeProspectCrm, crmError } from "@/lib/prospect-factory-crm-http";
import { getProspectActivityStats } from "@/lib/prospect-factory-crm-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dateSchema = z.string().datetime({ offset: true });
const DEFAULT_REPORTING_TIMEZONE = "Europe/Paris";

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

function validateTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

/** Converts a local calendar midnight to UTC. Monday midnight in Paris never
 * falls in the DST discontinuity, and the second pass covers zone offsets. */
function localMidnightToUtc(year: number, month: number, day: number, timeZone: string) {
  const localAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetAt = (instant: number) => {
    const local = dateParts(new Date(instant), timeZone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instant;
  };
  const first = localAsUtc - offsetAt(localAsUtc);
  return new Date(localAsUtc - offsetAt(first));
}

function defaultWindow(timeZone: string) {
  const now = new Date();
  const local = dateParts(now, timeZone);
  const calendarDay = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekday = calendarDay.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceMonday));
  const from = localMidnightToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function GET(request: NextRequest) {
  const auth = authorizeProspectCrm(request);
  if (auth instanceof NextResponse) return auth;

  const parameters = request.nextUrl.searchParams;
  const reportingTimezone = validateTimezone(parameters.get("timezone")?.trim() || DEFAULT_REPORTING_TIMEZONE);
  if (!reportingTimezone) return crmError("Fuseau horaire de reporting invalide.", 422, "INVALID_REPORTING_TIMEZONE");
  const defaults = defaultWindow(reportingTimezone);
  const fromCandidate = parameters.get("from") ?? defaults.from;
  const toCandidate = parameters.get("to") ?? defaults.to;
  const parsedFrom = dateSchema.safeParse(fromCandidate);
  const parsedTo = dateSchema.safeParse(toCandidate);
  if (!parsedFrom.success || !parsedTo.success) return crmError("Fenêtre temporelle invalide.", 422, "INVALID_REPORT_WINDOW");

  try {
    const from = new Date(parsedFrom.data).toISOString();
    const to = new Date(parsedTo.data).toISOString();
    const stats = getProspectActivityStats(from, to, reportingTimezone);
    const target = 50;
    return NextResponse.json({
      ...stats,
      target: {
        /** Legacy account metric kept for existing clients. */
        approachedProspects: target,
        newContactsApproached: target,
        remaining: Math.max(0, target - stats.newContactsApproached),
        met: stats.newContactsApproached >= target
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "ProspectCrmInputError") return crmError(error.message, 422, "INVALID_REPORT_WINDOW");
    console.error("Prospect CRM activity stats failed", error instanceof Error ? error.name : "UnknownError");
    return crmError("Les statistiques d’activité n’ont pas pu être calculées.", 503, "CRM_STATS_FAILED");
  }
}
