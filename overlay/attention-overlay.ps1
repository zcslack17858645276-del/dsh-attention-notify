param(
  [Parameter(Mandatory = $true)][string]$StateFile,
  [int]$ParentPid = 0,
  [string]$LogFile = ''
)

# Windows desktop overlay for DSH attention notifications.
# ASCII only. All user-visible text arrives through the UTF-8 state JSON file.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-Log([string]$text) {
  if ($LogFile -ne '') {
    try { $text | Out-File -LiteralPath $LogFile -Append -Encoding utf8 } catch {}
  }
}

Write-Log ("START " + (Get-Date -Format o))

$cs = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public class DanToastForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
            cp.ExStyle |= 0x00000020; // WS_EX_TRANSPARENT (click-through)
            return cp;
        }
    }
}

public struct DanPoint { public int X; public int Y; }

public static class DanWin {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware2();
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out DanPoint p);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);

    public static IntPtr Find(string part) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            if (sb.ToString().IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) {
                found = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Focus(string part) {
        IntPtr h = Find(part);
        if (h == IntPtr.Zero) return false;
        ShowWindow(h, 9); // SW_RESTORE
        uint pid;
        uint tid = GetWindowThreadProcessId(h, out pid);
        uint self = GetCurrentThreadId();
        bool attached = AttachThreadInput(self, tid, true);
        bool ok = SetForegroundWindow(h);
        if (attached) AttachThreadInput(self, tid, false);
        return ok;
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms, System.Drawing
[void][DanWin]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$scale = 1.0
try {
  $probe = New-Object System.Drawing.Bitmap(1, 1)
  $g = [System.Drawing.Graphics]::FromImage($probe)
  $scale = [double]$g.DpiX / 96.0
  $g.Dispose()
  $probe.Dispose()
} catch { $scale = 1.0 }

$bg        = [System.Drawing.Color]::FromArgb(13, 17, 23)     # #0D1117
$pink      = [System.Drawing.Color]::FromArgb(250, 181, 238)  # #FAB5EE
$secondary = [System.Drawing.Color]::FromArgb(199, 155, 192)  # #C79BC0
$green     = [System.Drawing.Color]::FromArgb(126, 231, 135)  # #7EE787
$orange    = [System.Drawing.Color]::FromArgb(255, 166, 87)   # #FFA657

$fontTitle = New-Object System.Drawing.Font('Microsoft YaHei UI', [float](10.5 * $scale), [System.Drawing.FontStyle]::Bold)
$fontBody  = New-Object System.Drawing.Font('Microsoft YaHei UI', [float](9.0 * $scale), [System.Drawing.FontStyle]::Regular)

$cardW = [int](380 * $scale)
$cardH = [int](88 * $scale)
$gap   = [int](8 * $scale)
$pad   = [int](12 * $scale)
$radius = [int](12 * $scale)
$accentW = [int](4 * $scale)

$form = New-Object DanToastForm
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::Fuchsia
$form.TransparencyKey = [System.Drawing.Color]::Fuchsia
$form.Width = $cardW + 2 * $pad
$form.Height = 3 * $cardH
$form.Show()
$form.Visible = $false

$soundDirs = @(
  (Join-Path $env:WINDIR 'Media')
)
$sounds = @{
  'notify'      = 'notify.wav'
  'notify2'     = 'Windows Notify.wav'
  'generic'     = 'Windows Notify System Generic.wav'
  'ding'        = 'ding.wav'
  'chimes'      = 'chimes.wav'
  'tada'        = 'tada.wav'
  'message'     = 'Windows Message Nudge.wav'
  'exclamation' = 'Windows Exclamation.wav'
  'default'     = 'Windows Default.wav'
  'error'       = 'Windows Error.wav'
  'critical'    = 'Windows Critical Stop.wav'
}
$players = @{}
function Play-Sound([string]$key) {
  if (-not $key -or $key -eq 'none') { return }
  $file = $sounds[$key]
  if (-not $file) { $file = 'notify.wav' }
  $path = Join-Path $env:WINDIR ('Media\' + $file)
  if (-not (Test-Path -LiteralPath $path)) { return }
  try {
    if (-not $players.ContainsKey($path)) {
      $players[$path] = New-Object System.Media.SoundPlayer $path
    }
    $players[$path].Play()
  } catch { Write-Log ("sound error: " + $_) }
}

function Get-RoundedPath([int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($w - $d, 0, $d, $d, 270, 90)
  $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  $p.AddArc(0, $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Get-Accent([string]$kind) {
  switch ($kind) {
    'complete'    { return $green }
    'approval'    { return $orange }
    'planReview'  { return $orange }
    'question'    { return $pink }
    default       { return $pink }
  }
}

function Clear-Cards {
  $old = @($form.Controls)
  foreach ($c in $old) { $form.Controls.Remove($c); $c.Dispose() }
}

$lastHash = ''
$seenIds = @{}
$lastPreviewSeq = 0
$wasDown = $false
$formShown = $false
$startedAt = (Get-Date)

while ($true) {
  [System.Windows.Forms.Application]::DoEvents()

  # Exit when the host process is gone.
  if ($ParentPid -gt 0) {
    $alive = $null
    try { $alive = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue } catch { $alive = $null }
    if ($null -eq $alive) { break }
  }

  $state = $null
  if (Test-Path -LiteralPath $StateFile) {
    try {
      $raw = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 -ErrorAction Stop
      if ($raw) { $state = $raw | ConvertFrom-Json }
    } catch {
      # A torn read is fine; retry next tick.
    }
  }

  if ($null -ne $state) {
    if ($state.shutdown -eq $true) { break }

    if ($null -ne $state.preview -and [int]$state.preview.seq -gt $lastPreviewSeq) {
      $lastPreviewSeq = [int]$state.preview.seq
      Play-Sound ([string]$state.preview.sound)
    }

    $cards = @()
    if ($null -ne $state.cards) { $cards = @($state.cards) }

    $parts = @()
    foreach ($c in $cards) {
      $parts += ('' + $c.id + '|' + $c.kind + '|' + $c.title + '|' + $c.session + '|' + $c.meta)
    }
    $hash = $parts -join '~'

    if ($hash -ne $lastHash) {
      Clear-Cards
      if ($cards.Count -eq 0) {
        $form.Visible = $false
        $formShown = $false
      } else {
        $count = $cards.Count
        $height = 2 * $pad + $count * $cardH + ($count - 1) * $gap
        $form.Height = $height
        $form.Width = $cardW + 2 * $pad
        $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $form.Left = $wa.Right - $form.Width - $pad
        $form.Top = [Math]::Max($wa.Top, $wa.Bottom - $height - $pad)

        $form.SuspendLayout()
        $i = 0
        foreach ($card in $cards) {
          $panel = New-Object System.Windows.Forms.Panel
          $panel.Width = $cardW
          $panel.Height = $cardH
          $panel.Left = $pad
          $panel.Top = $pad + $i * ($cardH + $gap)
          $panel.BackColor = $bg
          $panel.Region = New-Object System.Drawing.Region((Get-RoundedPath $cardW $cardH $radius))
          $form.Controls.Add($panel)

          $accent = New-Object System.Windows.Forms.Panel
          $accent.Width = $accentW
          $accent.Height = $cardH
          $accent.Left = [int](6 * $scale)
          $accent.Top = 0
          $accent.BackColor = Get-Accent ([string]$card.kind)
          $panel.Controls.Add($accent)

          $left = $accentW + [int](16 * $scale)
          $textW = $cardW - $left - [int](12 * $scale)

          $lblTitle = New-Object System.Windows.Forms.Label
          $lblTitle.Text = [string]$card.title
          $lblTitle.ForeColor = $pink
          $lblTitle.Font = $fontTitle
          $lblTitle.AutoEllipsis = $true
          $lblTitle.Left = $left
          $lblTitle.Top = [int](11 * $scale)
          $lblTitle.Width = $textW
          $lblTitle.Height = [int](22 * $scale)
          $panel.Controls.Add($lblTitle)

          $lblSession = New-Object System.Windows.Forms.Label
          $lblSession.Text = [string]$card.session
          $lblSession.ForeColor = $pink
          $lblSession.Font = $fontBody
          $lblSession.AutoEllipsis = $true
          $lblSession.Left = $left
          $lblSession.Top = [int](35 * $scale)
          $lblSession.Width = $textW
          $lblSession.Height = [int](20 * $scale)
          $panel.Controls.Add($lblSession)

          $lblMeta = New-Object System.Windows.Forms.Label
          $meta = [string]$card.meta
          if ($card.detail) { $meta = $meta + ' - ' + [string]$card.detail }
          $lblMeta.Text = $meta
          $lblMeta.ForeColor = $secondary
          $lblMeta.Font = $fontBody
          $lblMeta.AutoEllipsis = $true
          $lblMeta.Left = $left
          $lblMeta.Top = [int](57 * $scale)
          $lblMeta.Width = $textW
          $lblMeta.Height = [int](18 * $scale)
          $panel.Controls.Add($lblMeta)

          $i++
        }
        $form.ResumeLayout()
        $form.Refresh()
        $form.Visible = $true
        $formShown = $true
      }
      $lastHash = $hash
    }

    # Play at most one sound per change wave for newly seen cards.
    $newSound = ''
    foreach ($c in $cards) {
      $id = [string]$c.id
      if (-not $seenIds.ContainsKey($id)) {
        $seenIds[$id] = $true
        if (-not $newSound -and $c.sound) { $newSound = [string]$c.sound }
      }
    }
    if ($newSound) { Play-Sound $newSound }

    if ($seenIds.Count -gt 32) {
      $keep = @{}
      foreach ($c in $cards) { $keep[[string]$c.id] = $true }
      $seenIds = $keep
    }

    # Clicking a visible card focuses the DSH window (the form itself is click-through).
    $down = (([DanWin]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0)
    if ($down -and -not $wasDown -and $formShown) {
      $pt = New-Object DanPoint
      if ([DanWin]::GetCursorPos([ref]$pt)) {
        if ($pt.X -ge $form.Left -and $pt.X -le ($form.Left + $form.Width) -and
            $pt.Y -ge $form.Top -and $pt.Y -le ($form.Top + $form.Height)) {
          [void][DanWin]::Focus('DeepSeek Harness')
        }
      }
    }
    $wasDown = $down
  }

  # Safety valve: never linger more than 12 hours.
  if (((Get-Date) - $startedAt).TotalHours -gt 12) { break }

  Start-Sleep -Milliseconds 120
}

try { $form.Close() } catch {}
try { $form.Dispose() } catch {}
Write-Log ("DONE " + (Get-Date -Format o))
