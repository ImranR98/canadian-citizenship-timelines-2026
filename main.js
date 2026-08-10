require("dotenv").config();

const { run } = require("./scrape");

const INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS, 10) || 3600000;

async function loop() {
  while (true) {
    console.log(`\n=== Scrape run started at ${new Date().toISOString()} ===`);
    try {
      await run();
    } catch (err) {
      console.error("Scrape run failed:", err);
    }
    console.log(`Next run in ${Math.round(INTERVAL_MS / 60000)} minutes`);
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
  }
}

loop().catch(err => {
  console.error(err);
  process.exit(1);
});
