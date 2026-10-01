<#
.SYNOPSIS
    Read-only Windows security diagnostics with logging.

.DESCRIPTION
    Reports the status of Windows Security, Defender, firewall, TPM, and
    Secure Boot WITHOUT changing them. Flags conflicts and blocked apps,
    checks for Vanguard / FACEIT Anti-Cheat and a named overlay, and writes
    a timestamped log.

    Nothing is disabled or modified by default. The only state-changing
    action is an OPTIONAL uninstall of an anti-cheat, which requires an
    explicit -AllowUninstall switch AND an interactive confirmation.

.PARAMETER OverlayName
    Display-name substring of the overlay to verify (e.g. installed per an
    official guide). Defaults to "Overlay".

.PARAMETER OverlayProcess
    Process name (without .exe) expected to be running for the overlay.

.PARAMETER AllowUninstall
    Opt-in. When present, offers an interactive, confirmed uninstall of any
    detected anti-cheat. Without it, anti-cheats are only reported.

.PARAMETER LogPath
    Where to write the log. Defaults to the user's Desktop.

.EXAMPLE
    .\Invoke-SecurityDiagnostics.ps1

.EXAMPLE
    .\Invoke-SecurityDiagnostics.ps1 -OverlayName "MyOverlay" -OverlayProcess "myoverlay" -AllowUninstall
#>
[CmdletBinding()]
param(
    [string]$OverlayName = "Overlay",
    [string]$OverlayProcess = "",
    [switch]$AllowUninstall,
    [string]$LogPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) "SecurityDiagnostics_$(Get-Date -Format yyyyMMdd_HHmmss).log")
)

# ---------- logging helpers ----------
$script:Log = New-Object System.Collections.Generic.List[string]

function Write-Section($title) {
    $line = "`n===== $title ====="
    Write-Host $line -ForegroundColor Cyan
    $script:Log.Add($line)
}

function Write-Item($label, $value, $color = "Gray") {
    $text = "  {0,-28} {1}" -f $label, $value
    Write-Host $text -ForegroundColor $color
    $script:Log.Add($text)
}

function Write-Note($text, $color = "Yellow") {
    Write-Host "  ! $text" -ForegroundColor $color
    $script:Log.Add("  ! $text")
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---------- 1. Windows Security / Defender ----------
function Get-DefenderStatus {
    Write-Section "Windows Security / Defender (read-only)"
    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        Write-Item "Antivirus enabled"        $mp.AntivirusEnabled            ($mp.AntivirusEnabled        ? "Green" : "Red")
        Write-Item "Real-time protection"      $mp.RealTimeProtectionEnabled   ($mp.RealTimeProtectionEnabled ? "Green" : "Red")
        Write-Item "Behavior monitor"          $mp.BehaviorMonitorEnabled
        Write-Item "Tamper protection"         $mp.IsTamperProtected
        Write-Item "Signature age (days)"      $mp.AntivirusSignatureAge
        Write-Item "Last quick scan"           $mp.QuickScanEndTime
    } catch {
        Write-Note "Could not query Defender: $($_.Exception.Message)"
    }

    try {
        $pref = Get-MpPreference -ErrorAction Stop
        if ($pref.ExclusionPath) {
            Write-Note "Defender has path exclusions (review these):"
            foreach ($p in $pref.ExclusionPath) { Write-Item "  excluded path" $p "DarkYellow" }
        }
        if ($pref.ExclusionProcess) {
            foreach ($p in $pref.ExclusionProcess) { Write-Item "  excluded process" $p "DarkYellow" }
        }
    } catch { }
}

# ---------- 2. Third-party AV / conflicts ----------
function Get-AntivirusProducts {
    Write-Section "Registered security products (conflict check)"
    try {
        $avs = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop
        if (-not $avs) { Write-Item "AV products" "none registered"; return }
        foreach ($av in $avs) {
            Write-Item "Product" $av.displayName
        }
        if ($avs.Count -gt 1) {
            Write-Note "Multiple AV products registered - possible conflict."
        }
    } catch {
        Write-Note "SecurityCenter2 query failed (normal on Server SKUs): $($_.Exception.Message)"
    }
}

