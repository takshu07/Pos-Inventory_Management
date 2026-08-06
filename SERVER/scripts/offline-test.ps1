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
#   .\scripts\offline-test.ps1 provision          # build the till's mirror (do first)
#   .\scripts\offline-test.ps1 provision -Force   # ... rebuilding an existing one
#   .\scripts\offline-test.ps1 start              # start both nodes
#   .\scripts\offline-test.ps1 offline            # CUT the link - till keeps selling
#   .\scripts\offline-test.ps1 online             # restore the link
#   .\scripts\offline-test.ps1 sync               # run the night sync, drain the queue
#   .\scripts\offline-test.ps1 status             # queue depth, connectivity
#   .\scripts\offline-test.ps1 verify             # compare till vs cloud
#   .\scripts\offline-test.ps1 stop               # stop both nodes
#   .\scripts\offline-test.ps1 reset              # wipe the till mirror, start over
#
# ── Two properties this script guarantees ────────────────────────────────────
# 1. It never sets a variable in YOUR shell. Everything that needs rig env vars
#    runs in a child powershell (Invoke-InRigEnv), so `npm run dev` in the same
#    terminal afterwards is unaffected. See the note above Invoke-InRigEnv.
# 2. It waits for the test Neon branch to actually wake before anything depends
#    on it, so a suspended branch is a bounded wait instead of a hard failure.
#
# Docs: docs/OFFLINE_LOCAL_TEST_RIG.md
# =============================================================================

