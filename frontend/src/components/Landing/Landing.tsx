/**
 * Public marketing landing page — the indexable face of BlunderDrill.
 *
 * Rendered for unauthenticated visitors (see App.tsx). It provides real,
 * crawlable content (a single <h1>, semantic <h2> sections, and paragraph copy)
 * so search engines and social scrapers have something to index instead of a
 * bare login form. The login/guest form is embedded as the call-to-action.
 *
 * This view is also the target of the build-time prerender step
 * (scripts/prerender.mjs), so its markup must render without any auth state.
 */

import type { JSX } from 'react';
import Login from '../Login/Login';
import './Landing.css';

// One "How it works" step — kept as data so the list stays easy to extend.
interface Step {
  number: string;
  title: string;
  body: string;
}

// One FAQ entry — rendered as a semantic question/answer pair.
interface FaqItem {
  question: string;
  answer: string;
}

const STEPS: Step[] = [
  {
    number: '1',
    title: 'Link your account',
    body: 'Enter your Chess.com or Lichess username. BlunderDrill pulls your recent games straight from the public API, with no password and no downloads.',
  },
  {
    number: '2',
    title: 'Analyse your games',
    body: 'The Stockfish engine reviews every move you played and flags the exact moments you dropped a piece, missed a tactic, or walked into mate.',
  },
  {
    number: '3',
    title: 'Review the blunders',
    body: 'Each blunder becomes an interactive position. Replay it, find the move you should have played, and burn the pattern in so it stops happening.',
  },
];

const FAQ: FaqItem[] = [
  {
    question: 'Is BlunderDrill free?',
    answer: 'Yes. You can look up any public Chess.com or Lichess player and start drilling their blunders for free. Create an account only if you want to save your progress.',
  },
  {
    question: 'Do I need to install anything?',
    answer: 'No. BlunderDrill runs entirely in your browser and can be installed as an app on your phone home screen if you want, but nothing is required.',
  },
  {
    question: 'Which chess sites are supported?',
    answer: 'Chess.com and Lichess. BlunderDrill reads your games directly from their public APIs, so any rated or casual game you have played is available.',
  },
  {
    question: 'How are blunders detected?',
    answer: 'The Stockfish engine evaluates each position before and after your move. When your move loses significant evaluation compared to the best available move, it is classified as a mistake or blunder.',
  },
];

function Landing(): JSX.Element {
  // ── Hero: the single <h1> for the page, plus the embedded sign-in CTA. ──────
  function renderHero(): JSX.Element {
    return (
      <header className="landing__hero">
        <span className="landing__hero-icon">♚</span>
        <h1 className="landing__title">
          Chess <span className="landing__gold">Blunder</span> Trainer
        </h1>
        <p className="landing__tagline">
          Review your blunders like daily puzzles.
        </p>

        <div className="landing__cta">
          <Login embedded />
        </div>
      </header>
    );
  }

  // ── "How it works" — three numbered steps. ─────────────────────────────────
  function renderSteps(): JSX.Element {
    return (
      <section className="landing__section" id="how-it-works">
        <h2 className="landing__section-title">How it works</h2>
        <div className="landing__steps">
          {STEPS.map((step, index) => (
            <div className="landing__step" key={`landing-step-${step.number}-${index}`}>
              <span className="landing__step-number">{step.number}</span>
              <h3 className="landing__step-title">{step.title}</h3>
              <p className="landing__step-body">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ── "Why drill your own blunders" — the core value proposition. ─────────────
  function renderWhy(): JSX.Element {
    return (
      <section className="landing__section landing__section--card" id="why">
        <h2 className="landing__section-title">Why drill your own blunders</h2>
        <p className="landing__prose">
          Generic puzzle trainers show you positions from other people's games.
          They sharpen your tactics, but they never touch the specific mistakes
          that actually cost you rating points.
        </p>
        <p className="landing__prose">
          BlunderDrill is different. It trains you on the exact positions where{' '}
          <em>you</em> went wrong: the pinned knight you missed, the back-rank
          mate you allowed, the free pawn you gave away. Repeatedly facing your
          own patterns is the fastest way to stop repeating them, and it is why
          reviewing your games is the advice every coach gives first.
        </p>
      </section>
    );
  }

  // ── Filtering: pick which blunders to drill by type and game phase. ─────────
  function renderFilter(): JSX.Element {
    return (
      <section className="landing__section landing__section--card" id="filter">
        <h2 className="landing__section-title">Filter by type and game phase</h2>
        <p className="landing__prose">
          Not every mistake is worth the same drill. BlunderDrill lets you filter
          your blunders by type, such as hanging a piece, missing a tactic, or
          allowing checkmate, and by the phase of the game they happened in,
          whether opening, middlegame, or endgame.
        </p>
        <p className="landing__prose">
          Focus on the patterns that cost you the most, drill one weakness at a
          time, and skip the mistakes you already have covered.
        </p>
      </section>
    );
  }

  // ── Supported sites. ────────────────────────────────────────────────────────
  function renderSupported(): JSX.Element {
    return (
      <section className="landing__section landing__section--card" id="supported-sites">
        <h2 className="landing__section-title">Works with Chess.com and Lichess</h2>
        <p className="landing__prose">
          Connect any Chess.com or Lichess account and BlunderDrill reads your
          games straight from the official public APIs. No password is ever
          required to look up a player, and no game data is uploaded from your
          device. Everything comes from the sites you already play on.
        </p>
      </section>
    );
  }

  // ── FAQ — question/answer pairs for long-tail search queries. ───────────────
  function renderFaq(): JSX.Element {
    return (
      <section className="landing__section landing__section--card" id="faq">
        <h2 className="landing__section-title">Frequently asked questions</h2>
        <dl className="landing__faq">
          {FAQ.map((item, index) => (
            <div className="landing__faq-item" key={`landing-faq-${index}`}>
              <dt className="landing__faq-q">{item.question}</dt>
              <dd className="landing__faq-a">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <div className="landing">
      {renderHero()}
      <main className="landing__content">
        {renderSteps()}
        {renderFilter()}
        {renderWhy()}
        {renderSupported()}
        {renderFaq()}
      </main>
      <footer className="landing__footer">
        <p>BlunderDrill. Train chess by drilling your own blunders.</p>
      </footer>
    </div>
  );
}

export default Landing;
