import { spawn } from "node:child_process";

export async function playNewOrderAlert(alertConfig = {}, orderCount = 0) {
  if (alertConfig?.enabled === false || orderCount <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await playWindowsBeep(alertConfig);
    return;
  }

  process.stdout.write("\u0007");
}

function playWindowsBeep(alertConfig) {
  const repeat = Math.max(1, Number(alertConfig.repeat ?? 2));
  const durationMs = Math.max(120, Number(alertConfig.durationMs ?? 250));
  const gapMs = Math.max(60, Number(alertConfig.gapMs ?? 120));
  const startFrequency = Math.max(200, Number(alertConfig.startFrequency ?? 1200));
  const stepFrequency = Math.max(50, Number(alertConfig.stepFrequency ?? 200));

  const commands = [];
  for (let index = 0; index < repeat; index += 1) {
    const frequency = startFrequency + index * stepFrequency;
    commands.push(`[console]::Beep(${frequency}, ${durationMs})`);
    if (index < repeat - 1) {
      commands.push(`Start-Sleep -Milliseconds ${gapMs}`);
    }
  }

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", commands.join("; ")],
      {
        stdio: "ignore",
        windowsHide: true
      }
    );

    child.on("error", () => {
      process.stdout.write("\u0007");
      resolve();
    });

    child.on("exit", () => resolve());
  });
}
