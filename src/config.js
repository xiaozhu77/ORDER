import fs from "node:fs/promises";
import path from "node:path";

export async function loadConfig(configPath = "config.json") {
  const resolved = path.resolve(configPath);
  const text = await fs.readFile(resolved, "utf8");
  const config = JSON.parse(text);

  config.dashboard ??= {};
  config.scraper ??= {};
  config.scraper.backend ??= {};
  config.scraper.backend.selectors ??= {};

  config.dashboard.host ??= "127.0.0.1";
  config.dashboard.port ??= 8787;
  config.dashboard.refreshSeconds ??= 10;
  config.scraper.enabled ??= true;
  config.scraper.headless ??= false;
  config.scraper.intervalSeconds ??= 20;
  config.scraper.timezone ??= "Asia/Shanghai";
  config.scraper.storageStatePath ??= "data/auth-state.json";
  config.scraper.ordersOutputPath ??= "data/orders.json";
  config.scraper.dashboardDataPath ??= "public/data/summary.json";

  return config;
}
