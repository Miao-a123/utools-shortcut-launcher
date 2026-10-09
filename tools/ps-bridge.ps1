param(
  [string]$Mode = '',
  [string]$InFile = '',
  [string]$OutFile = '',
  [switch]$Agent
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Utf8 = New-Object System.Text.UTF8Encoding($false)

$IconCode = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class KlIcon
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [ComImport]
    [Guid("46EB5926-582E-4017-9FDF-E8998DAA0950")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IImageList
    {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, ref IntPtr picon);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("shell32.dll", SetLastError = false)]
    private static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);

    [DllImport("user32.dll", SetLastError = false)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("user32.dll", SetLastError = false)]
    private static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int cx, int cy, int istep, IntPtr hbrFlicker, int diFlags);

    private const uint SHGFI_ICON = 0x000000100;
    private const uint SHGFI_SYSICONINDEX = 0x000004000;
    private const int ILD_TRANSPARENT = 0x00000001;
    private const int DI_NORMAL = 0x0003;

    private static Bitmap Materialize(IntPtr hIcon, int size)
    {
        if (size < 8) { size = 32; }
        Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            IntPtr hdc = g.GetHdc();
            try { DrawIconEx(hdc, 0, 0, hIcon, size, size, 0, IntPtr.Zero, DI_NORMAL); }
            finally { g.ReleaseHdc(hdc); }
        }
        return bmp;
    }

    public static int SystemIndex(string file)
    {
        SHFILEINFO sh = new SHFILEINFO();
        IntPtr r = SHGetFileInfo(file, 0, ref sh, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_SYSICONINDEX | SHGFI_ICON);
        if (sh.hIcon != IntPtr.Zero) { DestroyIcon(sh.hIcon); }
        return sh.iIcon;
    }

    public static Bitmap FromIndex(int index, int listId, int size)
    {
        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        IImageList list = null;
        try
        {
            if (SHGetImageList(listId, ref iid, out list) != 0 || list == null) { return null; }
            IntPtr h = IntPtr.Zero;
            list.GetIcon(index, ILD_TRANSPARENT, ref h);
            if (h == IntPtr.Zero) { return null; }
            try { return Materialize(h, size); }
            finally { DestroyIcon(h); }
        }
        catch { return null; }
        finally { if (list != null) { Marshal.ReleaseComObject(list); } }
    }

    public static Bitmap Extract(string path, int iconIndex)
    {
        if (String.IsNullOrEmpty(path)) { return null; }
        int idx = iconIndex;
        if (idx < 0)
        {
            try { idx = SystemIndex(path); }
            catch { idx = -1; }
        }
        if (idx >= 0)
        {
            Bitmap b = FromIndex(idx, 4, 256);
            if (b != null && b.Width > 1) { return b; }
            b = FromIndex(idx, 2, 48);
            if (b != null && b.Width > 1) { return b; }
            b = FromIndex(idx, 0, 32);
            if (b != null && b.Width > 1) { return b; }
        }
        try
        {
            Icon ico = Icon.ExtractAssociatedIcon(path);
            if (ico != null)
            {
                using (ico)
                {
                    Bitmap b = Materialize(ico.Handle, ico.Width);
                    if (b != null && b.Width > 1) { return b; }
                }
            }
        }
        catch { }
        return null;
    }
}
'@

$script:IconReady = $false
$script:IconOk = $false

function Ensure-IconTypes {
  if ($script:IconReady) { return $script:IconOk }
  $script:IconReady = $true
  try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop } catch { return $false }
  $ref = ''
  try { $ref = [System.Drawing.Bitmap].Assembly.Location } catch { }
  try {
    if ($ref) { Add-Type -TypeDefinition $IconCode -ReferencedAssemblies $ref -ErrorAction Stop }
    else { Add-Type -TypeDefinition $IconCode -ErrorAction Stop }
    $script:IconOk = $true
  } catch {
    try { Add-Type -TypeDefinition $IconCode -ErrorAction Stop; $script:IconOk = $true } catch { $script:IconOk = $false }
  }
  return $script:IconOk
}

function ConvertFrom-TextSmart {
  param([string]$Path)
  $bytes = [IO.File]::ReadAllBytes($Path)
  # UTF-16 with BOM (browser-generated .url files are usually UTF-16LE)
  if ($bytes.Length -ge 2) {
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
      try { return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) } catch { }
    }
    if ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
      try { return [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2) } catch { }
    }
  }
  # UTF-16 without BOM: heuristic - odd bytes almost all zero in the ASCII header region
  if ($bytes.Length -ge 16) {
    $step = [Math]::Min(64, $bytes.Length)
    $zeros = 0
    for ($i = 1; $i -lt $step; $i += 2) { if ($bytes[$i] -eq 0) { $zeros++ } }
    if ($zeros -ge ($step / 2) * 0.8) {
      try { return [Text.Encoding]::Unicode.GetString($bytes) } catch { }
    }
  }
  $utf8 = [Text.Encoding]::UTF8.GetString($bytes)
  if ($utf8.IndexOf([char]0xFFFD) -ge 0) {
    try { return [Text.Encoding]::GetEncoding(936).GetString($bytes) } catch { }
  }
  return $utf8
}

