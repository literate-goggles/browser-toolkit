# LiterateGoggles

LiterateGoggles is a personal browser toolkit for tweaking the way websites look and behave. It starts with small conveniences—like hiding LeetCode difficulty badges so you can focus on solving the problem—and invites you to grow a collection of similar experiments for any site you use.

## daily.chebakov.me

The repository also contains a personal morning dashboard built with a static
Next.js/React frontend and a FastAPI backend.

The homepage follows [DAILY.md](./DAILY.md) and combines:

- direct access to IELTS vocabulary, speaking, and writing practice, with
  audio-only speaking prompts read by random British ElevenLabs voices;
- five repertoire-matched drills from the latest 100 Chess.com games and five
  deeper opening-theory drills, with local Stockfish comparison;
- bilingual "on this day" history from English and Russian Wikipedia;
- three Russian and three English sayings sampled at daily creation from the
  full Wikiquote collections, with OpenAI-generated translation, meaning, and
  usage notes;
- daily ML research selected from Hugging Face Papers, the Hugging Face blog,
  and alphaXiv;
- 30 daily source-grounded mathematics and ML problems, with worked solutions
  and transfer exercises; Algorithm day combines one book problem with one
  LeetCode Medium and one LeetCode Hard problem, all with Python solutions.
  Opening a worked solution is saved, while unopened problems carry into the
  next daily set;
- server-enforced 25-minute English- and Russian-reading timers, with a
  completion chime and durable SQLite history for future statistics;
- short introductions to important car models;
- public-domain Russian poetry for memory practice.

FastAPI refreshes the digest at midnight in the configured timezone, with a
first-visit fallback after a date change. The generated digest and selection
history persist in `api/daily.json`, preventing research, sayings, cars, and
poetry from repeating across restarts. The chess book is checked in at
`api/chess_repertoire.json`; daily chess state and non-repetition history live
in `api/chess_drills.json`. All LLM generation uses
OpenAI GPT-5.6 Sol through the Responses API; the problem studio uses high
reasoning effort and keeps its own non-repetition history in
`api/math_daily.json`. Provider credentials remain server-side.

Successfully evaluated IELTS writing attempts are saved in
`api/ielts_writing.sqlite3`, including the original response, timing, criterion
scores, feedback, and a minimal-change band-7.5 rewrite. This durable structure
is ready for future progress charts without exposing essay history publicly.

See [api/README.md](./api/README.md) for local and production setup.

## What it can do today

- Strip rank/file coordinate overlays from Aimchess chessboards when you'd rather rely on intuition.
- Hide LeetCode problem difficulty labels until you want to see them.
- Block Chess.com with a full-screen reminder once you've already played more than three games in a day.
- Keep a global on/off switch so you can pause every tweak with a single click.
- Offer a simple registry (`src/js/features.js`) where new ideas can be added without touching the rest of the codebase.

## Install from source

1. Clone this repository.
2. Install dependencies: `npm install`.
3. Build the extension: `npm run build`.
4. Open Chrome (or any Chromium-based browser) and navigate to `chrome://extensions/`.
5. Enable **Developer mode**.
6. Click **Load unpacked** and pick the `dist` folder from this project.

## Development workflow

- Build once: `npm run build`
- Build and watch for changes: `npm run watch`
- Package a zip for distribution: `npm run zip`

## Adding your own tweaks

1. Open `src/js/features.js`.
2. Add a new entry to `LITERATEGOGGLES_FEATURES` with:
   - a unique `id`,
   - a `name` and `description` for the popup,
   - a `storageKey` to remember the toggle state,
   - an `appliesTo(location)` function to limit where it runs,
   - `onEnable`/`onDisable` hooks to apply your changes.
3. Update `src/css` or `src/js` to include any styles or scripts your feature needs.
4. Run `npm run build` (or `npm run watch`) and reload the unpacked extension.

Each feature appears as its own toggle in the popup so you can experiment freely without disturbing the rest of your stack.

## License

MIT
