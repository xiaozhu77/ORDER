import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import path from "node:path";
import { loadConfig } from "./config.js";
import { startRuntime } from "./runtime.js";

let mainWindow = null;
let runtime = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (app.isPackaged) {
    process.chdir(path.resolve(process.resourcesPath));
  }

  const config = await loadConfig();
  const dashboardUrl = `http://${config.dashboard.host}:${config.dashboard.port}`;

  if (!(await isDashboardHealthy(dashboardUrl))) {
    try {
      runtime = await startRuntime(config);
    } catch (error) {
      if (!(await isDashboardHealthy(dashboardUrl))) {
        await dialog.showMessageBox({
          type: "error",
          title: "看板启动失败",
          message: error.message,
          detail: `请确认端口 ${config.dashboard.port} 没有被其它程序占用。`
        });
        app.quit();
        return;
      }
    }
  }

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "店铺订单广告看板",
    backgroundColor: "#080d14",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(dashboardUrl);
});

app.on("window-all-closed", async () => {
  await closeRuntime();
  app.quit();
});

async function closeRuntime() {
  if (!runtime?.server) return;
  await new Promise((resolve) => runtime.server.close(resolve));
  runtime = null;
}

async function isDashboardHealthy(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/api/stores`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