function Invoke-KlResolve {
  param($Payload)
  $items = New-Object System.Collections.ArrayList
  $ws = $null
  try { $ws = New-Object -ComObject WScript.Shell } catch { }
  foreach ($p in @($Payload.paths)) {
    $p = [string]$p
    $row = @{ path = $p; ok = $false; kind = 'file' }
    try {
      if (-not (Test-Path -LiteralPath $p)) {
        $row.error = 'not found'
      } else {
        $ext = [IO.Path]::GetExtension($p).ToLower()
        if ($ext -eq '.lnk' -and $ws) {
          $lnk = $ws.CreateShortcut($p)
          $row.target = [string]$lnk.TargetPath
          $row.args = [string]$lnk.Arguments
          $row.workDir = [string]$lnk.WorkingDirectory
          $row.iconLocation = [string]$lnk.IconLocation
          $row.description = [string]$lnk.Description
          $row.kind = 'file'
          $row.ok = $true
        } elseif ($ext -eq '.url') {
          $txt = ConvertFrom-TextSmart -Path $p
          $m = [regex]::Match($txt, '(?im)^\s*URL\s*=\s*(.+)$')
          if ($m.Success) {
            $row.target = $m.Groups[1].Value.Trim()
            $row.kind = 'url'
            $row.ok = $true
          } else {
            $row.error = 'no url inside'
          }
          $im = [regex]::Match($txt, '(?im)^\s*IconFile\s*=\s*(.+)$')
          if ($im.Success) { $row.iconLocation = $im.Groups[1].Value.Trim() }
        } elseif ((Get-Item -LiteralPath $p -Force).PSIsContainer) {
          $row.target = $p
          $row.kind = 'folder'
          $row.ok = $true
        } else {
          $row.target = $p
          $row.kind = 'file'
          $row.ok = $true
        }
      }
    } catch {
      $row.error = $_.Exception.Message
    }
    [void]$items.Add($row)
  }
  return @{ items = $items }
}

function Invoke-KlIcons {
  param($Payload)
  $ok = Ensure-IconTypes
  $items = New-Object System.Collections.ArrayList
  foreach ($it in @($Payload.items)) {
    $p = [string]$it.path
    $row = @{ path = $p; ok = $false }
    try {
      if (-not $ok) { throw 'icon engine unavailable' }
      $cand = $p
      $idx = -1
      if ($null -ne $it.index) { $idx = [int]$it.index }
      if ($it.iconPath) {
        $cand = [string]$it.iconPath
        if ($null -ne $it.iconIndex) { $idx = [int]$it.iconIndex }
      }
      $bmp = [KlIcon]::Extract($cand, $idx)
      if ($null -ne $bmp -and $bmp.Width -gt 1) {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $row.png = [Convert]::ToBase64String($ms.ToArray())
        $row.w = $bmp.Width
        $row.h = $bmp.Height
        $row.ok = $true
        $ms.Dispose()
        $bmp.Dispose()
      } else {
        $row.error = 'no icon found'
      }
    } catch {
      $row.error = $_.Exception.Message
    }
    [void]$items.Add($row)
  }
  return @{ items = $items; engine = $ok }
}

function Get-AppLogoPath {
  param($Pkg)
  try {
    $manifest = Join-Path $Pkg.InstallLocation 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    $xml = New-Object System.Xml.XmlDocument
    $xml.Load($manifest)
    $nodes = $xml.SelectNodes('//*[local-name()="VisualElements"]')
    $logoRel = $null
    foreach ($n in $nodes) {
      foreach ($attr in @('Square44x44Logo', 'Square150x150Logo', 'Logo')) {
        $v = $n.GetAttribute($attr)
        if ($v) { $logoRel = $v; break }
      }
      if ($logoRel) { break }
    }
    if (-not $logoRel) { return $null }
    $dir = Join-Path $Pkg.InstallLocation ([IO.Path]::GetDirectoryName($logoRel))
    $bn = [IO.Path]::GetFileNameWithoutExtension($logoRel)
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $cands = @(Get-ChildItem -LiteralPath $dir -Filter ($bn + '*') -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -ieq '.png' })
    if ($cands.Count -eq 0) { return $null }
    $best = $null
    $bestSize = [double]::MinValue
    foreach ($c in $cands) {
      if ($c.Name -match 'contrast-(black|white)') { continue }
      $score = 0
      $m = [regex]::Match($c.Name, 'targetsize-(\d+)')
      if ($m.Success) { $score = [int]$m.Groups[1].Value }
      if ($c.Name -notmatch 'altform') { $score += 300 }
      elseif ($c.Name -match 'lightunplated') { $score += 100 }
      elseif ($c.Name -match 'unplated') { $score += 200 }
      if ($score -gt $bestSize) { $bestSize = $score; $best = $c }
    }
    if ($best) { return $best.FullName }
    return $cands[0].FullName
  } catch { }
  return $null
}