# ---------- 3. Firewall ----------
function Get-FirewallStatus {
    Write-Section "Windows Firewall (read-only)"
    try {
        foreach ($p in Get-NetFirewallProfile -ErrorAction Stop) {
            Write-Item "$($p.Name) profile" ($p.Enabled ? "Enabled" : "DISABLED") ($p.Enabled ? "Green" : "Red")
        }
    } catch {
        Write-Note "Could not query firewall: $($_.Exception.Message)"
    }
}

# ---------- 4. TPM ----------
function Get-TpmStatus {
    Write-Section "TPM (read-only)"
    try {
        $tpm = Get-Tpm -ErrorAction Stop
        Write-Item "TPM present"   $tpm.TpmPresent  ($tpm.TpmPresent  ? "Green" : "Red")
        Write-Item "TPM ready"     $tpm.TpmReady    ($tpm.TpmReady    ? "Green" : "Red")
        Write-Item "TPM enabled"   $tpm.TpmEnabled
    } catch {
        Write-Note "Could not query TPM (needs admin): $($_.Exception.Message)"
    }
}

# ---------- 5. Secure Boot ----------
function Get-SecureBootStatus {
    Write-Section "Secure Boot (read-only)"
    try {
        $sb = Confirm-SecureBootUEFI -ErrorAction Stop
        Write-Item "Secure Boot enabled" $sb ($sb ? "Green" : "Red")
    } catch {
        Write-Note "Secure Boot not readable (legacy BIOS or needs admin): $($_.Exception.Message)"
    }
}

# ---------- 6. BitLocker / encryption ----------
function Get-EncryptionStatus {
    Write-Section "Disk encryption / BitLocker (read-only)"
    try {
        $vols = Get-BitLockerVolume -ErrorAction Stop
        foreach ($v in $vols) {
            Write-Item "$($v.MountPoint) protection" $v.ProtectionStatus ($v.ProtectionStatus -eq 'On' ? "Green" : "Yellow")
        }
    } catch {
        Write-Note "BitLocker not available / not readable: $($_.Exception.Message)"
    }
}

# ---------- 7. Blocked apps (SmartScreen / WDAC / recent blocks) ----------
function Get-BlockedApps {
    Write-Section "Blocked-app / policy indicators"
    try {
        $ss = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -Name SmartScreenEnabled -ErrorAction SilentlyContinue
        if ($ss) { Write-Item "SmartScreen (Explorer)" $ss.SmartScreenEnabled }
    } catch { }
    try {
        $blocks = Get-WinEvent -FilterHashtable @{
            LogName = 'Microsoft-Windows-SmartScreen/Debug'
        } -MaxEvents 5 -ErrorAction SilentlyContinue
        if ($blocks) {
            Write-Note "Recent SmartScreen events found (review in Event Viewer)."
        } else {
            Write-Item "Recent SmartScreen blocks" "none found"
        }
    } catch {
        Write-Item "SmartScreen event log" "not accessible"
    }
}

# ---------- 8. Anti-cheat detection (+ optional confirmed uninstall) ----------
function Get-InstalledPrograms {
    $roots = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    Get-ItemProperty $roots -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object DisplayName, UninstallString, QuietUninstallString
}

function Get-AntiCheatStatus {
    param([switch]$AllowUninstall)
    Write-Section "Anti-cheat detection"

    $programs = Get-InstalledPrograms
    $targets = @(
        @{ Name = "Riot Vanguard";        Match = "Vanguard";  Service = "vgc";          Driver = "vgk" }
        @{ Name = "FACEIT Anti-Cheat";    Match = "FACEIT";    Service = "FACEIT";       Driver = "" }
    )

    foreach ($t in $targets) {
        $inst = $programs | Where-Object { $_.DisplayName -match $t.Match }
        $svc  = if ($t.Service) { Get-Service -Name $t.Service -ErrorAction SilentlyContinue } else { $null }

        $found = [bool]$inst -or [bool]$svc
        Write-Item $t.Name ($found ? "INSTALLED" : "not found") ($found ? "Yellow" : "Green")
        if ($svc) { Write-Item "  service $($t.Service)" $svc.Status }

        if ($found -and $AllowUninstall) {
            Invoke-ConfirmedUninstall -Name $t.Name -Entries $inst
        } elseif ($found) {
            Write-Note "To remove $($t.Name), re-run with -AllowUninstall (you will be asked to confirm)."
        }
    }
}

