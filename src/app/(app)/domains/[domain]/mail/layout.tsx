import { MailSubNav } from "@/components/MailSubNav";
import { requireDomainPageNotAlias } from "@/lib/domain-api";

type Props = {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
};

export default async function MailSectionLayout({ children, params }: Props) {
  const { domain, session } = await requireDomainPageNotAlias((await params).domain);
  return (
    <div className="-mt-2 space-y-4">
      <MailSubNav domain={domain} isAdmin={session.role === "admin"} />
      {children}
    </div>
  );
}
