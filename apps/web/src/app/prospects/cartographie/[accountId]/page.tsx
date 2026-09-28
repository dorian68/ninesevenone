import { AccountMap } from "@/components/prospect-factory/account-map";

export default async function AccountCartographyPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <main style={{ minHeight: "100dvh", padding: "clamp(10px, 2vw, 24px)", background: "#f5f7fb" }}><AccountMap accountId={accountId} /></main>;
}
