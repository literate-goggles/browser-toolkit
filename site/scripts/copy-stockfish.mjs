import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";


const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, "..");
const packageDirectory = path.join(siteDirectory, "node_modules", "stockfish");
const outputDirectory = path.join(siteDirectory, "public", "stockfish");
const files = [
  ["bin/stockfish-18-lite-single.js", "stockfish-18-lite-single.js"],
  ["bin/stockfish-18-lite-single.wasm", "stockfish-18-lite-single.wasm"],
  ["Copying.txt", "Copying.txt"],
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  files.map(([source, destination]) =>
    copyFile(
      path.join(packageDirectory, source),
      path.join(outputDirectory, destination),
    ),
  ),
);

console.log("[stockfish] copied Stockfish 18 lite single-threaded assets");
