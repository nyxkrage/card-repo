import "npm:@total-typescript/ts-reset";

import {
  basename,
  extname,
  join,
} from "https://deno.land/std@0.224.0/path/mod.ts";
// @deno-types="npm:@types/png-chunk-text"
import pngText from "npm:png-chunk-text";
// @deno-types="npm:@types/png-chunks-extract"
import pngChunksExtract from "npm:png-chunks-extract";
// @deno-types="npm:@types/png-chunks-encode"
import pngChunksEncode from "npm:png-chunks-encode";

import Handlebars from "npm:handlebars";

const cwd = Deno.cwd();

// Remove dist folder if it exists and recreate it with a new empty folder
await Deno.remove(join(cwd, "dist"), { recursive: true }).catch(() => {});
await Deno.mkdir(join(cwd, "dist"));

// Read cards directory and create a map of cards
const cardsDir = join(cwd, "cards");
const outDir = join(cwd, "dist");

const jsonFiles = new Set();
const pngFiles = new Set();

for await (const dirEntry of Deno.readDir(cardsDir)) {
  if (dirEntry.isFile) {
    const ext = extname(dirEntry.name);
    const baseName = basename(dirEntry.name, ext);

    if (ext === ".json") {
      jsonFiles.add(baseName);
    } else if (ext === ".png") {
      pngFiles.add(baseName);
    }
  }
}

// Check if all JSON files have a corresponding PNG file and vice versa
const uniqueCards = new Set(
  [...jsonFiles].filter((file) => pngFiles.has(file)),
);

const unmatchedJsonFiles = [...jsonFiles].filter((file) => !pngFiles.has(file));
const unmatchedPngFiles = [...pngFiles].filter((file) => !jsonFiles.has(file));

if (unmatchedJsonFiles.length > 0 || unmatchedPngFiles.length > 0) {
  console.error("Unmatched JSON files:", unmatchedJsonFiles);
  console.error("Unmatched PNG files:", unmatchedPngFiles);
  Deno.exit(1);
}

// Create a map of cards with their data and write to dist
const cards = new Map();

for (const card of uniqueCards) {
  const jsonFilePath = join(cardsDir, `${card}.json`);
  const pngFilePath = join(cardsDir, `${card}.png`);

  const jsonData = JSON.parse(await Deno.readTextFile(jsonFilePath));
  const pngData = await Deno.readFile(pngFilePath);

  const chunks = pngChunksExtract(pngData).map((chunk) => {
    if (chunk.name === "tEXt") {
      const keyword = pngText.decode(chunk.data).keyword;

      return keyword === "chara" ? null : chunk;
    }
    return chunk;
  }).filter(Boolean);
  chunks.push(pngText.encode("chara", JSON.stringify(jsonData)));
  const cardPng = pngChunksEncode(chunks);
  await Deno.writeFile(join(outDir, `${card}.png`), cardPng);
  await Deno.writeTextFile(
    join(outDir, `${card}.json`),
    JSON.stringify(jsonData, null, 2),
  );
  cards.set(card, jsonData);
}

// template index.hbs and write to dist
const template = Handlebars.compile(
  await Deno.readTextFile(join(cwd, "site/index.hbs")),
);
await Deno.writeTextFile(
  join(outDir, "index.html"),
  template({
    cards: [...cards.entries()].map(([key, card]) => {
      return { key, ...card.data };
    }),
  }),
);

// copy other files to dist
for await (const entry of Deno.readDir(join(cwd, "site"))) {
  if (entry.isFile && entry.name !== "index.hbs") {
    await Deno.copyFile(
      join(cwd, "site", entry.name),
      join(outDir, entry.name),
    );
  }
}
