import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { readJson, writeJson } from "./file-store.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

export async function startServer(config) {
  const dashboard = config.dashboard;
  await ensureInitialSummary(config);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === "/api/stores") {
        sendJson(response, 200, buildStorePayload(config));
        return;
      }

      if (url.pathname === "/api/ad-capture-control") {
        await handleAdCaptureControl(request, response, config, url);
        return;
      }

      if (url.pathname === "/api/alert-sound") {
        await handleAlertSound(request, response, config, url);
        return;
      }

      const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      const filePath = path.resolve(publicDir, `.${pathname}`);

      if (!filePath.startsWith(publicDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const data = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(500);
      response.end(error.message);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(dashboard.port, dashboard.host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error) => {
    if (error.code === "EADDRINUSE") {
      throw new Error(`看板端口已被占用：http://${dashboard.host}:${dashboard.port}。如果页面打不开，请运行 npm.cmd run restart。`);
    }
    throw error;
  });
  console.log(`看板已启动: http://${dashboard.host}:${dashboard.port}`);
  return server;
}

async function handleAlertSound(request, response, config, url) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const store = resolveStore(config, url.searchParams.get("store"));
  const soundPath = store.scraper?.alerts?.soundPath || config.scraper?.alerts?.soundPath || "";
  if (!soundPath) {
    sendJson(response, 404, { error: "No alert sound configured" });
    return;
  }

  const resolved = path.resolve(soundPath);
  const data = await fs.readFile(resolved);
  response.writeHead(200, {
    "content-type": contentType(resolved),
    "cache-control": "no-store"
  });
  response.end(data);
}

async function handleAdCaptureControl(request, response, config, url) {
  const store = resolveStore(config, url.searchParams.get("store"));
  const controlPath = store.scraper?.adCapture?.controlPath ?? "data/ad-capture-control.json";

  if (request.method === "GET") {
    sendJson(response, 200, await readAdCaptureControl(controlPath));
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readRequestBody(request);
  const payload = body ? JSON.parse(body) : {};
  const previousState = await readAdCaptureControl(controlPath);
  const nextState = {
    ...previousState,
    paused: payload.paused === undefined ? previousState.paused : Boolean(payload.paused),
    reason: payload.reason === undefined ? previousState.reason : String(payload.reason ?? ""),
    targetDate: payload.targetDate === undefined ? previousState.targetDate : normalizeDate(payload.targetDate),
    refreshRequestedAt: payload.refreshRequestedAt === undefined ? previousState.refreshRequestedAt : normalizeIsoDateTime(payload.refreshRequestedAt),
    updatedAt: new Date().toISOString()
  };
  await writeJson(controlPath, nextState);
  sendJson(response, 200, nextState);
}

async function readAdCaptureControl(controlPath) {
  const control = await readJson(controlPath, {});
  return {
    paused: Boolean(control?.paused),
    reason: String(control?.reason ?? ""),
    targetDate: normalizeDate(control?.targetDate),
    refreshRequestedAt: normalizeIsoDateTime(control?.refreshRequestedAt),
    updatedAt: String(control?.updatedAt ?? "")
  };
}

function normalizeDate(value) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeIsoDateTime(value) {
  const text = String(value ?? "").trim();
  return Number.isFinite(Date.parse(text)) ? text : "";
}

function resolveStore(config, requestedKey) {
  const stores = config.stores ?? [];
  return stores.find((store) => store.key === requestedKey) ?? stores[0] ?? {
    key: "default",
    name: "店铺",
    url: "",
    scraper: config.scraper
  };
}

function buildStorePayload(config) {
  const stores = config.stores ?? [];
  return stores.map((store) => ({
    key: store.key,
    name: store.name,
    url: store.url,
    adAccountId: store.adAccountId || store.scraper?.adCapture?.adAccountId || "",
    adAccountName: store.adAccountName || store.scraper?.adCapture?.adAccountName || "",
    summaryUrl: publicDataUrl(store.scraper?.dashboardDataPath),
    adSummaryUrl: publicDataUrl(store.scraper?.adCapture?.outputPath)
  }));
}

function publicDataUrl(filePath) {
  const relative = path.relative(publicDir, path.resolve(filePath ?? "")).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? `/${relative}` : "";
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

async function ensureInitialSummary(config) {
  const stores = config.stores?.length
    ? config.stores
    : [{ scraper: config.scraper }];

  await Promise.all(stores.map((store) => ensureSummaryFile(config, store.scraper)));
}

async function ensureSummaryFile(config, scraper) {
  const resolved = path.resolve(scraper.dashboardDataPath);
  try {
    await fs.access(resolved);
  } catch {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, JSON.stringify({
      generatedAt: new Date().toISOString(),
      date: "",
      storeTimezone: scraper.storeTimezone ?? "America/Anchorage",
      storeDate: "",
      selectedDate: "",
      availableDates: [],
      yesterdayDate: "",
      dailySummaries: {},
      totals: {
        orderCount: 0,
        totalAmount: 0,
        recognizedOrders: 0,
        unrecognizedOrders: 0,
        recognitionRate: 0
      },
      groups: [],
      todayGroups: [],
      yesterdayGroups: [],
      continuingUtmIds: [],
      continuingGroups: [],
      last60Minutes: {
        orderCount: 0,
        totalAmount: 0,
        utmIds: [],
        groups: [],
        byUtmId: {},
        startAt: "",
        endAt: "",
        timeZone: scraper.storeTimezone ?? "America/Anchorage",
        label: "店铺时间"
      },
      hourlyBuckets: [],
      orders: [],
      currency: config.dashboard.currency ?? {},
      scrapeMeta: {},
      health: {
        ok: false,
        message: "等待首次抓取",
        lastScrapeAt: ""
      }
    }, null, 2), "utf8");
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wav": "audio/wav"
  }[ext] ?? "application/octet-stream";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = await loadConfig();
  await startServer(config);
}
