#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const WORDS_FILE = path.join(
  "source_content",
  "all_anime_top_2000.match.first2000.json",
);
const START = parseInt(process.argv[2] || "120", 10);

function loadWords() {
  if (!fs.existsSync(WORDS_FILE)) {
    console.error(`Error: ${WORDS_FILE} not found`);
    process.exit(1);
  }
  const arr = JSON.parse(fs.readFileSync(WORDS_FILE, "utf8"));
  return Array.isArray(arr) ? arr : [];
}

function runShort(query) {
  return new Promise((resolve) => {
    const args = ["run", "-s", "shorts:av:one", "--", "--query", query];
    const child = spawn("npm", args, { stdio: "inherit", shell: true });
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const words = loadWords();
  const total = words.length;
  console.log(`Total words: ${total}, starting from index ${START} (1-based)`);

  for (let i = START; i <= total; i++) {
    const word = words[i - 1]?.word;
    if (!word) {
      console.log(`[${i}/${total}] No word at index, skipping`);
      continue;
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`[${i}/${total}] Processing: ${word}`);
    console.log("=".repeat(50));

    try {
      const code = await runShort(word);
      if (code !== 0) {
        console.log(`FAILED: ${word} (exit ${code}), continuing...`);
      }
    } catch (err) {
      console.log(`ERROR: ${word} - ${err.message}, continuing...`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
