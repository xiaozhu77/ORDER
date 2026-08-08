import { runAdCaptureLoop, runScraper } from "./scraper.js";
import { startCloudSync } from "./cloud-sync.js";
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

    runContinuously(() => runScraper(storeConfig), store.key, "order scraper");
    runContinuously(() => runAdCaptureLoop(storeConfig), store.key, "ad capture");
  }

  startCloudSync(config)?.catch((error) => {
    console.error(`云端看板同步已停止：${error.message}`);
  });

  return { server };
}

async function runContinuously(run, storeKey, label) {
  while (true) {
    try {
      await run();
    } catch (error) {
      console.error(`[${storeKey}] ${label} stopped: ${error.message}. Restarting in 5 seconds.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
