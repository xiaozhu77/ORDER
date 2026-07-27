import { loadConfig } from "./config.js";
import { startRuntime } from "./runtime.js";

const config = await loadConfig();
await startRuntime(config);
await new Promise(() => {});
