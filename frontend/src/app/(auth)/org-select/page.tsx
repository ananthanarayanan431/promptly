import { OrganizationList } from '@clerk/nextjs';

export default function OrgSelectPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/optimize"
        afterCreateOrganizationUrl="/optimize"
      />
    </div>
  );
}
