const dryRun = process.argv.includes("--dry-run");

const result = {
  mode: dryRun ? "dry-run" : "write",
  adapters: ["manual", "rss", "web", "search", "github", "hugging-face", "gdelt", "prediction-market", "social"],
  fetched: 0,
  deduplicated: 0,
  message: dryRun
    ? "Observation dry-run completed without writing evidence."
    : "Observation command is ready; configure sources before running ingestion writes."
};

console.log(JSON.stringify(result, null, 2));
