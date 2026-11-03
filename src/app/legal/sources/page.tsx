export const metadata = { title: "Source policy" };
export default function Sources() {
  return (
    <>
      <h1>How we check sources</h1>
      <p>Our checker identifies itself, respects site restrictions and rate limits, and only reads public pages. It never logs in, bypasses paywalls or solves CAPTCHAs. If a site blocks automated access, a person checks it instead.</p>
      <p>Automatic discovery only reads organizer pages that a person has approved. Discovered listings never earn anyone credits.</p>
      <p>Every listing shows when its source was last checked successfully. Listings that can't be confirmed as open aren't offered for credit.</p>
      <p>Organizers who want a listing corrected or removed can use “Something wrong?” on the listing page.</p>
    </>
  );
}
