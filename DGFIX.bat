@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ============================================================
rem DGFIX.bat
rem Writes DGFIX.ps1 next to this file, then runs it elevated.
rem The PS1 runs Microsoft's DG Readiness Tool with -Disable to
rem turn off Device Guard, Credential Guard and HVCI.
rem ============================================================

set "PS1=%~dp0DGFIX.ps1"

rem ---- Write the PowerShell script (literal, no expansion) ----
>"%PS1%" (
echo #Requires -Version 5.1
echo [CmdletBinding^(^)]
echo param^(^)
echo $ErrorActionPreference = 'Stop'
echo $transcribing = $false
echo try {
echo     $principal = New-Object Security.Principal.WindowsPrincipal^([Security.Principal.WindowsIdentity]::GetCurrent^(^)^)
echo     $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
echo     if ^(-not $principal.IsInRole^([Security.Principal.WindowsBuiltInRole]::Administrator^)^) {
echo         Write-Host 'Approve the Windows administrator prompt to continue.'
echo         $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
echo         $elevated = Start-Process -FilePath $powershell -Verb RunAs -ArgumentList $arguments -Wait -PassThru
echo         if ^($elevated.ExitCode -ne 0^) { throw "Administrator process exited with code $^($elevated.ExitCode^)." }
echo         return
echo     }
echo     $work = Join-Path $env:LOCALAPPDATA ^('DGFIX\Run-' + ^(Get-Date -Format 'yyyyMMdd-HHmmss'^) + '-' + [guid]::NewGuid^(^).ToString^('N'^).Substring^(0,8^)^)
echo     New-Item -ItemType Directory -Path $work -Force ^| Out-Null
echo     $log = Join-Path $work 'DGFIX-log.txt'
echo     Start-Transcript -Path $log -Force ^| Out-Null
echo     $transcribing = $true
echo     Write-Host 'DG Readiness Tool Fix' -ForegroundColor Cyan
echo     Write-Host 'This runs the Microsoft tool to disable Device Guard, Credential Guard and HVCI.'
echo     Write-Host "Logs and downloaded files: $work"
echo     $zip = Join-Path $work 'dgreadiness.zip'
echo     $extract = Join-Path $work 'Tool'
echo     [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
echo     $ProgressPreference = 'SilentlyContinue'
echo     Write-Host '[1/3] Downloading Microsoft tool...'
echo     Invoke-WebRequest -Uri 'https://download.microsoft.com/download/b/d/8/bd821b1f-05f2-4a7e-aa03-df6c4f687b07/dgreadiness_v3.6.zip' -OutFile $zip -UseBasicParsing -TimeoutSec 120
echo     Write-Host '[2/3] Extracting...'
echo     Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
echo     $candidates = @^(Get-ChildItem -LiteralPath $extract -Filter '*.ps1' -Recurse ^| Where-Object { $_.Name -match 'DG_Readiness' }^)
echo     if ^($candidates.Count -ne 1^) { throw "Expected one DG Readiness script; found $^($candidates.Count^). Files retained at $extract" }
echo     $tool = $candidates[0]
echo     Write-Host '[3/3] Running Microsoft tool -Disable...'
echo     $stdout = Join-Path $work 'Microsoft-tool-output.txt'
echo     $stderr = Join-Path $work 'Microsoft-tool-errors.txt'
echo     $argsForTool = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Disable' -f $tool.FullName
echo     $process = Start-Process -FilePath $powershell -ArgumentList $argsForTool -WorkingDirectory $tool.DirectoryName -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
echo     if ^(Test-Path $stdout^) { Get-Content $stdout ^| ForEach-Object { Write-Host $_ } }
echo     if ^(Test-Path $stderr^) { Get-Content $stderr ^| ForEach-Object { Write-Host $_ -ForegroundColor Yellow } }
echo     if ^($process.ExitCode -ne 0^) { throw "Microsoft tool returned code $^($process.ExitCode^). Review the logs above; completion is not confirmed." }
echo     if ^(^(Get-Item $stderr^).Length -gt 0^) { throw 'Microsoft tool wrote errors. Review Microsoft-tool-errors.txt; completion is not confirmed.' }
echo     Write-Host 'Microsoft tool exited with code 0. Restart manually, then verify the Windows security status.' -ForegroundColor Green
echo     Write-Host 'Follow any on-screen firmware confirmation instructions shown during restart.' -ForegroundColor Yellow
echo     Write-Host 'An exit code alone does not confirm that the protections are disabled.'
echo } catch {
echo     Write-Host "`n[ERROR] $^($_.Exception.Message^)" -ForegroundColor Red
echo     Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
echo     if ^($work^) { Write-Host "Keep the files in: $work" }
echo } finally {
echo     if ^($transcribing^) { Stop-Transcript -ErrorAction SilentlyContinue ^| Out-Null }
echo     Read-Host "`nPress Enter to close this window" ^| Out-Null
echo }
)

if not exist "%PS1%" (
    echo Failed to write DGFIX.ps1
    pause
    exit /b 1
)

echo Wrote "%PS1%"
echo Launching PowerShell (you will see a UAC administrator prompt)...
echo.

rem ---- Run the PS1; it self-elevates via UAC ----
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

echo.
echo If an error appeared, take a screenshot before closing.
pause
endlocal
