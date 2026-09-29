# Story 169 spike: reads a process's main window geometry in physical pixels (DPI-aware), its
# topmost flag and whether it is the foreground window. Optional -Activate <pid> brings that
# process's main window to the foreground first. Prints one JSON line.
param([int]$ProcessId, [int]$Activate = 0)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, IntPtr e);
}
"@
[void][W]::SetProcessDPIAware()

if ($Activate -ne 0) {
  $a = (Get-Process -Id $Activate).MainWindowHandle
  # An Alt tap lifts the foreground lock so a background process may switch the foreground.
  [W]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
  [void][W]::SetForegroundWindow($a)
  Start-Sleep -Milliseconds 300
}

$h = (Get-Process -Id $ProcessId).MainWindowHandle
$r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
$c = New-Object W+RECT; [void][W]::GetClientRect($h, [ref]$c)
$p = New-Object W+POINT; [void][W]::ClientToScreen($h, [ref]$p)
$ex = [W]::GetWindowLong($h, -20)
$style = [W]::GetWindowLong($h, -16)
[pscustomobject]@{
  hwnd = [int64]$h
  window = @{ x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T }
  client = @{ x = $p.X; y = $p.Y; w = $c.R; h = $c.B }
  topmost = [bool]($ex -band 0x8)
  captioned = [bool]($style -band 0x00C00000)
  foreground = ([W]::GetForegroundWindow() -eq $h)
  screen = @{ w = [W]::GetSystemMetrics(0); h = [W]::GetSystemMetrics(1) }
} | ConvertTo-Json -Compress -Depth 3
