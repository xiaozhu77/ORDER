import { spawn } from "node:child_process";
import fs from "node:fs";

export async function playNewOrderAlert(alertConfig = {}, orderCount = 0) {
  if (alertConfig?.enabled === false || orderCount <= 0) {
    return;
  }

  if (process.platform === "win32") {
    if (alertConfig.soundPath && fs.existsSync(alertConfig.soundPath)) {
      await playWindowsSoundFile(alertConfig.soundPath);
      return;
    }
    await playWindowsSoftTone(alertConfig);
    return;
  }

  process.stdout.write("\u0007");
}

function playWindowsSoundFile(soundPath) {
  const escapedPath = String(soundPath).replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Media
$player = New-Object System.Media.SoundPlayer('${escapedPath}')
$player.PlaySync()
$player.Dispose()
`;

  return runHiddenPowerShell(script);
}

function playWindowsSoftTone(alertConfig) {
  const repeat = Math.max(1, Number(alertConfig.repeat ?? 2));
  const durationMs = Math.max(80, Number(alertConfig.durationMs ?? 170));
  const gapMs = Math.max(80, Number(alertConfig.gapMs ?? 140));
  const startFrequency = Math.max(200, Number(alertConfig.startFrequency ?? 620));
  const stepFrequency = Math.max(20, Number(alertConfig.stepFrequency ?? 90));

  const script = `
Add-Type -AssemblyName System.Media
$sampleRate = 44100
$repeat = ${repeat}
$durationMs = ${durationMs}
$gapMs = ${gapMs}
$startFrequency = ${startFrequency}
$stepFrequency = ${stepFrequency}
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
function Write-Int16([int]$value) { $writer.Write([BitConverter]::GetBytes([int16]$value)) }
function Write-Int32([int]$value) { $writer.Write([BitConverter]::GetBytes([int32]$value)) }
$samplesPerTone = [int]($sampleRate * $durationMs / 1000)
$samplesPerGap = [int]($sampleRate * $gapMs / 1000)
$totalSamples = ($samplesPerTone * $repeat) + ($samplesPerGap * [Math]::Max(0, $repeat - 1))
$dataLength = $totalSamples * 2
$writer.Write([Text.Encoding]::ASCII.GetBytes("RIFF"))
Write-Int32(36 + $dataLength)
$writer.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
Write-Int32(16)
Write-Int16(1)
Write-Int16(1)
Write-Int32($sampleRate)
Write-Int32($sampleRate * 2)
Write-Int16(2)
Write-Int16(16)
$writer.Write([Text.Encoding]::ASCII.GetBytes("data"))
Write-Int32($dataLength)
for ($tone = 0; $tone -lt $repeat; $tone++) {
  $frequency = $startFrequency + ($tone * $stepFrequency)
  for ($i = 0; $i -lt $samplesPerTone; $i++) {
    $phase = 2 * [Math]::PI * $frequency * $i / $sampleRate
    $envelope = [Math]::Sin([Math]::PI * $i / $samplesPerTone)
    $sample = [int16]([Math]::Sin($phase) * $envelope * 8000)
    Write-Int16($sample)
  }
  if ($tone -lt $repeat - 1) {
    for ($i = 0; $i -lt $samplesPerGap; $i++) { Write-Int16(0) }
  }
}
$writer.Flush()
$stream.Position = 0
$player = New-Object System.Media.SoundPlayer($stream)
$player.PlaySync()
$player.Dispose()
$writer.Dispose()
$stream.Dispose()
`;

  return runHiddenPowerShell(script);
}

function runHiddenPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
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
