import Link from "next/link";
import { Bento, Tile, TileHead } from "@/components/Bento";
import { Icon } from "@/components/Icon";
import { Logo, Symbol } from "@/components/Logo";
import { Footer, PublicHeader } from "@/components/PublicHeader";
import { currentUser } from "@/server/session";

export default async function Landing({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await currentUser();
  const { deleted } = await searchParams;
  return (
    <>
      <PublicHeader signedIn={!!user} />
      <main id="main" className="page">
        {deleted ? <div className="alert success" role="status" style={{ marginTop: 24 }}>Your account is being deleted. You've been signed out.</div> : null}
        <section className="landing-hero">
          <Bento>
            <Tile span="lg-7 md-6" tone="flat" className="fade-in">
              <h1 className="hero-title">Your next opening.</h1>
              <p style={{ fontSize: 19, lineHeight: "30px", maxWidth: "36ch", color: "var(--color-text-secondary)" }}>
                Share the opportunities you come across. Unlock the ones that fit you. Get your application in before the deadline.
              </p>
              <div className="row">
                <Link href={user ? "/contribute" : "/auth/sign-up"} className="btn primary"><Icon name="plus" size={18} /> Share an opportunity</Link>
                <Link href={user ? "/discover" : "/auth/sign-up"} className="btn">Find one that fits</Link>
              </div>
            </Tile>
            <Tile span="lg-5 md-6" tone="brand" label="OCCASIO">
              <div style={{ minHeight: 280, display: "grid", placeItems: "center" }}>
                <Symbol variant="ink" size={300} className="logo-reveal" />
              </div>
              <Logo variant="ink" height={24} />
            </Tile>
          </Bento>
        </section>

        <Bento label="How it works">
          <Tile span="lg-4 md-2" label="Share">
            <TileHead kicker="1 · Share" />
            <h2>Pass on what you find.</h2>
            <p className="muted">Add the official link and the poster if you have it. We check the source; a person reviews it. A new one earns you a credit.</p>
          </Tile>
          <Tile span="lg-4 md-2" label="Exchange">
            <TileHead kicker="2 · Exchange" />
            <h2>Spend it on a real fit.</h2>
            <p className="muted">Tell us what you want. We only suggest listings that are open, recently checked and that you're eligible for. No fit means no charge.</p>
          </Tile>
          <Tile span="lg-4 md-2" label="Act">
            <TileHead kicker="3 · Act" />
            <h2>Make time to apply.</h2>
            <p className="muted">A checklist from the official requirements and reminders before the deadline, in your timezone.</p>
          </Tile>

          <Tile span="lg-7 md-4" as="article" label="Example listing">
            <TileHead kicker="What a listing shows" action={<span className="badge warn">Illustration</span>} />
            <div className="card" style={{ background: "var(--color-bg)" }}>
              <div className="row-between"><span className="badge">Hackathon</span><span className="badge outline">Remote · No fee</span></div>
              <span className="card-title">Example Builders Weekend</span>
              <span className="meta">Example Organizer (sample, not a real event)</span>
              <div className="deadline"><span className="meta">Official deadline</span><span className="when">30 Nov 2026, 23:59 WAT</span><span className="meta">That's 22:59 your time.</span></div>
              <ul className="meta" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Applications open; checked today</li>
                <li>Eligibility confirmed from the official page</li>
              </ul>
            </div>
            <p className="meta" style={{ margin: 0 }}>Dates with no time or timezone are labelled as such. We don't invent precision the organizer didn't give.</p>
          </Tile>
          <Tile span="lg-5 md-2" tone="subtle" label="Example checklist">
            <TileHead kicker="Preparing an application" action={<span className="badge warn">Illustration</span>} />
            <div className="progress" aria-hidden><span style={{ width: "50%" }} /></div>
            <ul className="list">
              <li className="task done"><span className="tick" aria-hidden style={{ width: 22, height: 22, borderRadius: 7, background: "var(--color-brand)", flex: "none" }} /><span className="task-title">Read the official page and confirm eligibility</span></li>
              <li className="task done"><span className="tick" aria-hidden style={{ width: 22, height: 22, borderRadius: 7, background: "var(--color-brand)", flex: "none" }} /><span className="task-title">Short team introduction</span></li>
              <li className="task"><span aria-hidden style={{ width: 22, height: 22, borderRadius: 7, border: "2px solid var(--color-border)", flex: "none" }} /><span>Project idea, 300 words</span></li>
              <li className="task"><span aria-hidden style={{ width: 22, height: 22, borderRadius: 7, border: "2px solid var(--color-border)", flex: "none" }} /><span>Review and submit on the organizer's site</span></li>
            </ul>
            <span className="meta">“Submitted” is only ever what you tell us.</span>
          </Tile>
          <Tile span="lg-12" tone="brand" label="Get started">
            <div className="row-between">
              <h2 style={{ fontSize: 30, lineHeight: "36px", maxWidth: "22ch" }}>Make space for someone. Find your own next step.</h2>
              <Link href={user ? "/home" : "/auth/sign-up"} className="btn ink">{user ? "Open OCCASIO" : "Create a free account"} <Icon name="arrow" size={18} /></Link>
            </div>
          </Tile>
        </Bento>
      </main>
      <Footer />
    </>
  );
}
