import { redirect } from "next/navigation";
import { skipOnboardingAction } from "@/app/actions/profile";
import { PageHead } from "@/components/Bento";
import { ProfileForm } from "@/components/ProfileForm";
import { currentProfile } from "@/server/session";

export const metadata = { title: "Set up your profile" };

export default async function Onboarding() {
  const p = await currentProfile();
  if (!p) redirect("/auth/sign-in");
  if (p.onboarded_at) redirect("/home");
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <PageHead title="Let's find your next opening" intro="A few answers help us match you with opportunities that actually fit. You can change them any time in Profile." />
      <ProfileForm p={p} onboarding />
      <form action={skipOnboardingAction} style={{ marginTop: 16 }}>
        <button className="btn ghost" type="submit">Skip for now</button>
      </form>
    </div>
  );
}
