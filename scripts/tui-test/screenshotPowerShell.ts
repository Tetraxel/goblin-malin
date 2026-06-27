import { writeFile, mkdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

// NOTE: This relies on Windows Terminal (wt.exe) being the default console host (true on Windows 11).
// The terminal window must be large enough to display all rows at once — if content is truncated,
// the user needs to reduce their Windows Terminal default font size or increase the default window
// size in Settings > Profiles > Defaults. This cannot be controlled programmatically.

function runPS(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        const ps = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        ps.stdout?.on("data", (d: Buffer) => out.push(d));
        ps.stderr?.on("data", (d: Buffer) => err.push(d));
        ps.on("close", (code) => {
            const stderr = Buffer.concat(err).toString("utf-8").trim();
            if (code === 0) {
                resolve(Buffer.concat(out).toString("utf-8").trim());
            } else {
                reject(new Error(`PowerShell exit ${code}${stderr ? ": " + stderr : ""}`));
            }
        });
    });
}

export async function renderToImagePowerShell(
    cols: number,
    rows: number,
    ansiContent: string,
    outputPath: string
): Promise<void> {
    const tempDir = join(tmpdir(), "goblin-tui-test");
    await mkdir(tempDir, { recursive: true });

    const id = Date.now();
    const title = `goblintui${id}`;
    const contentFile = join(tempDir, `ansi_${id}.txt`);
    const readyFile = join(tempDir, `ready_${id}.txt`);
    const psFile = join(tempDir, `show_${id}.ps1`);
    const outputEscaped = outputPath.replace(/\\/g, "\\\\");
    const contentFileEscaped = contentFile.replace(/\\/g, "\\\\");
    const readyFileEscaped = readyFile.replace(/\\/g, "\\\\");

    // Position each row absolutely so content is never affected by scroll state.
    const positionedRows = ansiContent
        .split("\n")
        .map((line, i) => `\x1b[${i + 1};1H${line}`)
        .join("");
    const frame = "\x1b[40m\x1b[2J" + positionedRows + "\x1b[0m";
    await writeFile(contentFile, frame, "utf-8");

    const showScript = `
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $host.UI.RawUI.BackgroundColor = "Black"
    $host.UI.RawUI.ForegroundColor = "Gray"
    $host.UI.RawUI.BufferSize = New-Object System.Management.Automation.Host.Size(${cols}, ${rows})
    $host.UI.RawUI.WindowSize = New-Object System.Management.Automation.Host.Size(${cols}, ${rows})
} catch {}
[System.Console]::Write([System.IO.File]::ReadAllText("${contentFileEscaped}"))
[System.IO.File]::WriteAllText("${readyFileEscaped}", "ready")
Start-Sleep -Seconds 60
`.trim();

    await writeFile(psFile, showScript, "utf-8");

    await runPS(
        `Start-Process wt.exe -ArgumentList "-w new nt --title ${title} --suppressApplicationTitle powershell.exe -NoLogo -NoProfile -File ${psFile}"`
    );

    // Wait for the show script to signal it has rendered content.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            if ((await readFile(readyFile, "utf-8")).trim()) break;
        } catch {}
        await new Promise<void>((r) => setTimeout(r, 100));
    }
    await new Promise<void>((r) => setTimeout(r, 800));

    const screenshotPS = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W32 {
    public delegate bool EnumWndProc(IntPtr hwnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWndProc f, IntPtr lp);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int n);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public static IntPtr FindWTByTitle(string fragment) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            if (!IsWindowVisible(hwnd)) return true;
            var cls = new StringBuilder(256); GetClassName(hwnd, cls, 256);
            if (cls.ToString() != "CASCADIA_HOSTING_WINDOW_CLASS") return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, 512);
            if (title.ToString().Contains(fragment)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@
[W32]::SetProcessDPIAware() | Out-Null
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(15)
while ($hwnd.ToInt64() -eq 0 -and (Get-Date) -lt $deadline) {
    $hwnd = [W32]::FindWTByTitle("${title}")
    if ($hwnd.ToInt64() -eq 0) { Start-Sleep -Milliseconds 200 }
}
if ($hwnd.ToInt64() -eq 0) { Write-Error "Could not find WT window '${title}'"; exit 1 }
[W32]::ShowWindow($hwnd, 9) | Out-Null
[W32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300
$cr = New-Object W32+RECT
[W32]::GetClientRect($hwnd, [ref]$cr) | Out-Null
$pt = New-Object W32+POINT; $pt.X = 0; $pt.Y = 0
[W32]::ClientToScreen($hwnd, [ref]$pt) | Out-Null
$w = $cr.R - $cr.L; $h = $cr.B - $cr.T
if ($w -le 0 -or $h -le 0) { Write-Error "Invalid window bounds $($w)x$($h)"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($pt.X, $pt.Y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()
# Crop the WT tab strip: scan from top for the first row that is mostly pure black (terminal background).
$termY = 0
for ($y = 0; $y -lt [Math]::Min($h, 200); $y++) {
    $dark = 0; $n = [Math]::Min($w, 100)
    for ($x = 0; $x -lt $n; $x++) {
        $p = $bmp.GetPixel($x, $y)
        if ($p.R -lt 10 -and $p.G -lt 10 -and $p.B -lt 10) { $dark++ }
    }
    if ($dark -gt $n * 0.8) { $termY = $y; break }
}
$termH = $h - $termY
$out = New-Object System.Drawing.Bitmap($w, $termH)
$gc = [System.Drawing.Graphics]::FromImage($out)
$src = New-Object System.Drawing.Rectangle(0, $termY, $w, $termH)
$dst = New-Object System.Drawing.Rectangle(0, 0, $w, $termH)
$gc.DrawImage($bmp, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
$out.Save("${outputEscaped}")
$gc.Dispose(); $out.Dispose(); $bmp.Dispose()
Write-Output "ok termY=$termY size=$($w)x$($h)"
`;

    try {
        const result = await runPS(screenshotPS);
        console.error(`[screenshot-powershell] ${result}`);
    } finally {
        await runPS(
            `Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*${title}*" } | Stop-Process -Force`
        ).catch(() => {});
        try {
            await unlink(contentFile);
        } catch {}
        try {
            await unlink(readyFile);
        } catch {}
        try {
            await unlink(psFile);
        } catch {}
    }
}
