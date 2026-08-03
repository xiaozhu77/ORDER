import fs from "node:fs/promises";
import path from "node:path";

export async function loadConfig(configPath = "config.json") {
  const resolved = path.resolve(configPath);
  const text = await fs.readFile(resolved, "utf8");
  const config = JSON.parse(text);

  config.dashboard ??= {};
  config.dashboard.host ??= "127.0.0.1";
  config.dashboard.port ??= 8787;
  config.dashboard.refreshSeconds ??= 10;

  config.scraper = applyScraperDefaults(config.scraper ?? {}, {
    storageStatePath: "data/auth-state.json",
    ordersOutputPath: "data/orders.json",
    dashboardDataPath: "public/data/summary.json",
    adOutputPath: "public/data/ad-summary.json",
    adControlPath: "data/ad-capture-control.json"
  });
  config.stores = normalizeStores(config);

  return config;
}

function normalizeStores(config) {
  const sourceStores = Array.isArray(config.stores) && config.stores.length
    ? config.stores
    : [{
      key: config.store?.key ?? "default",
      name: config.store?.name ?? storeNameFromUrl(config.scraper.backend.ordersUrl),
      url: config.store?.url ?? storeOrigin(config.scraper.backend.ordersUrl),
      scraper: config.scraper
    }];

  return sourceStores.map((store, index) => {
    const key = safeStoreKey(store.key || store.id || `store-${index + 1}`);
    const scraper = mergeScraper(config.scraper, store.scraper ?? {});

    return {
      key,
      name: store.name || store.label || key,
      url: store.url || storeOrigin(scraper.backend.ordersUrl),
      adAccountName: store.adAccountName || scraper.adCapture?.adAccountName || "",
      adAccountId: store.adAccountId || scraper.adCapture?.adAccountId || "",
      scraper: applyScraperDefaults(scraper, {
        storageStatePath: `data/stores/${key}/auth-state.json`,
        ordersOutputPath: `data/stores/${key}/orders.json`,
        dashboardDataPath: `public/data/stores/${key}/summary.json`,
        adOutputPath: `public/data/stores/${key}/ad-summary.json`,
        adControlPath: `data/stores/${key}/ad-capture-control.json`
      })
    };
  });
}

function mergeScraper(base, override) {
  return {
    ...base,
    ...override,
    backend: {
      ...(base.backend ?? {}),
      ...(override.backend ?? {}),
      selectors: {
        ...(base.backend?.selectors ?? {}),
        ...(override.backend?.selectors ?? {})
      }
    },
    adCapture: {
      ...(base.adCapture ?? {}),
      ...(override.adCapture ?? {})
    },
    alerts: {
      ...(base.alerts ?? {}),
      ...(override.alerts ?? {})
    }
  };
}

function applyScraperDefaults(scraper, paths) {
  scraper.backend ??= {};
  scraper.backend.selectors ??= {};
  scraper.enabled ??= true;
  scraper.headless ??= false;
  scraper.intervalSeconds ??= 20;
  scraper.timezone ??= "Asia/Shanghai";
  scraper.storeTimezone ??= "America/Anchorage";
  scraper.storageStatePath ??= paths.storageStatePath;
  scraper.ordersOutputPath ??= paths.ordersOutputPath;
  scraper.dashboardDataPath ??= paths.dashboardDataPath;
  scraper.adCapture ??= {};
  scraper.adCapture.enabled ??= true;
  scraper.adCapture.outputPath ??= paths.adOutputPath;
  scraper.adCapture.refreshBeforeRead ??= true;
  scraper.adCapture.pollSeconds ??= 8;
  scraper.adCapture.refreshEverySeconds ??= 60;
  scraper.adCapture.intervalMinutes ??= 0;
  scraper.adCapture.controlPath ??= paths.adControlPath;
  scraper.adCapture.adAccountId ??= "";
  scraper.adCapture.ctid ??= "";
  scraper.adCapture.adAccountName ??= "";
  scraper.adCapture.campaignPageUrl ??= "";

  return scraper;
}

function safeStoreKey(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "store";
}

function storeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function storeNameFromUrl(value) {
  try {
    return new URL(value).hostname.split(".")[0] || "店铺";
  } catch {
    return "店铺";
  }
}