function Invoke-ConfirmedUninstall {
    param([string]$Name, $Entries)

    if (-not (Test-Admin)) {
        Write-Note "Uninstall of $Name needs an elevated (admin) PowerShell. Skipping."
        return
    }
    if (-not $Entries) {
        Write-Note "No uninstall entry found for $Name (may need vendor tool / Settings app)."
        return
    }

    $answer = Read-Host "Uninstall $Name now? Type the exact word YES to proceed"
    if ($answer -cne "YES") {
        Write-Note "Skipped uninstall of $Name (not confirmed)."
        return
    }

    foreach ($e in $Entries) {
        $cmd = if ($e.QuietUninstallString) { $e.QuietUninstallString } else { $e.UninstallString }
        if (-not $cmd) { Write-Note "No uninstall string for $($e.DisplayName)."; continue }
        Write-Item "Running uninstall" $e.DisplayName "Magenta"
        $script:Log.Add("  CMD: $cmd")
        try {
            cmd.exe /c $cmd | Out-Null
            Write-Item "  uninstall exit" $LASTEXITCODE
        } catch {
            Write-Note "Uninstall error: $($_.Exception.Message)"
        }
    }
}

# ---------- 9. Overlay verification ----------
function Get-OverlayStatus {
    param([string]$Name, [string]$ProcessName)
    Write-Section "Overlay verification"

    $inst = Get-InstalledPrograms | Where-Object { $_.DisplayName -match [regex]::Escape($Name) }
    Write-Item "$Name installed" ($inst ? "yes ($($inst[0].DisplayName))" : "NOT installed") ($inst ? "Green" : "Red")

    if ($ProcessName) {
        $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
        Write-Item "$ProcessName running" ($proc ? "yes (PID $($proc[0].Id))" : "NOT running") ($proc ? "Green" : "Red")
        if (-not $proc) {
            Write-Note "Overlay process not running. Start it per the official guide, then re-run this check."
        }
    } else {
        Write-Note "No -OverlayProcess given; cannot confirm it is running. Pass the process name to verify."
    }
}

# ---------- main ----------
Write-Host ""
Write-Host "  Windows Security Diagnostics (read-only)" -ForegroundColor White
Write-Host "  Admin session: $(Test-Admin)" -ForegroundColor DarkGray
$script:Log.Add("Windows Security Diagnostics - $(Get-Date)")
$script:Log.Add("Admin: $(Test-Admin)  Host: $env:COMPUTERNAME  User: $env:USERNAME")

if (-not (Test-Admin)) {
    Write-Note "Some checks (TPM, Secure Boot, uninstall) need an elevated PowerShell for full results."
}

Get-DefenderStatus
Get-AntivirusProducts
Get-FirewallStatus
Get-TpmStatus
Get-SecureBootStatus
Get-EncryptionStatus
Get-BlockedApps
Get-AntiCheatStatus -AllowUninstall:$AllowUninstall
Get-OverlayStatus -Name $OverlayName -ProcessName $OverlayProcess

Write-Section "Summary"
Write-Item "Settings changed by this tool" ($AllowUninstall ? "only confirmed uninstalls" : "none (read-only)") "Green"
Write-Note "Hello, encryption, Defender, TPM, and Secure Boot were NOT modified." "Green"

try {
    $script:Log | Set-Content -Path $LogPath -Encoding UTF8
    Write-Host "`n  Log written to: $LogPath" -ForegroundColor Cyan
} catch {
    Write-Host "`n  Could not write log: $($_.Exception.Message)" -ForegroundColor Red
}
