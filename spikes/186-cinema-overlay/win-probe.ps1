# Story 186 spike: long-lived, DPI-aware Win32 probe. Reads one command per stdin line, prints one
# JSON line per command. Started by harness.mjs (so 250 ms sampling costs no process start).
#   info <hwnd>            rect, topmost, foreground, iconic, visible, ex-style
#   mainwin <pid>          main window handle of a process
#   at <x> <y>             WindowFromPoint -> root window, owning pid, class
#   fg                     foreground window (root), pid, class
#   taskbar                Shell_TrayWnd rect
#   cursor                 GetCursorInfo (CURSOR_SHOWING), GetClipCursor, virtual screen
#   activate <hwnd>        Alt tap + SetForegroundWindow
#   other                  hwnd/pid of some unrelated visible window (Code/explorer/WindowsTerminal)
#   close <hwnd>           PostMessage WM_CLOSE
#   move <x> <y>           SendInput absolute mouse move (physical px)
#   click                  SendInput left button down+up
#   keys <vk,vk,...>       SendInput key down+up per virtual key code (decimal)
#   alttab                 SendInput Alt down, Tab down/up, Alt up
#   shot <path>            PNG of the whole virtual screen
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTU { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTU u; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, IntPtr e);

  public static void Mouse(int dx, int dy, uint flags) {
    INPUT[] a = new INPUT[1]; a[0].type = 0; a[0].u.mi.dx = dx; a[0].u.mi.dy = dy; a[0].u.mi.dwFlags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void MoveAbs(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int nx = (int)(((double)(x - vx) + 0.5) * 65535.0 / vw), ny = (int)(((double)(y - vy) + 0.5) * 65535.0 / vh);
    Mouse(nx, ny, 0x8000 | 0x4000 | 0x0001);
  }
  public static void Key(ushort vk, bool up) {
    INPUT[] a = new INPUT[1]; a[0].type = 1; a[0].u.ki.vk = vk; a[0].u.ki.scan = (ushort)MapVirtualKey(vk, 0); a[0].u.ki.flags = up ? 2u : 0u;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Cls(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
"@
[void][W]::SetProcessDPIAware()
function ToH([string]$s) { New-Object IntPtr ([int64]$s) }
function Rect($r) { @{ x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T } }
function Win([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return @{ hwnd = 0 } }
  $root = [W]::GetAncestor($h, 2); if ($root -eq [IntPtr]::Zero) { $root = $h }
  @{ hwnd = [int64]$h; root = [int64]$root; pid = [int][W]::Pid($h); class = [W]::Cls($h); rootClass = [W]::Cls($root) }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim() -split ' '
  try {
    switch ($p[0]) {
      'info' {
        $h = ToH $p[1]; $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
        $ex = [W]::GetWindowLong($h, -20); $st = [W]::GetWindowLong($h, -16)
        $o = @{ hwnd = [int64]$h; window = (Rect $r); topmost = [bool]($ex -band 0x8); layered = [bool]($ex -band 0x80000)
          transparentStyle = [bool]($ex -band 0x20); captioned = [bool]($st -band 0x00C00000)
          foreground = ([W]::GetForegroundWindow() -eq $h); iconic = [W]::IsIconic($h); visible = [W]::IsWindowVisible($h) }
      }
      'mainwin' { $o = @{ hwnd = [int64](Get-Process -Id ([int]$p[1])).MainWindowHandle } }
      'at' { $pt = New-Object W+POINT; $pt.X = [int]$p[1]; $pt.Y = [int]$p[2]; $o = Win ([W]::WindowFromPoint($pt)) }
      'fg' { $o = Win ([W]::GetForegroundWindow()) }
      'taskbar' {
        $h = [W]::FindWindow('Shell_TrayWnd', $null); $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
        $o = @{ hwnd = [int64]$h; window = (Rect $r); visible = [W]::IsWindowVisible($h) }
      }
      'cursor' {
        $ci = New-Object W+CURSORINFO; $ci.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($ci); [void][W]::GetCursorInfo([ref]$ci)
        $c = New-Object W+RECT; [void][W]::GetClipCursor([ref]$c)
        $o = @{ showing = [bool]($ci.flags -band 1); flags = $ci.flags; pos = @{ x = $ci.pt.X; y = $ci.pt.Y }; clip = (Rect $c)
          virtualScreen = @{ x = [W]::GetSystemMetrics(76); y = [W]::GetSystemMetrics(77); w = [W]::GetSystemMetrics(78); h = [W]::GetSystemMetrics(79) } }
      }
      'activate' {
        [W]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
        $o = @{ ok = [W]::SetForegroundWindow((ToH $p[1])) }; Start-Sleep -Milliseconds 300
      }
      'other' {
        $q = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match '^(Code|explorer|WindowsTerminal)$' } | Select-Object -First 1
        if ($q) { $o = @{ pid = $q.Id; hwnd = [int64]$q.MainWindowHandle; name = $q.ProcessName } } else { $o = @{ pid = 0; hwnd = 0 } }
      }
      'close' { $o = @{ ok = [W]::PostMessage((ToH $p[1]), 0x10, [IntPtr]::Zero, [IntPtr]::Zero) } }
      'move' { [W]::MoveAbs([int]$p[1], [int]$p[2]); $o = @{ ok = $true } }
      'click' { [W]::Mouse(0, 0, 2); Start-Sleep -Milliseconds 40; [W]::Mouse(0, 0, 4); $o = @{ ok = $true } }
      'keys' {
        foreach ($k in ($p[1] -split ',')) { [W]::Key([uint16][int]$k, $false); Start-Sleep -Milliseconds 40; [W]::Key([uint16][int]$k, $true); Start-Sleep -Milliseconds 40 }
        $o = @{ ok = $true }
      }
      'alttab' {
        [W]::Key(0x12, $false); Start-Sleep -Milliseconds 60; [W]::Key(0x09, $false); Start-Sleep -Milliseconds 60
        [W]::Key(0x09, $true); Start-Sleep -Milliseconds 300; [W]::Key(0x12, $true); Start-Sleep -Milliseconds 300; $o = @{ ok = $true }
      }
      'shot' {
        $vx = [W]::GetSystemMetrics(76); $vy = [W]::GetSystemMetrics(77); $vw = [W]::GetSystemMetrics(78); $vh = [W]::GetSystemMetrics(79)
        $bmp = New-Object System.Drawing.Bitmap $vw, $vh; $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($vx, $vy, 0, 0, $bmp.Size); $bmp.Save($p[1], [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
        $o = @{ ok = $true; path = $p[1] }
      }
      default { $o = @{ error = "unknown command $($p[0])" } }
    }
  } catch { $o = @{ error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush()
}
