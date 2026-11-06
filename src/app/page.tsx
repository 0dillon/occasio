import Link from "next/link";
import { Icon } from "@/components/Icon";
import { OpportunityCard } from "@/components/Opportunity";
import { Footer, PublicHeader } from "@/components/PublicHeader";
import { withAnon } from "@/db/tx";
import { searchBank, type OpportunityPreview } from "@/domain/catalog";
import { currentUser } from "@/server/session";

const STEPS = [
  { n: "01", verb: "Find", title: "Browse what's open.", body: "Scholarships, fellowships, hackathons and jobs in one place. Every listing is open, checked on the organizer's own page, and shows the real deadline in your timezone." },
  { n: "02", verb: "Track", title: "Manage every application.", body: "Track the ones you're going for. Each gets a checklist from the official requirements, and reminders a week, three days and a day before the deadline." },
  { n: "03", verb: "Share", title: "Pass on what you come across.", body: "Seen a poster in a group chat? Paste the link. We check the organizer's page, and when it's added to the board you earn a credit." },
];

const FAQ = [
  { q: "Is it free?", a: "Yes. The board and the application tracker are free. You only need an account to see the full listings and keep track of your applications." },
  { q: "What are credits for?", a: "You earn a credit each time an opportunity you share is added to the board as new. Credits will unlock extra perks; they can't be bought or cashed out." },
  { q: "How do you know a listing is real?", a: "We open the organizer's own page, read the deadline and requirements there, and check it again while it's open. Anything that doesn't add up gets a closer look before it goes in." },
  { q: "Who is it for?", a: "Anyone hunting for their next step: students, graduates, early-career builders and founders. Opportunities can be from anywhere, as long as you're eligible." },
];

async function openNow(): Promise<OpportunityPreview[]> {
  try {
    const { items } = await withAnon((c) => searchBank(c, { q: "", open: "1" } as any, null, 12));
    return items.filter((o) => !o.is_fixture).slice(0, 3);
  } catch {
    return []; // the landing page never fails because the bank is unavailable
  }
}

export default async function Landing({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await currentUser();
  const { deleted } = await searchParams;
  const live = await openNow();
  const find = user ? "/discover" : "/auth/sign-up";
  const share = user ? "/contribute" : "/auth/sign-up";
  return (
    <>
      <PublicHeader signedIn={!!user} />
      <main id="main" className="page lp">
        {deleted ? <div className="alert success" role="status" style={{ marginTop: 24 }}>Your account is being deleted. You've been signed out.</div> : null}

        <section className="lp-hero fade-in" aria-labelledby="lp-title">
          <div className="lp-hero-copy">
            <p className="lp-kicker">Scholarships · Fellowships · Hackathons · Jobs</p>
            <h1 id="lp-title" className="lp-title">Your next<br />opening.</h1>
            <p className="lp-lede">Opportunities that are actually open, and that you can actually apply for. Each one checked on the organizer's own page.</p>
            <div className="lp-actions">
              <Link href={find} className="btn ink lp-btn">Find opportunities <Icon name="arrow" size={18} /></Link>
              <Link href={share} className="btn lp-btn lp-btn-outline"><Icon name="plus" size={18} /> Share one you found</Link>
            </div>
            <p className="lp-fine">Free to join. Free to use.</p>
          </div>
          {/* Intentional crop of the real symbol artwork as the hero graphic. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol-ink.svg" alt="" aria-hidden className="lp-hero-mark logo-reveal" />
        </section>

        {live.length ? (
          <section className="lp-live" aria-labelledby="lp-live">
            <div className="row-between lp-live-head">
              <h2 id="lp-live" className="lp-section-title">Open right now</h2>
              <Link href={find} className="lp-link">See all <Icon name="arrow" size={16} /></Link>
            </div>
            <div className="lp-live-grid">
              {live.map((o) => <OpportunityCard key={o.id} o={o} tz="UTC" />)}
            </div>
            <p className="meta">Deadlines shown in UTC. Sign in to see them in your timezone.</p>
          </section>
        ) : null}

        <section className="lp-steps" aria-labelledby="lp-how">
          <h2 id="lp-how" className="lp-section-title">How it works</h2>
          <ol className="lp-step-list">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="lp-step-n" aria-hidden>{s.n}</span>
                <span className="lp-step-verb">{s.verb}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-showcase" aria-labelledby="lp-see">
          <div className="lp-showcase-copy">
            <h2 id="lp-see" className="lp-section-title">Know in ten seconds if it's worth your time.</h2>
            <ul className="lp-points">
              <li><Icon name="check" size={18} /> The real deadline, converted to your time</li>
              <li><Icon name="check" size={18} /> Whether it's still open, and when we last checked</li>
              <li><Icon name="check" size={18} /> What it costs and who can apply</li>
              <li><Icon name="check" size={18} /> A checklist and reminders to get it done</li>
            </ul>
            <span className="meta">Sample listing below, not a real event.</span>
          </div>

          <div className="lp-mock" aria-label="Sample listing and checklist">
            <article className="lp-card">
              <div className="row-between"><span className="badge">Hackathon</span><span className="badge outline">Remote · No fee</span></div>
              <h3 className="lp-card-title">Example Builders Weekend</h3>
              <span className="meta">Example Organizer</span>
              <div className="lp-deadline">
                <span className="lp-deadline-label">Official deadline</span>
                <span className="lp-deadline-when">30 Nov 2026, 23:59 WAT</span>
                <span className="meta">That's 22:59 your time</span>
              </div>
              <ul className="lp-checks">
                <li><span className="lp-dot" aria-hidden /> Open · checked on the official page today</li>
                <li><span className="lp-dot" aria-hidden /> Open to applicants aged 18–35, worldwide</li>
              </ul>
            </article>

            <div className="lp-plan">
              <div className="row-between"><strong>Your plan</strong><span className="meta">2 of 4 done</span></div>
              <div className="progress" aria-hidden><span style={{ width: "50%" }} /></div>
              <ul className="lp-tasks">
                <li className="done"><span className="lp-box" aria-hidden><Icon name="check" size={14} /></span>Confirm you're eligible</li>
                <li className="done"><span className="lp-box" aria-hidden><Icon name="check" size={14} /></span>Write a team intro</li>
                <li><span className="lp-box" aria-hidden />Project idea, 300 words</li>
                <li><span className="lp-box" aria-hidden />Submit on the organizer's site</li>
              </ul>
              <span className="meta">Next reminder: 7 days before</span>
            </div>
          </div>
        </section>

        <section className="lp-faq" aria-labelledby="lp-faq">
          <h2 id="lp-faq" className="lp-section-title">Questions</h2>
          <div className="lp-faq-list">
            {FAQ.map((f) => (
              <details key={f.q} className="lp-faq-item">
                <summary>{f.q}<span className="lp-faq-icon" aria-hidden><Icon name="plus" size={18} /></span></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta">
          <h2 id="lp-cta">Your next opening is out there.<br />Let's find it.</h2>
          <Link href={user ? "/home" : "/auth/sign-up"} className="btn ink lp-btn">{user ? "Open OCCASIO" : "Create a free account"} <Icon name="arrow" size={18} /></Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
