$ErrorActionPreference = 'Stop'

$taskName = 'TWOIMO AI Usage Card'
$installDir = Join-Path $env:LOCALAPPDATA 'twoimo-ai-usage-card'
$scriptPath = Join-Path $installDir 'ai-usage-card.mjs'
$runnerPath = Join-Path $installDir 'run-ai-usage-card.ps1'
$logPath = Join-Path $installDir 'ai-usage-card.log'
$scriptUrl = 'https://raw.githubusercontent.com/twoimo/twoimo/main/scripts/ai-usage-card.mjs'

Write-Host 'Installing TWOIMO AI Coding Usage Card...' -ForegroundColor Cyan

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$gh = (Get-Command gh.exe -ErrorAction Stop).Source

& $gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Run: gh auth login'
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl -OutFile $scriptPath

function ConvertTo-SingleQuotedPowerShellLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

$nodeLiteral = ConvertTo-SingleQuotedPowerShellLiteral $node
$npxLiteral = ConvertTo-SingleQuotedPowerShellLiteral $npx
$ghLiteral = ConvertTo-SingleQuotedPowerShellLiteral $gh
$scriptLiteral = ConvertTo-SingleQuotedPowerShellLiteral $scriptPath
$logLiteral = ConvertTo-SingleQuotedPowerShellLiteral $logPath

$runner = @"
`$ErrorActionPreference = 'Stop'
`$env:USAGE_CARD_REPO = 'twoimo/twoimo'
`$env:NPX_PATH = $npxLiteral
`$env:GH_PATH = $ghLiteral
& $nodeLiteral $scriptLiteral *>> $logLiteral
"@
Set-Content -Path $runnerPath -Value $runner -Encoding UTF8

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At '09:37'
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Refreshes the self-hosted AI coding usage SVG on the twoimo GitHub profile.' `
    -Force | Out-Null

Write-Host 'Running the first sync now...' -ForegroundColor Cyan
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $runnerPath
if ($LASTEXITCODE -ne 0) {
    throw "The scheduled task was installed, but the first sync failed. Review: $logPath"
}

Write-Host ''
Write-Host 'Installed successfully.' -ForegroundColor Green
Write-Host "Task: $taskName"
Write-Host "Schedule: daily at 09:37 (runs later if the PC was off)"
Write-Host "Log: $logPath"
Write-Host 'GitHub image caching can take a few minutes after the first sync.'
