# MyBowlingTracker — Claude Code Build Spec

_A placeholder name — rename freely. This document is meant to be fed to Claude Code one phase at a time, not all at once._

## What this app is

A mobile-first web app for logging bowling shots in real time — between turns, on your phone, at the lane. For each shot you can capture how you lined up, where you slid, your visual target, how the ball reacted, and which pins fell. You can also define reference approaches (e.g. your strike ball setup, or a specific spare pickup) and compare what you actually did against that reference in the moment. Over time, sessions build into a personal history you can look back on. Later (not in v1), the app will use that history to suggest adjustments.

Public app, open signup. Anyone can create an account; each person's data is private to them.

## Locked-in decisions

| Decision                         | Choice                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                         | Astro                                                                                                                                                                                                       | Chosen by you upfront                                                                                                                                                                                                                             |
| Backend/DB                       | Supabase (hosted Postgres + Auth)                                                                                                                                                                           | Auth and database ship together and stay in sync — less for a beginner to wire up and maintain than MongoDB+separate-auth or Firebase's NoSQL model, and your data (sessions → games → shots → pins) is naturally relational, which SQL fits well |
| Interactive UI pieces            | React islands inside Astro                                                                                                                                                                                  | You've built React apps before (trivia generator, spare card tool), so components will be easier for you to read and modify later                                                                                                                 |
| Hosting                          | Vercel or Netlify (Astro has first-party adapters for both)                                                                                                                                                 | Free tier, one-command deploys, plays well with Supabase                                                                                                                                                                                          |
| Scoring                          | Manual "final score" field is always available and is the source of truth for your average. Frame-by-frame detail is optional and can be partial or skipped entirely without breaking anything              | You said it's fine if frames get left blank as long as the final score is captured                                                                                                                                                                |
| AI suggestions                   | Deferred to a later phase                                                                                                                                                                                   | Not enough data to make suggestions useful until logging is solid and some history exists                                                                                                                                                         |
| Targeting                        | Flexible — board number, arrow, or target pin, user's choice, not locked to one system                                                                                                                      | You want users to aim however they naturally do                                                                                                                                                                                                   |
| Ball reaction                    | Structured fields (hook timing, miss direction, breakpoint) _plus_ an optional freeform note                                                                                                                | Structured = fast tapping; freeform = room for anything structure doesn't capture                                                                                                                                                                 |
| Lane conditions                  | Logged once per session (e.g. fresh vs. broken down)                                                                                                                                                        | Ball reaction only makes sense in context of lane condition                                                                                                                                                                                       |
| Ball tracking                    | Each user maintains their own list of balls; each shot references one                                                                                                                                       | Relevant since you're picking up your first hook ball                                                                                                                                                                                             |
| Approach references              | Users define named reference approaches (e.g. "Strike ball," "10 pin spare") with an intended ball/lineup/slide/target; a shot can optionally link to one for a side-by-side actual-vs-reference comparison | Extends the same reference-card idea from your spare system project into live comparison                                                                                                                                                          |
| League session structure         | League sessions explicitly support Practice + Game 1 + Game 2 + Game 3 as distinct, labeled segments; practice is excluded from average calculations                                                        | Matches how a league night actually runs                                                                                                                                                                                                          |
| Trend detection across a session | Deferred to the AI phase (Phase 6) rather than built now                                                                                                                                                    | "How do things drift from practice through game 3" needs real history first, and is naturally an AI-suggestion task rather than a fixed rule                                                                                                      |

## Data model (Postgres tables)

- **profiles** — one row per user (linked to Supabase auth), display name, optional team name (e.g. "Split Happens")
- **balls** — owned by a user: name, brand/model, weight, layout notes
- **approaches** — owned by a user: name/label (e.g. "Strike ball — fresh house shot," "10 pin spare," "Baby split"), reference ball (FK, optional), reference lineup/stance position, reference slide position, reference target type + value (board/arrow/pin), notes
- **sessions** — alley name, lane number, date, session type (`league` / `practice`), lane condition notes, optional league/team name
- **games** — belongs to a session: `game_number` (nullable — 1, 2, or 3 for league games), `is_practice` (boolean — true for warmup/practice, always excluded from averages), `final_score` (nullable, manual entry, always available)
- **frames** — belongs to a game: frame number _(optional — can be skipped entirely for any frame)_
- **shots** — belongs to a frame: which ball used (FK), optional reference approach used (FK to `approaches`, for actual-vs-reference comparison), lineup/stance position, slide position, target type + value (board/arrow/pin), pins left standing (array/bitmask of 1–10, tapped directly on a pin diagram; pins knocked down are the derived complement — plus a `strike` and `spare` flag for the one-tap shortcuts), hook timing (early/on-time/late/none — dropdown), miss direction (high/low/flush/pocket — dropdown), breakpoint board (optional number), freeform note (optional text)

Row Level Security policies ensure a user can only ever read/write their own profiles, balls, sessions, games, frames, and shots.

## UX principles (non-negotiable across every phase)

1. **Mobile-first.** Design for one-handed use on a phone between turns before anything else.
2. **Everything except session type is optional and skippable.** No field should block saving a shot.
3. **Pin entry matches what you actually see after a shot.** Tap the pins still _standing_ on a 10-pin triangle diagram — that's what your eye goes to when the ball settles, not which pins fell. One-tap **Strike** and **Spare** buttons skip the diagram entirely for those two common outcomes. No typing pin numbers, ever.
4. **Fast beats complete.** A 3-second shot log beats a detailed one you didn't have time to enter.
5. **Reference vs. actual, side by side.** When a shot is logged against a saved reference approach, show that approach's intended lineup/slide/target right next to what you actually entered — no separate screen needed to spot the difference.

---

## How to use this with Claude Code

Paste one phase below as a prompt, let Claude Code build and you test it, then move to the next phase. Don't paste multiple phases at once — that's what turns a codebase into something a beginner can't follow or debug.

---

### Phase 0 — Project setup, auth, deploy pipeline

> Set up a new Astro project configured for server-side rendering with the Vercel adapter (or Netlify, if I tell you I prefer that). Integrate Supabase for authentication using the `@supabase/ssr` package so sessions work correctly with Astro's SSR. Build: a sign-up page, a login page, a logout action, and a protected empty dashboard page that only signed-in users can see. Set up React as an integration for future interactive islands. Walk me through creating the Supabase project and getting the environment variables, since I've never done this before. Confirm the whole thing deploys successfully to Vercel/Netlify before we add any bowling-specific features.