function Get-ExeDisplayName {
  param([string]$ExePath, [string]$Fallback)
  try {
    if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
      $vi = (Get-Item -LiteralPath $ExePath).VersionInfo
      if ($vi) {
        if ($vi.FileDescription) { return [string]$vi.FileDescription }
        if ($vi.ProductName) { return [string]$vi.ProductName }
      }
    }
  } catch { }
  if ($Fallback) { return $Fallback }
  if ($ExePath) { return [IO.Path]::GetFileNameWithoutExtension($ExePath) }
  return $null
}

function Invoke-KlApps {
  param($Payload)
  $items = New-Object System.Collections.ArrayList
  $sources = @($Payload.sources)
  if ($sources.Count -eq 0) { $sources = @('startmenu', 'startapps', 'registry') }
  # The exclusion filter is supplied by the JS side (preload.js) so that this
  # file can stay pure ASCII -- PowerShell 5.1 decodes BOM-less scripts as ANSI,
  # which would corrupt non-ASCII characters inside the regex.
  $filter = '(?i)(uninstall|help|readme|license|update|setup|install|website|homepage|documentation|manual|release|changelog|repair|configure)'
  if ($Payload.filter) { $filter = [string]$Payload.filter }
  $seen = @{}
  $ws = $null
  try { $ws = New-Object -ComObject WScript.Shell } catch { }

  if ($sources -contains 'startmenu') {
    $dirs = New-Object System.Collections.ArrayList
    if ($env:ProgramData) { [void]$dirs.Add((Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')) }
    if ($env:APPDATA) { [void]$dirs.Add((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')) }
    try { [void]$dirs.Add([Environment]::GetFolderPath('Desktop')) } catch { }
    if ($env:PUBLIC) { [void]$dirs.Add((Join-Path $env:PUBLIC 'Desktop')) }
    try { [void]$dirs.Add([Environment]::GetFolderPath('CommonStartMenu')) } catch { }

    $files = New-Object System.Collections.ArrayList
    foreach ($d in $dirs) {
      if (-not $d) { continue }
      if (-not (Test-Path -LiteralPath $d)) { continue }
      foreach ($f in @(Get-ChildItem -LiteralPath $d -Recurse -File -Filter '*.lnk' -ErrorAction SilentlyContinue)) { [void]$files.Add($f) }
      foreach ($f in @(Get-ChildItem -LiteralPath $d -Recurse -File -Filter '*.url' -ErrorAction SilentlyContinue)) { [void]$files.Add($f) }
    }
    foreach ($f in $files) {
      $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
      if (-not $name) { continue }
      if ($name -match $filter) { continue }
      $key = $name.ToLower()
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = 1
      $src = 'startmenu'
      if ($f.DirectoryName -match 'Desktop') { $src = 'desktop' }
      [void]$items.Add(@{
        name      = $name
        source    = $src
        kind      = 'file'
        target    = $f.FullName
        iconPath  = $f.FullName
        folder    = $f.DirectoryName
      })
    }
  }

  if ($sources -contains 'startapps') {
    $pkgMap = @{}
    try {
      foreach ($pkg in @(Get-AppxPackage -ErrorAction SilentlyContinue)) {
        if ($pkg.PackageFamilyName) { $pkgMap[$pkg.PackageFamilyName] = $pkg }
      }
    } catch { }
    $logoCache = @{}
    try {
      foreach ($a in @(Get-StartApps -ErrorAction SilentlyContinue)) {
        $name = [string]$a.Name
        if (-not $name) { continue }
        if ($name -match $filter) { continue }
        $key = $name.ToLower()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = 1
        $id = [string]$a.AppID
        $isUwp = $false
        $logo = $null
        if ($id -match '^([^!]+)!(.+)$') {
          $pfn = $Matches[1]
          if ($pkgMap.ContainsKey($pfn)) {
            $isUwp = $true
            if ($logoCache.ContainsKey($pfn)) {
              $logo = $logoCache[$pfn]
            } else {
              $logo = Get-AppLogoPath -Pkg $pkgMap[$pfn]
              $logoCache[$pfn] = $logo
            }
          }
        }
        $row = @{
          name   = $name
          source = 'startapps'
          kind   = 'appid'
          appId  = $id
          target = ('shell:AppsFolder\' + $id)
        }
        if ($isUwp) { $row.source = 'uwp' }
        if ($logo) { $row.iconFile = $logo }
        [void]$items.Add($row)
      }
    } catch { }
  }

  if ($sources -contains 'registry') {
    $roots = @(
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths',
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths'
    )
    foreach ($r in $roots) {
      if (-not (Test-Path $r)) { continue }
      foreach ($k in @(Get-ChildItem -Path $r -ErrorAction SilentlyContinue)) {
        try {
          $props = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
          if (-not $props) { continue }
          $exe = [string]$props.'(default)'
          if (-not $exe) { continue }
          $exe = $exe.Trim('"').Trim()
          if ($exe -notmatch '\.exe$') { continue }
          if (-not (Test-Path -LiteralPath $exe)) { continue }
          $name = Get-ExeDisplayName -ExePath $exe -Fallback ([IO.Path]::GetFileNameWithoutExtension($k.PSChildName))
          if (-not $name) { continue }
          if ($name -match $filter) { continue }
          $key = $name.ToLower()
          if ($seen.ContainsKey($key)) { continue }
          $seen[$key] = 1
          [void]$items.Add(@{
            name     = $name
            source   = 'registry'
            kind     = 'file'
            target   = $exe
            iconPath = $exe
          })
        } catch { }
      }
    }

    $unRoots = @(
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($r in $unRoots) {
      foreach ($k in @(Get-ItemProperty -Path $r -ErrorAction SilentlyContinue)) {
        try {
          if ($k.SystemComponent -eq 1) { continue }
          $name = [string]$k.DisplayName
          if (-not $name) { continue }
          if ($name -match $filter) { continue }
          $icon = [string]$k.DisplayIcon
          if (-not $icon) { continue }
          $icon = $icon.Trim('"')
          $exe = $null
          $m = [regex]::Match($icon, '"?([^"]+\.exe)"?')
          if ($m.Success) { $exe = $m.Groups[1].Value.Trim() }
          if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { continue }
          $key = $name.ToLower()
          if ($seen.ContainsKey($key)) { continue }
          $seen[$key] = 1
          [void]$items.Add(@{
            name     = $name
            source   = 'installed'
            kind     = 'file'
            target   = $exe
            iconPath = $exe
          })
        } catch { }
      }
    }
  }

  return @{ items = $items }
}

function Invoke-KlMode {
  param([string]$Name, $Payload)
  switch ($Name) {
    'ping' { return @{ items = @(); pong = $true; ps = $PSVersionTable.PSVersion.ToString() } }
    'resolve' { return Invoke-KlResolve -Payload $Payload }
    'icons' { return Invoke-KlIcons -Payload $Payload }
    'apps' { return Invoke-KlApps -Payload $Payload }
    default { throw ("unknown mode: " + $Name) }
  }
}

$JsonArgs = @{ Depth = 10; Compress = $true }

if ($Agent) {
  $stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
  $stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
  $stdout.AutoFlush = $true
  $stdout.WriteLine('{"ready":true}')
  while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $req = $null
    try { $req = $line | ConvertFrom-Json } catch {
      $stdout.WriteLine('{"id":0,"ok":false,"error":"bad request json"}')
      continue
    }
    if ([string]$req.mode -eq 'exit') { break }
    $resp = $null
    try {
      $data = Invoke-KlMode -Name ([string]$req.mode) -Payload $req.payload
      $resp = @{ id = $req.id; ok = $true; data = $data }
    } catch {
      $resp = @{ id = $req.id; ok = $false; error = $_.Exception.Message }
    }
    try {
      $json = ConvertTo-Json -InputObject $resp @JsonArgs
      $stdout.WriteLine($json)
    } catch {
      $stdout.WriteLine('{"id":' + $req.id + ',"ok":false,"error":"serialize failed"}')
    }
  }
  $stdout.Flush()
  exit 0
}

$payload = $null
if ($InFile -and (Test-Path -LiteralPath $InFile)) {
  $txt = [IO.File]::ReadAllText($InFile, $Utf8)
  if (-not [string]::IsNullOrWhiteSpace($txt)) {
    try { $payload = $txt | ConvertFrom-Json } catch { $payload = $null }
  }
}
$response = $null
try {
  $data = Invoke-KlMode -Name $Mode -Payload $payload
  $response = @{ id = 'once'; ok = $true; data = $data }
} catch {
  $response = @{ id = 'once'; ok = $false; error = $_.Exception.Message; trace = $_.ScriptStackTrace }
}
$json = ConvertTo-Json -InputObject $response @JsonArgs
if ($OutFile) {
  [IO.File]::WriteAllText($OutFile, $json, $Utf8)
} else {
  [Console]::Out.Write($json)
}
exit 0