param(
    [Parameter(Position = 0)]
    [ValidateSet("provision", "start", "stop", "offline", "online", "sync", "status", "verify", "reset", "logs", "start-cloud-only")]
    [string]$Command = "status",

    # Rebuild the mirror even though one already exists.
    #
    # The provisioner refuses to destroy a populated mirror unless the operator
    # states it out loud, which is right for a real till and wrong for a rig that
    # must be re-runnable. -Force passes that confirmation through.
    #
    # It is NOT a way around the blocking checks: the refusal that matters — a
    # queue holding un-uploaded sales — has no override at any level, so -Force
    # on a till with unsent money still stops. It only answers "yes, this test
    # mirror is meant to be rebuilt".
    [switch]$Force
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

# ── Environment isolation ────────────────────────────────────────────────────
# Nothing in this script may set a variable in YOUR shell. `dotenv` does not
# overwrite a variable that is already set, so a single `$env:OFFLINE_ROLE='edge'`
# left behind here outlives the rig: the next `npm run dev` in the same terminal
# reads it, resolves as an edge till, and serves your normal dev server from the
# test SQLite mirror — with .env's DATABASE_URL silently ignored. The provision
# path made it worse by REMOVING DATABASE_URL, so dev then booted with no
# database at all. Both looked like application bugs and neither was.
#
# So every command that needs rig variables runs in a CHILD powershell, whose
# environment dies with it. The parent shell you typed into is never touched.
function Invoke-InRigEnv {
    # NOTE: the hashtable parameter is deliberately NOT named $Env. `$Env` is
    # PowerShell's automatic drive variable, and shadowing it inside a function
    # that also writes `Env:\...` paths makes the parser mis-associate the
    # function's own braces — the whole file then fails to parse with a
    # misleading "missing closing }" pointing at the switch, 150 lines away.
    param(
        [Parameter(Mandatory)][hashtable]$Vars,
        [Parameter(Mandatory)][string]$Command
    )

    $lines = foreach ($entry in ($Vars.GetEnumerator() | Sort-Object Name)) {
        $name = $entry.Name
        if ($null -eq $entry.Value -or $entry.Value -eq "") {
            # An empty value means "make sure this is ABSENT in the child", which
            # is not the same as setting it to "". DATABASE_URL relies on this:
            # a real till has none, and an empty string would still satisfy the
            # `process.env.DATABASE_URL !== undefined` checks in the app.
            'Remove-Item Env:\' + $name + ' -ErrorAction SilentlyContinue'
        }
        else {
            $value = ([string]$entry.Value).Replace("'", "''")
            '$env:' + $name + " = '" + $value + "'"
        }
    }
    # Built by joining, NOT with a here-string. This file is stored with bare LF
    # line endings, and Windows PowerShell 5.1 only recognises a here-string's
    # closing "@ when it is followed by CRLF — with LF the terminator is missed,
    # the rest of the file is swallowed into the string, and the whole script
    # fails to parse with an error pointing at a brace hundreds of lines away.
    # 'Continue', NOT 'Stop'. In Windows PowerShell 5.1 anything a native exe
    # writes to stderr becomes a NativeCommandError, and under 'Stop' that
    # terminates the child on output that is merely a warning — node's SSL-mode
    # notice alone was enough to fail an otherwise perfect verify. The exit code
    # is what this function reports, and it is authoritative.
    $script = (@(
            '$ErrorActionPreference = ''Continue'''
            "Set-Location '" + $ServerDir.Replace("'", "''") + "'"
            $lines
            $Command
            'exit $LASTEXITCODE'
        ) -join "`r`n")

    # The PARENT is running under 'Stop' too, so the same stderr-to-error
    # conversion has to be suppressed on this side of the call as well.
    # Restored immediately after, so genuine failures elsewhere still stop.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # Collected, not piped. Any cmdlet in a pipeline after the call resets
        # $LASTEXITCODE to its OWN result, which would report every child run as
        # a success and silently defeat the point of checking it. Assigning to a
        # variable keeps the native exit code intact.
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -Command $script 2>&1
        $code = $LASTEXITCODE
        foreach ($line in $output) { Write-Host $line }
        return $code
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

# The variables a rig process needs that must NEVER reach your shell.
# DATABASE_URL is blanked deliberately: a real till holds no cloud credentials,
# so the provisioner exercises the same path a real till would.
function Get-EdgeEnv {
    return @{
        OFFLINE_MODE_ENABLED = "true"
        OFFLINE_ROLE         = "edge"
        OFFLINE_DEVICE_ID    = $DeviceId
        SYNC_CLOUD_URL       = $CloudUrl
        SYNC_DEVICE_SECRET   = $Secret
        LOCAL_DATABASE_PATH  = $TillDb
        SYNC_AUTO_ENABLED    = "false"
        DATABASE_URL         = ""

        # Removing DATABASE_URL from the child's environment is not enough on its
        # own: provision-till.ts imports `dotenv/config`, which then re-injects it
        # straight back from the real .env — and the provisioner reports
        # EDGE_HAS_DATABASE_URL for a variable the rig thought it had unset.
        # Pointing dotenv at the rig's own file keeps the real .env out of the
        # process entirely, which is also what this rig promises in its header.
        DOTENV_CONFIG_PATH   = $EnvFile
    }
}

function Get-PortPid([string]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { return $conn.OwningProcess } else { return $null }
}

# ── Neon cold starts ─────────────────────────────────────────────────────────
# An idle Neon branch auto-suspends, and the first connection after that has to
# wait for the compute to resume. Every caller in the meantime sees a connection
# ERROR, not a slow success — which is why "cloud node won't start, run it again"
# was the documented workaround. Waking the branch on purpose, before anything
# depends on it, turns that race into a bounded wait.
function Wait-ForCloudDatabase([int]$TimeoutSec = 90) {
    $code = Invoke-InRigEnv -Vars @{ TEST_DATABASE_URL = $CloudDb } `
        -Command "node scripts/warm-test-branch.mjs --timeout $TimeoutSec"
    if ($code -ne 0) {
        Write-Host "X The test branch did not wake. Provisioning would fail anyway." -ForegroundColor Red
        return $false
    }
    return $true
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

# Stop-Process signals a kill and returns; the OS may take a moment to actually
# release the socket and the process's file handles. Anything that renames the
# SQLite mirror must wait for the handle to be GONE, not merely for the kill to
# have been requested.
function Wait-ForPortFree([string]$Port, [int]$TimeoutSec = 20) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        if (-not (Get-PortPid $Port)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# A bound port means Express is listening; it does not mean the database pool
# behind it is usable. /health/ready runs `SELECT 1` against Postgres and 503s
# until that succeeds, so it is the readiness signal the port check cannot give.
# Provisioning that starts on the port alone can reach DOWNLOAD before the pool
# is up, fail, and roll a perfectly good mirror back for no reason.
function Wait-ForCloudReady([int]$TimeoutSec = 60) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        try {
            $r = Invoke-RestMethod -Uri "$CloudUrl/health/ready" -TimeoutSec 5 -ErrorAction Stop
            if ($r.status -eq "ready") { return $true }
        }
        catch {
            # 503 until the pool connects. The loop's timeout is the error path.
        }
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

        # The edge node holds an open handle to the very file the provisioner is
        # about to quarantine, and Windows will not rename a file another process
        # has open - provision-till.ts can only close its OWN handle. Stopping the
        # edge first also guarantees no sale lands in the old mirror midway
        # through the rebuild, where it would be quarantined and never sent.
        #
        # Stop-Process returns as soon as the kill is SIGNALLED, not once the
        # handle is released, so provisioning could still race a dying process.
        # Wait-ForPortFree closes that window.
        Stop-Node $EdgePort "edge"
        if (-not (Wait-ForPortFree $EdgePort)) {
            Write-Host "X The edge node is still holding port $EdgePort." -ForegroundColor Red
            Write-Host "  Provisioning cannot rename a mirror it still has open." -ForegroundColor Yellow
            exit 1
        }

        # Wake the branch BEFORE the cloud node needs it. A suspended Neon
        # compute makes the node's own startup connection fail, and that failure
        # is what used to look like a flaky rig.
        if (-not (Wait-ForCloudDatabase)) { exit 1 }

        if (-not (Get-PortPid $CloudPort)) {
            Write-Host "Cloud node is not running. Starting it first..." -ForegroundColor Yellow
            & $PSCommandPath start-cloud-only
            if (-not (Wait-ForPort $CloudPort)) {
                Write-Host "X cloud node did not come up. See $CloudLog" -ForegroundColor Red
                exit 1
            }
        }

        # The cloud node listening is not the same as the cloud node being ready
        # to serve /sync/download — Express binds the port before the database
        # pool is usable. Provisioning that starts too early fails at DOWNLOAD
        # and rolls the mirror back for no reason.
        if (-not (Wait-ForCloudReady)) {
            Write-Host "X cloud node is listening but not serving. See $CloudLog" -ForegroundColor Red
            exit 1
        }

        # Record what mirrors exist BEFORE the run. provision-till.ts quarantines
        # rather than deletes and restores its own quarantine on failure, but if
        # it crashes outright (exit 2) the restore never runs. This is the rig's
        # own safety net over that case, and it is why 'provision' can be retried
        # without ever costing you the previous mirror.
        $mirrorsBefore = @(Get-ChildItem "$TillDb.superseded-*" -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName)

        # A populated mirror needs the destroys-the-mirror confirmation. On this
        # rig that is a rebuild of test data, so -Force passes it through and the
        # workflow stays re-runnable. A queue with unsent sales is BLOCKING and
        # is not affected by this.
        $provisionArgs = "--verify-against-cloud"
        if ($Force) {
            $provisionArgs += " --i-understand-this-destroys-the-mirror"
            Write-Host "  -Force: an existing test mirror will be rebuilt.`n" -ForegroundColor Yellow
        }

        $code = Invoke-InRigEnv -Vars (Get-EdgeEnv) `
            -Command "npx tsx scripts/provision-till.ts $provisionArgs"

        if ($code -ne 0) {
            Write-Host "`nX Provisioning failed (exit $code)." -ForegroundColor Red

            # Exit 2 means the provisioner rolled back AND the restore failed, or
            # it crashed before rollback. Either way the live mirror may be gone
            # while a quarantined one from THIS run is still on disk.
            if ($code -eq 2 -and -not (Test-Path $TillDb)) {
                $new = @(Get-ChildItem "$TillDb.superseded-*" -ErrorAction SilentlyContinue |
                    Where-Object { $mirrorsBefore -notcontains $_.FullName } |
                    Sort-Object LastWriteTime -Descending)

                if ($new.Count -gt 0) {
                    $restore = $new[0].FullName
                    Write-Host "  Restoring the mirror this run moved aside ..." -ForegroundColor Yellow
                    # WAL mode is three files. Restoring only the .db hands the
                    # next process a WAL belonging to a database that is no
                    # longer there, which SQLite reports as corruption.
                    foreach ($suffix in @("", "-wal", "-shm")) {
                        if (Test-Path "$restore$suffix") {
                            Move-Item "$restore$suffix" "$TillDb$suffix" -Force
                        }
                    }
                    Write-Host "  Restored from $(Split-Path -Leaf $restore)" -ForegroundColor Green
                    Write-Host "  The till is as it was before this run. Nothing was lost." -ForegroundColor Green
                }
                else {
                    Write-Host "  No quarantined mirror from this run to restore." -ForegroundColor Red
                    Write-Host "  Run 'provision' again to rebuild from the cloud." -ForegroundColor Yellow
                }
            }
            else {
                Write-Host "  The mirror was rejected, not handed over." -ForegroundColor Yellow
                Write-Host "  The previous mirror (if any) was restored by the provisioner." -ForegroundColor DarkGray
                if (-not $Force) {
                    Write-Host "`n  If it refused because a mirror already exists, rebuild it with:" -ForegroundColor Cyan
                    Write-Host "    .\scripts\offline-test.ps1 provision -Force" -ForegroundColor Cyan
                }
            }
            exit 1
        }

        Write-Host "`nNext:  .\scripts\offline-test.ps1 start" -ForegroundColor Green
    }

    "start-cloud-only" {
        Stop-Node $CloudPort "cloud"
        # Joined rather than written as a here-string: see Invoke-InRigEnv. A
        # closing "@ is only recognised when followed by CRLF, and this file is
        # stored with LF endings.
        $cloudCmd = (@(
                "`$env:PORT = '$CloudPort'"
                "`$env:OFFLINE_MODE_ENABLED = 'true'"
                "`$env:OFFLINE_ROLE = 'cloud'"
                "`$env:SYNC_DEVICE_SECRET = '$Secret'"
                "`$env:DATABASE_URL = '$CloudDb'"
                "Set-Location '$ServerDir'"
                "npx tsx src/server.ts *>&1 | Tee-Object -FilePath '$CloudLog'"
            ) -join "`r`n")
        Start-Process powershell -ArgumentList "-NoProfile", "-Command", $cloudCmd -WindowStyle Hidden
    }

    "start" {
        Write-Host "`n=== START BOTH NODES ===" -ForegroundColor Cyan

        if (-not (Test-Path $TillDb)) {
            Write-Host "X No till mirror at $TillDb" -ForegroundColor Red
            Write-Host "  Run:  .\scripts\offline-test.ps1 provision" -ForegroundColor Yellow
            exit 1
        }

        # Start from a known-clean state. A node left over from a previous run
        # holds the port and the mirror, so the "new" node silently fails to
        # bind and you spend the session driving the OLD process — the single
        # most confusing failure this rig had.
        Stop-Node $EdgePort "edge"
        Stop-Node $CloudPort "cloud"
        if (-not (Wait-ForPortFree $EdgePort) -or -not (Wait-ForPortFree $CloudPort)) {
            Write-Host "X A previous node is still holding its port." -ForegroundColor Red
            Write-Host "  Run 'stop', then try again." -ForegroundColor Yellow
            exit 1
        }

        # A stale -wal/-shm pair left by a hard kill makes the edge node's first
        # open look like corruption. SQLite recovers a WAL automatically on a
        # clean open, so this is only a warning — but it explains the symptom.
        if ((Test-Path "$TillDb-wal") -and ((Get-Item "$TillDb-wal").Length -gt 0)) {
            Write-Host "  note: a non-empty WAL is present; SQLite will recover it on open." -ForegroundColor DarkGray
        }

        if (-not (Wait-ForCloudDatabase)) { exit 1 }

        & $PSCommandPath start-cloud-only
        Write-Host "  cloud starting on $CloudPort ..." -NoNewline
        if (Wait-ForPort $CloudPort) { Write-Host " up" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $CloudLog"; exit 1 }

        Write-Host "  cloud readiness ..." -NoNewline
        if (Wait-ForCloudReady) { Write-Host " ready" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $CloudLog"; exit 1 }

        $autoSync = $cfg["SYNC_AUTO_ENABLED"]
        $probeMs = $cfg["SYNC_PROBE_INTERVAL_MS"]
        $edgeCmd = (@(
                "`$env:PORT = '$EdgePort'"
                "`$env:OFFLINE_MODE_ENABLED = 'true'"
                "`$env:OFFLINE_ROLE = 'edge'"
                "`$env:OFFLINE_DEVICE_ID = '$DeviceId'"
                "`$env:SYNC_CLOUD_URL = '$CloudUrl'"
                "`$env:SYNC_DEVICE_SECRET = '$Secret'"
                "`$env:LOCAL_DATABASE_PATH = '$TillDb'"
                "`$env:SYNC_AUTO_ENABLED = '$autoSync'"
                "`$env:SYNC_PROBE_INTERVAL_MS = '$probeMs'"
                # A real till holds no cloud credentials. If this leaked in, the
                # edge node could reach Neon directly and the whole offline path
                # would be bypassed without anyone noticing.
                'Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue'
                "Set-Location '$ServerDir'"
                "npx tsx src/server.ts *>&1 | Tee-Object -FilePath '$EdgeLog'"
            ) -join "`r`n")
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
        # Return only once the handles are actually released, so a 'stop' that
        # has printed its success message really does leave a clean slate for
        # the next 'provision' or 'start'.
        $edgeFree = Wait-ForPortFree $EdgePort
        $cloudFree = Wait-ForPortFree $CloudPort
        if ($edgeFree -and $cloudFree) {
            Write-Host "  both stopped.`n" -ForegroundColor Green
        }
        else {
            Write-Host "X A node did not release its port." -ForegroundColor Red
            Write-Host "  Check for a stray 'tsx src/server.ts' in Task Manager.`n" -ForegroundColor Yellow
            exit 1
        }
    }

    "offline" {
        Write-Host "`n=== GO OFFLINE ===" -ForegroundColor Yellow
        Stop-Node $CloudPort "cloud"

        # The outage is only real once the port is actually free. Returning
        # while the cloud is still winding down invites a sale to slip through
        # to the cloud and makes the test prove nothing.
        if (-not (Wait-ForPortFree $CloudPort)) {
            Write-Host "X The cloud node is still listening on $CloudPort." -ForegroundColor Red
            exit 1
        }

        if (-not (Get-PortPid $EdgePort)) {
            Write-Host "X The till is not running - there is nothing to sell on." -ForegroundColor Red
            Write-Host "  Run:  .\scripts\offline-test.ps1 start" -ForegroundColor Yellow
            exit 1
        }

        Write-Host (@(
                ""
                "  The cloud is now unreachable - the same as the shop's router dying."
                ""
                "  The till at http://localhost:$EdgePort keeps working. Go and sell:"
                "    - scan barcodes, take payments, print receipts"
                "    - create customers, process returns"
                "    - watch the sync indicator say the queue is growing"
                ""
                "  Nothing you do now reaches the cloud until you run 'sync'."
                ""
                "  When done:   .\scripts\offline-test.ps1 online"
            ) -join "`r`n") -ForegroundColor Green
    }

    "online" {
        Write-Host "`n=== BACK ONLINE ===" -ForegroundColor Cyan

        # The branch has been idle for the whole simulated outage, so this is
        # the most reliable place in the workflow to hit a cold start.
        if (-not (Wait-ForCloudDatabase)) { exit 1 }

        & $PSCommandPath start-cloud-only
        Write-Host "  cloud restarting ..." -NoNewline
        if (Wait-ForPort $CloudPort) { Write-Host " up" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $CloudLog"; exit 1 }

        Write-Host "  cloud readiness ..." -NoNewline
        if (Wait-ForCloudReady) { Write-Host " ready" -ForegroundColor Green }
        else { Write-Host " FAILED"; Write-Host "  see $CloudLog"; exit 1 }

        Write-Host "`n  The link is back. The queue has NOT drained yet."
        Write-Host "  Connectivity needs two good probes ~$([int]$cfg["SYNC_PROBE_INTERVAL_MS"] / 1000)s apart before" -ForegroundColor DarkGray
        Write-Host "  the till trusts it, so 'sync' may refuse for ~20s. That is correct." -ForegroundColor DarkGray
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

        if (-not (Test-Path $TillDb)) {
            Write-Host "X No till mirror at $TillDb — nothing to verify." -ForegroundColor Red
            Write-Host "  Run:  .\scripts\offline-test.ps1 provision" -ForegroundColor Yellow
            exit 1
        }

        # Reading the cloud side needs the branch awake, and 'verify' is the one
        # command routinely run after a long pause — precisely when it is asleep.
        if (-not (Wait-ForCloudDatabase)) { exit 1 }

        # In a child process: these two variables leaking into your shell would
        # repoint a later `npm run dev` at the test branch and the test mirror.
        $verifyEnv = @{ TEST_DATABASE_URL = $CloudDb; LOCAL_DATABASE_PATH = $TillDb }
        $code = Invoke-InRigEnv -Vars $verifyEnv -Command "npx tsx scripts/offline-test-verify.ts"
        if ($code -ne 0) { exit $code }
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
