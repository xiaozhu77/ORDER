import { runAdCaptureLoop, runScraper } from "./scraper.js";
import { startServer } from "./server.js";

export async function startRuntime(config) {
  const server = await startServer(config);
  const enabledStores = (config.stores ?? [])
    .filter((store) => store.scraper?.enabled !== false);

  for (const store of enabledStores) {
    const storeConfig = {
      ...config,
      store,
      scraper: store.scraper
    };

    runScraper(storeConfig).catch((error) => {
      console.error(`[${store.key}] order scraper stopped:`, error.message);
    });
    runAdCaptureLoop(storeConfig).catch((error) => {
      console.error(`[${store.key}] ad capture stopped:`, error.message);
    });
  }

  return { server };
}
