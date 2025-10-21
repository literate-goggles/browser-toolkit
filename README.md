# LiterateGoggles

LiterateGoggles is a personal browser toolkit for tweaking the way websites look and behave. It starts with small conveniences—like hiding LeetCode difficulty badges so you can focus on solving the problem—and invites you to grow a collection of similar experiments for any site you use.

## What it can do today

- Strip rank/file coordinate overlays from Aimchess chessboards when you’d rather rely on intuition.
- Hide LeetCode problem difficulty labels until you want to see them.
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
