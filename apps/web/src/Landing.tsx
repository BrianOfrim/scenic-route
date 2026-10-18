import { LegalLinks } from "./LegalLinks";
import { useRef } from "react";
import { SignInForm } from "./SignIn";
import { StyleExplorer } from "./StyleExplorer";

const HERO_IMAGES = ["brothers-risograph", "brothers-wpa", "brothers-blueprint"];

const STEPS = [
  {
    title: "Bring your route",
    body: "Drop in a GPX, FIT, or TCX file from Strava, Garmin, Komoot, or AllTrails. Whole account exports work too.",
  },
  {
    title: "Tell the story",
    body: "Pick the details that matter to you: the date, distance, place, and who you shared the adventure with.",
  },
  {
    title: "Choose your style",
    body: "Try a handful of styles at once and refine the one you love. Save it, or share it to Instagram and beyond.",
  },
];

export function Landing() {
  const emailRef = useRef<HTMLInputElement>(null);

  const startSignIn = () => {
    const input = emailRef.current;
    if (!input) {
      document.getElementById("start")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  };

  return (
    <div className="landing">
      <header className="landing-top">
        <div className="brand-lockup">
          <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
          <p className="brand">Scenic Route</p>
        </div>
        <button type="button" className="text-btn" onClick={startSignIn}>
          Sign in
        </button>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>Turn your adventures into art.</h1>
            <p className="landing-lede">
              Take your favorite rides, runs, and hikes and make something beautiful from them: a
              keepsake to remember the day by, and to share with friends and followers.
            </p>
            <div className="landing-signin" id="start">
              <SignInForm inputRef={emailRef} />
            </div>
          </div>
          <div className="landing-hero-art" aria-hidden="true">
            {HERO_IMAGES.map((image) => (
              <img
                key={image}
                className="landing-hero-image"
                src={`/landing/${image}.webp`}
                alt=""
                width={683}
                height={1024}
                fetchPriority="high"
              />
            ))}
          </div>
        </section>

        <StyleExplorer />

        <section className="landing-steps" aria-labelledby="landing-steps-title">
          <div className="landing-section-head">
            <p className="landing-eyebrow">How it works</p>
            <h2 id="landing-steps-title">From activity file to keepsake in minutes.</h2>
          </div>
          <ol>
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="landing-step-num">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-cta">
          <img src="/logo/sr-path-sage.svg" alt="" width={56} height={56} />
          <h2>Your next favorite memory is already in your activity log.</h2>
          <button type="button" className="button" onClick={startSignIn}>
            Get started
          </button>
        </section>
      </main>

      <footer className="landing-footer">
        <LegalLinks />
        <p>© {new Date().getFullYear()} Scenic Route</p>
      </footer>
    </div>
  );
}
