# =============================================================================
# OFFLINE MODE — LOCAL TEST RIG
#
# Runs both halves of the offline architecture on this machine:
#
#   CLOUD node (port 4400) --> the TEST Neon branch
#   EDGE  node (port 4401) --> local SQLite, syncs to the cloud node over HTTP
#
# Your real .env is never read and never modified. Everything comes from
# .env.offline-test.
#
#   .\scripts\offline-test.ps1 provision   # build the till's mirror (do first)
#   .\scripts\offline-test.ps1 start       # start both nodes
#   .\scripts\offline-test.ps1 offline     # CUT the link - till keeps selling
#   .\scripts\offline-test.ps1 online      # restore the link
#   .\scripts\offline-test.ps1 sync        # run the night sync, drain the queue
#   .\scripts\offline-test.ps1 status      # queue depth, connectivity
#   .\scripts\offline-test.ps1 verify      # compare till vs cloud
#   .\scripts\offline-test.ps1 stop        # stop both nodes
#   .\scripts\offline-test.ps1 reset       # wipe the till mirror, start over
# =============================================================================

param(
    [Parameter(Position = 0)]
    [ValidateSet("provision", "start", "stop", "offline", "online", "sync", "status", "verify", "reset", "logs", "start-cloud-only")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$ServerDir = Split-Path -Parent $PSScriptRoot
Set-Location $ServerDir

# ── Load .env.offline-test ───────────────────────────────────────────────────
$EnvFile = Join-Path $ServerDir ".env.offline-test"
if (-not (Test-Path $EnvFile)) {
    Write-Host "X .env.offline-test not found at $EnvFile" -ForegroundColor Red
    exit 1
}

$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $k, $v = $line -split '=', 2
    $cfg[$k.Trim()] = $v.Trim().Trim('"')
}

$CloudPort = $cfg["CLOUD_PORT"]
$EdgePort = $cfg["EDGE_PORT"]
$TillDb = $cfg["LOCAL_DATABASE_PATH"]
$DeviceId = $cfg["OFFLINE_DEVICE_ID"]
$Secret = $cfg["SYNC_DEVICE_SECRET"]
$CloudDb = $cfg["TEST_DATABASE_URL"]
$CloudUrl = "http://localhost:$CloudPort"

$LogDir = Join-Path $ServerDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$CloudLog = Join-Path $LogDir "offline-test-cloud.log"
$EdgeLog = Join-Path $LogDir "offline-test-edge.log"

# A guard, not a formality: pointing this rig at production would upload test
# sales into the real books. The test branch is 'lingering-bonus'.
if ($CloudDb -match "frosty-moon") {
    Write-Host "X TEST_DATABASE_URL points at PRODUCTION. Refusing." -ForegroundColor Red
    exit 1
}

function Get-PortPid([string]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { return $conn.OwningProcess } else { return $null }
}

function Stop-Node([string]$Port, [string]$Name) {
    $procId = Get-PortPid $Port
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "  stopped $Name (pid $procId)" -ForegroundColor DarkGray
    }
}

function Wait-ForPort([string]$Port, [int]$TimeoutSec = 90) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        if (Get-PortPid $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

# The operator endpoints (/status, /run) sit behind the NORMAL staff auth
# middleware, not the HMAC device signature - only /download and /upload are
# machine-to-machine. So this logs in as staff and uses the JWT, which is
# exactly what the "Sync Now" button in the UI does.
$script:Token = $null

function Get-StaffToken() {
    if ($script:Token) { return $script:Token }
    $creds = @{
        email    = $cfg["TEST_LOGIN_EMAIL"]
        password = $cfg["TEST_LOGIN_PASSWORD"]
    } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$EdgePort/api/v1/auth/login" `
            -Method POST -Body $creds -ContentType "application/json"
        $script:Token = $r.data.accessToken
        if (-not $script:Token) { $script:Token = $r.data.token }
        return $script:Token
    }
    catch {
        Write-Host "X Could not log in as $($cfg["TEST_LOGIN_EMAIL"])." -ForegroundColor Red
        Write-Host "  Set TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD in .env.offline-test" -ForegroundColor Yellow
        throw
    }
}

function Invoke-Sync([string]$Path, [string]$Method = "GET", [string]$Body = "") {
    $token = Get-StaffToken
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }
    $uri = "http://localhost:$EdgePort$Path"
    if ($Method -eq "GET") {
        return Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    }
    return Invoke-RestMethod -Uri $uri -Headers $headers -Method $Method -Body $Body
}

