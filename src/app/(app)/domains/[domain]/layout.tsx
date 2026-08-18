import { DomainNav } from "@/components/DomainNav";
import { requireDomainAccess } from "@/lib/domain-api";
import { isAliasBlockedFeaturePath } from "@/lib/features";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

type Props = {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
};

export default async function DomainLayout({ children, params }: Props) {
  const { domain, session, domainInfo } = await requireDomainAccess((await params).domain);
  if (String(domainInfo.type ?? "top").toLowerCase() === "alias") {
    const pathname = (await headers()).get("x-qadbak-pathname") ?? "";
    if (isAliasBlockedFeaturePath(pathname)) {
      redirect(`/domains/${encodeURIComponent(domain)}`);
    }
  }
  return (
    <div className="space-y-6">
      <DomainNav
        domain={domain}
        isAdmin={session.role === "admin"}
        type={domainInfo.type}
      />
      {children}
    </div>
  );
}
