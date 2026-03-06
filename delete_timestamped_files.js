const fs = require("fs");
const path = require("path");

const timestampRegex = /\.2026\d{4}-\d{6}/;

const dryRun = process.argv.includes("--dry-run");

const files = fs.readdirSync(".");
let deleteCount = 0;
let skipCount = 0;

files.forEach((file) => {
  if (fs.statSync(file).isFile()) {
    if (timestampRegex.test(file)) {
      if (dryRun) {
        console.log(`[DRY RUN] Would delete: ${file}`);
        deleteCount++;
      } else {
        try {
          fs.unlinkSync(file);
          console.log(`Deleted: ${file}`);
          deleteCount++;
        } catch (err) {
          console.error(`Error deleting ${file}:`, err.message);
        }
      }
    } else {
      skipCount++;
    }
  }
});

console.log(
  `\n${dryRun ? "[DRY RUN] " : ""}Would delete ${deleteCount} files, skip ${skipCount} files`,
);
console.log(`\nRun without --dry-run to actually delete files`);