switch ($Command) {

    "provision" {
        Write-Host "`n=== PROVISION THE TILL ===" -ForegroundColor Cyan
        Write-Host "Builds a fresh, verified SQLite mirror from the test cloud.`n"

        if (-not (Get-PortPid $CloudPort)) {
            Write-Host "Cloud node is not running. Starting it first..." -ForegroundColor Yellow
            & $PSCommandPath start-cloud-only
            if (-not (Wait-ForPort $CloudPort)) {
                Write-Host "X cloud node did not come up. See $CloudLog" -ForegroundColor Red
                exit 1
            }
        }

        $env:OFFLINE_MODE_ENABLED = "true"
        $env:OFFLINE_ROLE = "edge"
        $env:OFFLINE_DEVICE_ID = $DeviceId
        $env:SYNC_CLOUD_URL = $CloudUrl
        $env:SYNC_DEVICE_SECRET = $Secret
        $env:LOCAL_DATABASE_PATH = $TillDb
        # A real till holds no cloud credentials. Removing it here means the
        # provisioner exercises the same path a real till would.
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue

        npx tsx scripts/provision-till.ts --verify-against-cloud
        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nX Provisioning failed. The mirror was rejected, not handed over." -ForegroundColor Red
            exit 1
        }
        Write-Host "`nNext:  .\scripts\offline-test.ps1 start" -ForegroundColor Green
    }

    "start-cloud-only" {
        Stop-Node $CloudPort "cloud"
        $cloudCmd = @"
`$env:PORT='$CloudPort'
`$env:OFFLINE_MODE_ENABLED='true'
`$env:OFFLINE_ROLE='cloud'
`$env:SYNC_DEVICE_SECRET='$Secret'
`$env:DATABASE_URL='$CloudDb'
Set-Location '$ServerDir'
npx tsx src/server.ts *>&1 | Tee-Object -FilePath '$CloudLog'
"@
        Start-Process powershell -ArgumentList "-NoProfile", "-Command", $cloudCmd -WindowStyle Hidden
    }

    "start" {
        Write-Host "`n=== START BOTH NODES ===" -ForegroundColor Cyan

        if (-not (Test-Path $TillDb)) {
            Write-Host "X No till mirror at $TillDb" -ForegroundColor Red
            Write-Host "  Run:  .\scripts\offline-test.ps1 provision" -ForegroundColor Yellow
            exit 1
        }

        & $PSCommandPath start-cloud-only
        Write-Host "  cloud starting on $CloudPort ..." -NoNewline
        if (Wait-ForPort $CloudPort) { Write-Host " up" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $CloudLog"; exit 1 }

        Stop-Node $EdgePort "edge"
        $edgeCmd = @"
`$env:PORT='$EdgePort'
`$env:OFFLINE_MODE_ENABLED='true'
`$env:OFFLINE_ROLE='edge'
`$env:OFFLINE_DEVICE_ID='$DeviceId'
`$env:SYNC_CLOUD_URL='$CloudUrl'
`$env:SYNC_DEVICE_SECRET='$Secret'
`$env:LOCAL_DATABASE_PATH='$TillDb'
`$env:SYNC_AUTO_ENABLED='$($cfg["SYNC_AUTO_ENABLED"])'
`$env:SYNC_PROBE_INTERVAL_MS='$($cfg["SYNC_PROBE_INTERVAL_MS"])'
Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
Set-Location '$ServerDir'
npx tsx src/server.ts *>&1 | Tee-Object -FilePath '$EdgeLog'
"@
        Start-Process powershell -ArgumentList "-NoProfile", "-Command", $edgeCmd -WindowStyle Hidden
        Write-Host "  edge  starting on $EdgePort ..." -NoNewline
        if (Wait-ForPort $EdgePort) { Write-Host " up" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $EdgeLog"; exit 1 }

        Write-Host "`n  THE TILL (use this one):  http://localhost:$EdgePort" -ForegroundColor Green
        Write-Host "  cloud/head office:        http://localhost:$CloudPort" -ForegroundColor DarkGray
        Write-Host "`n  Log in as cashier@cexpos.local" -ForegroundColor Cyan
        Write-Host "  Then:  .\scripts\offline-test.ps1 offline`n"
    }

    "stop" {
        Write-Host "`n=== STOP ===" -ForegroundColor Cyan
        Stop-Node $EdgePort "edge"
        Stop-Node $CloudPort "cloud"
        Write-Host "  both stopped.`n" -ForegroundColor Green
    }

    "offline" {
        Write-Host "`n=== GO OFFLINE ===" -ForegroundColor Yellow
        Stop-Node $CloudPort "cloud"
        Write-Host @"

  The cloud is now unreachable - the same as the shop's router dying.

  The till at http://localhost:$EdgePort keeps working. Go and sell:
    - scan barcodes, take payments, print receipts
    - create customers, process returns
    - watch the sync indicator say the queue is growing

  Nothing you do now reaches the cloud until you run 'sync'.

  When done:   .\scripts\offline-test.ps1 online
"@ -ForegroundColor Green
    }

    "online" {
        Write-Host "`n=== BACK ONLINE ===" -ForegroundColor Cyan
        & $PSCommandPath start-cloud-only
        Write-Host "  cloud restarting ..." -NoNewline
        if (Wait-ForPort $CloudPort) { Write-Host " up" -ForegroundColor Green }
        else { Write-Host " FAILED"; exit 1 }
        Write-Host "`n  The link is back. The queue has NOT drained yet."
        Write-Host "  Run the night sync:  .\scripts\offline-test.ps1 sync`n"
    }

    "sync" {
        Write-Host "`n=== NIGHT SYNC ===" -ForegroundColor Cyan
        if (-not (Get-PortPid $CloudPort)) {
            Write-Host "X Cloud is down. Run 'online' first." -ForegroundColor Red
            exit 1
        }
        Write-Host "  Uploading, then downloading. At ~570ms/item this is not instant.`n"
        $body = '{"direction":"FULL"}'
        try {
            $r = Invoke-Sync "/api/v1/sync/run" "POST" $body
            $r | ConvertTo-Json -Depth 6
        }
        catch {
            Write-Host "X sync failed: $_" -ForegroundColor Red
            Write-Host "  Check the edge log: $EdgeLog" -ForegroundColor Yellow
            exit 1
        }
        Write-Host "`n  Now verify:  .\scripts\offline-test.ps1 verify`n"
    }

    "status" {
        Write-Host "`n=== STATUS ===" -ForegroundColor Cyan
        $cloudPid = Get-PortPid $CloudPort
        $edgePid = Get-PortPid $EdgePort
        if ($cloudPid) { Write-Host "  cloud  UP    port $CloudPort (pid $cloudPid)" -ForegroundColor Green }
        else { Write-Host "  cloud  DOWN  port $CloudPort  <- offline mode" -ForegroundColor Yellow }
        if ($edgePid) { Write-Host "  edge   UP    port $EdgePort (pid $edgePid)" -ForegroundColor Green }
        else { Write-Host "  edge   DOWN  port $EdgePort" -ForegroundColor Red }

        if (Test-Path $TillDb) {
            $size = [math]::Round((Get-Item $TillDb).Length / 1MB, 2)
            Write-Host "  mirror $TillDb ($size MB)" -ForegroundColor DarkGray
        }
        else {
            Write-Host "  mirror MISSING - run 'provision'" -ForegroundColor Red
        }

        if ($edgePid) {
            try {
                $s = Invoke-Sync "/api/v1/sync/status"
                Write-Host "`n  QUEUE" -ForegroundColor Cyan
                Write-Host "    pending      : $($s.data.queue.pending)"
                Write-Host "    in-flight    : $($s.data.queue.inFlight)"
                Write-Host "    synced       : $($s.data.queue.synced)"
                Write-Host "    failed       : $($s.data.queue.failed)"
                Write-Host "    oldest age   : $($s.data.queue.oldestPendingAgeSeconds)s"
                Write-Host "    connectivity : $($s.data.connectivity.state)"
            }
            catch {
                Write-Host "`n  (status endpoint unavailable: $_)" -ForegroundColor DarkGray
            }
        }
        Write-Host ""
    }

    "verify" {
        Write-Host "`n=== VERIFY: TILL vs CLOUD ===" -ForegroundColor Cyan
        $env:TEST_DATABASE_URL = $CloudDb
        $env:LOCAL_DATABASE_PATH = $TillDb
        npx tsx scripts/offline-test-verify.ts
    }

    "reset" {
        Write-Host "`n=== RESET ===" -ForegroundColor Yellow
        Write-Host "Deletes the till mirror. Un-uploaded sales in it are LOST." -ForegroundColor Red
        $ans = Read-Host "Type 'yes' to continue"
        if ($ans -ne "yes") { Write-Host "  cancelled."; exit 0 }
        Stop-Node $EdgePort "edge"
        Remove-Item "$TillDb*" -Force -ErrorAction SilentlyContinue
        Write-Host "  mirror deleted. Run 'provision' to rebuild.`n" -ForegroundColor Green
    }

    "logs" {
        Write-Host "`n--- EDGE (till) ---" -ForegroundColor Cyan
        if (Test-Path $EdgeLog) { Get-Content $EdgeLog -Tail 30 }
        Write-Host "`n--- CLOUD ---" -ForegroundColor Cyan
        if (Test-Path $CloudLog) { Get-Content $CloudLog -Tail 20 }
    }
}
