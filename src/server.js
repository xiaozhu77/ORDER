import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

export async function startServer(config) {
  const dashboard = config.dashboard;
  await ensureInitialSummary(config.scraper.dashboardDataPath);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
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

  await new Promise((resolve) => server.listen(dashboard.port, dashboard.host, resolve));
  console.log(`看板已启动: http://${dashboard.host}:${dashboard.port}`);
  return server;
}

async function ensureInitialSummary(summaryPath) {
  const resolved = path.resolve(summaryPath);
  try {
    await fs.access(resolved);
  } catch {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, JSON.stringify({
      generatedAt: new Date().toISOString(),
      date: "",
      totals: {
        orderCount: 0,
        totalAmount: 0,
        recognizedOrders: 0,
        unrecognizedOrders: 0,
        recognitionRate: 0
      },
      groups: [],
      orders: [],
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
    ".json": "application/json; charset=utf-8"
  }[ext] ?? "application/octet-stream";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = await loadConfig();
  await startServer(config);
}
