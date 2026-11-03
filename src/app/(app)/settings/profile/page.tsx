import { ProfileForm } from "@/components/ProfileForm";
import { currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Profile" };

export default async function ProfileSettings() {
  await requireUser("/settings/profile");
  const p = await currentProfile();
  return <ProfileForm p={p} />;
}
