import { AccountMap } from "@/components/prospect-factory/account-map";
import { safeAccountMapReturnUrl } from "@/components/prospect-factory/prospect-navigation";

export default async function AccountCartographyPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { accountId } = await params;
  const { returnTo } = await searchParams;
  const safeReturnTo = safeAccountMapReturnUrl(Array.isArray(returnTo) ? returnTo[0] : returnTo, accountId);
  return <main style={{ minHeight: "100dvh", padding: "clamp(10px, 2vw, 24px)", background: "#f5f7fb" }}><AccountMap accountId={accountId} returnTo={safeReturnTo} /></main>;
}
