import { loadConfig } from "./config.js";
import { runScraper } from "./scraper.js";
import { startServer } from "./server.js";

const config = await loadConfig();
await startServer(config);

if (config.scraper.enabled) {
  await runScraper(config);
}
