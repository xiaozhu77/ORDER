import { loadConfig } from "./config.js";
import { runAdCaptureLoop, runScraper } from "./scraper.js";
import { startServer } from "./server.js";

const config = await loadConfig();
await startServer(config);

const enabledStores = (config.stores ?? [])
  .filter((store) => store.scraper?.enabled !== false);

if (enabledStores.length) {
  await Promise.all(enabledStores.flatMap((store) => {
    const storeConfig = {
      ...config,
      store,
      scraper: store.scraper
    };
    return [
      runScraper(storeConfig),
      runAdCaptureLoop(storeConfig)
    ];
  }));
}
