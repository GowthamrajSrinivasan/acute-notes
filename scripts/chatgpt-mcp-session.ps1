<#
.SYNOPSIS
  Opens and closes the public test window for the real ChatGPT MCP run (chatgpt-mcp-architecture-and-test-plan.md §7.9).

.DESCRIPTION
  Two gates, each needing positive evidence, never just the absence of a marker (user decisions 2026-11-14/15):

  -Profile restricted (default; user decision 2026-11-15): the first real ChatGPT session.
    Remote sessions get only the audited allowlist: reads plus non-destructive, review-gated proposals. No revert or
    delete, and no get_weak_concepts. The HTTP exposure filter answers 404 to everything but the MCP secret URL, and an
    ngrok traffic policy does the same before the request reaches Next (which covers Next's own /__nextjs_* dev
    endpoints).
  -Profile full: unrestricted remote writes. Stricter: also needs the revert/delete regression spec
    (e2e/local/mcpRemoveRevert.local.spec.ts), which stays red until the deferred fixes land.

  A profile's gate is open only when every one of these holds:
    1. Every required spec and test file exists, with no fail/fixme/skip/only/todo marks.
    2. Its gate record (test-results/mcp-gate/gate-<profile>.json, written by -Verify) shows every required spec
       passed as expected, none skipped or flaky, at least the minimum number of tests each, including the unit
       suites. The unit suites are: the AI-host fallback negatives, the HTTP exposure filter, and the remote
       allowlist (restricted).
    3. The record's fingerprint matches the code and configuration being launched: the required specs and tests, the
       protected code (src/ai/changes, src/mcp, src/app/api, src/proxy.ts, src/config), .env.development, the
       MCP/AI/exposure keys of .env.local (outside a session block), next.config, this script and the ngrok policy.
       Any later change closes the gate until -Verify runs again.
    4. The dev server on :3000 listens on loopback only (127.0.0.1 or ::1).
    5. Restricted only: no setting widens it. That means no ACUTE_HTTP_EXPOSURE=public, no MCP_REMOTE_PROFILE=full and
       no MCP_OAUTH_FEATURE=on in the env files.

  -Check   Prints each gate condition. Exposes nothing.
  -Verify  Runs the profile's unit suites (vitest, no AI) and required specs (local project, no AI; they switch MCP
           access on, so the server must be loopback-only: `npx next dev -H 127.0.0.1`), and writes the gate record if
           all pass.
  -Start   Refuses unless the profile's gate is open. Starts ngrok to localhost:3000 (restricted: with the traffic policy
           that passes only /api/mcp/s/<token>). Writes a marked block to .env.local: MCP_ALLOWED_HOSTS,
           MCP_PUBLIC_BASE_URL, AI_HOST_MODE=server and MCP_REMOTE_PROFILE=<profile>. Then probes the public URL
           (-Probe); any blocked path that answers anything but 404 stops ngrok and removes the block. Restart the dev
           server afterwards, still with -H 127.0.0.1, and run -Probe again.
  -Probe   Through the running tunnel, checks that unrelated paths (/, /__nextjs_*, /_next, /api/ai/*, /api/embed/check,
           /api/mcp/bridge, /api/mcp) answer 404, and that the MCP secret-URL path is not blocked. On any failure it stops
           ngrok and removes the block (fail closed).
  -Stop    Stops ngrok and removes the marked block. Restart the dev server, and revoke the secret URL in the app.

.EXAMPLE
  powershell -File scripts/chatgpt-mcp-session.ps1 -Check
  powershell -File scripts/chatgpt-mcp-session.ps1 -Verify
  powershell -File scripts/chatgpt-mcp-session.ps1 -Start
  powershell -File scripts/chatgpt-mcp-session.ps1 -Probe
  powershell -File scripts/chatgpt-mcp-session.ps1 -Stop
  powershell -File scripts/chatgpt-mcp-session.ps1 -Check -Profile full
#>
param([switch]$Check, [switch]$Verify, [switch]$Start, [switch]$Probe, [switch]$Stop, [switch]$OAuth,
  [ValidateSet("restricted", "full")][string]$Profile = "restricted")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.local"
$gateDir = Join-Path $root "test-results\mcp-gate"
$gateFile = Join-Path $gateDir "gate-$Profile.json"
$policyFile = Join-Path $PSScriptRoot "ngrok-mcp-policy.yml"
$begin = "# >>> chatgpt-mcp-session (temporary; removed by -Stop)"
$end = "# <<< chatgpt-mcp-session"

# Required e2e specs (local project, no AI) and the minimum passing tests each must contribute.
$specsCommon = [ordered]@{
  "e2e/local/staleTarget.local.spec.ts"      = 5   # update_block (reload, same-task edit, multi-block) + update_shape
  "e2e/local/mcpConflict.local.spec.ts"      = 4   # in-app and MCP tool: Keep mine / Use proposed
  "e2e/local/chatgptRehearsal.local.spec.ts" = 1
}
$specsByProfile = @{
  restricted = [ordered]@{
    "e2e/local/mcpRestricted.local.spec.ts" = 1    # one test: exact remote tools/list; 7 names refused by the server relay; allowed update_block reviewed
    "e2e/local/exposure.local.spec.ts"      = 1    # tunnel-like requests: everything but the MCP secret URL is 404
  }
  full       = [ordered]@{
    # Write-surface audit (.ai/docs/mcp-write-surface-audit-2026-11-15.md): revert_agent_changes and delete_object /
    # delete_connection can still undo or delete a user's in-place edit without asking. Deferred; stays red until fixed.
    "e2e/local/mcpRemoveRevert.local.spec.ts" = 3
  }
}
# Required vitest files (no AI; runtimes mocked) and the minimum passing tests each must contribute.
$unitCommon = [ordered]@{
  "src/app/api/ai/localTrust.test.ts" = 81         # AI-host fallback gate
}
$unitByProfile = @{
  restricted = [ordered]@{
    "src/config/httpExposure.test.ts"        = 1   # HTTP exposure filter (allowlist function)
    "src/proxy.test.ts"                       = 1   # HTTP exposure filter (request handler)
    "src/app/api/embed/check/route.test.ts"   = 1   # /api/embed/check refuses non-local requests
    "src/mcp/tools/remoteProfile.test.ts"     = 10  # remote allowlist: exact inventory, disabled tools hidden and refused, new tools default-off
    "src/mcp/bridge/remoteProfile.test.ts"    = 6   # relay-side profile: remote tools/list filtered, tools/call refused before the tab
  }
  full       = [ordered]@{}
}
$required = [ordered]@{}; foreach ($k in $specsCommon.Keys) { $required[$k] = $specsCommon[$k] }; foreach ($k in $specsByProfile[$Profile].Keys) { $required[$k] = $specsByProfile[$Profile][$k] }
$unitRequired = [ordered]@{}; foreach ($k in $unitCommon.Keys) { $unitRequired[$k] = $unitCommon[$k] }; foreach ($k in $unitByProfile[$Profile].Keys) { $unitRequired[$k] = $unitByProfile[$Profile][$k] }

# Code and configuration whose change invalidates an earlier verification.
$protected = @("src/ai/changes", "src/mcp", "src/app/api", "src/proxy.ts", "src/config")
$configFiles = @(".env.development", "next.config.ts", "next.config.mjs", "next.config.js", "scripts/chatgpt-mcp-session.ps1", "scripts/ngrok-mcp-policy.yml")
$envKeys = '^(MCP_|AI_HOST_MODE|ACUTE_HTTP_EXPOSURE|NEXT_PUBLIC_MCP_|NEXT_PUBLIC_AI_FEATURE)'

function Get-LocalEnvLines {
  if (-not (Test-Path $envFile)) { return @() }
  $out = @(); $skip = $false
  foreach ($l in Get-Content $envFile) {
    if ($l -eq $begin) { $skip = $true; continue }
    if ($l -eq $end) { $skip = $false; continue }
    if (-not $skip -and $l -match $envKeys) { $out += $l.Trim() }
  }
  return $out | Sort-Object
}

function Get-Fingerprint {
  $files = @(@($required.Keys) + @($unitRequired.Keys) + $configFiles | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ -PathType Leaf })
  foreach ($d in $protected) {
    $p = Join-Path $root $d
    if (Test-Path $p -PathType Container) { $files += @(Get-ChildItem -Path $p -Recurse -File | ForEach-Object { $_.FullName }) }
    elseif (Test-Path $p -PathType Leaf) { $files += (Resolve-Path $p).Path }
  }
  $lines = @($files | Sort-Object -Unique | ForEach-Object {
    $rel = $_.Substring($root.Length + 1).Replace("\", "/")
    "$rel $((Get-FileHash -Algorithm SHA256 -Path $_).Hash)"
  })
  $lines += @(Get-LocalEnvLines | ForEach-Object { ".env.local: $_" })
  $lines += "profile $Profile"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace "-", "").ToLower()
}

function Test-Specs {
  $problems = @()
  foreach ($s in $required.Keys) {
    $p = Join-Path $root $s
    if (-not (Test-Path $p)) { $problems += "missing $s"; continue }
    $marks = Select-String -Path $p -Pattern 'test\.(fail|fixme|skip)\s*\(|\.only\s*\('
    if ($marks) { $problems += "$s has $($marks.Count) fail/fixme/skip/only mark(s)" }
  }
  foreach ($s in $unitRequired.Keys) {
    $p = Join-Path $root $s
    if (-not (Test-Path $p)) { $problems += "missing $s"; continue }
    $marks = Select-String -Path $p -Pattern '\b(it|test|describe)\.(skip|only|todo|fails|skipIf|runIf)\b|\bx(it|describe)\s*\('
    if ($marks) { $problems += "$s has $($marks.Count) skip/only/todo/fails mark(s)" }
  }
  return $problems
}

function Test-Widening {
  if ($Profile -ne "restricted") { return @() }
  $p = @()
  foreach ($f in @(".env.development", ".env.local")) {
    $path = Join-Path $root $f
    if (-not (Test-Path $path)) { continue }
    if (Select-String -Path $path -Pattern '^\s*ACUTE_HTTP_EXPOSURE\s*=\s*public' -Quiet) { $p += "$f sets ACUTE_HTTP_EXPOSURE=public (exposes the whole app)" }
    if (Select-String -Path $path -Pattern '^\s*MCP_REMOTE_PROFILE\s*=\s*full' -Quiet) { $p += "$f sets MCP_REMOTE_PROFILE=full" }
    if (Select-String -Path $path -Pattern '^\s*MCP_OAUTH_FEATURE\s*=\s*on' -Quiet) { $p += "$f sets MCP_OAUTH_FEATURE=on (not approved for this test)" }
  }
  if ($OAuth) { $p += "-OAuth is not approved for the restricted session" }
  if (-not (Test-Path $policyFile)) { $p += "missing scripts/ngrok-mcp-policy.yml" }
  return $p
}

# Runs the required vitest files (no AI: runtimes mocked) and summarises them.
function Invoke-UnitTests {
  $out = Join-Path $gateDir "vitest-$Profile.json"
  if (Test-Path $out) { Remove-Item $out }
  Push-Location $root
  try { & npx vitest run @($unitRequired.Keys) --reporter=json --outputFile $out | Out-Null } finally { Pop-Location }
  $problems = @(); $tests = @()
  if (-not (Test-Path $out)) { $problems += "no vitest report written" }
  else {
    $v = Get-Content $out -Raw | ConvertFrom-Json
    foreach ($f in @($v.testResults)) {
      foreach ($a in @($f.assertionResults)) {
        if ($a) { $tests += [pscustomobject]@{ file = ($f.name -replace "\\", "/"); title = $a.fullName; status = $a.status } }
      }
    }
    foreach ($t in @($tests | Where-Object { $_.status -ne "passed" })) { $problems += "$($t.file): $($t.title) [$($t.status)]" }
    foreach ($s in $unitRequired.Keys) {
      $count = @($tests | Where-Object { $_.file -like "*$s" -and $_.status -eq "passed" }).Count
      if ($count -lt $unitRequired[$s]) { $problems += "$s passed $count of the $($unitRequired[$s]) required" }
    }
  }
  $passed = @($tests | Where-Object { $_.status -eq "passed" }).Count
  return [ordered]@{ ok = (-not $problems.Count); ran = $tests.Count; passed = $passed; required = $unitRequired; problems = $problems }
}

function Test-Loopback {
  $l = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
  if (-not $l.Count) { return "no dev server listening on :3000" }
  $wide = @($l | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") } | ForEach-Object { $_.LocalAddress })
  if ($wide.Count) { return ":3000 listens on $($wide -join ', ') (reachable from the network); restart it with: npx next dev -H 127.0.0.1" }
  return $null
}

function Test-Record {
  if (-not (Test-Path $gateFile)) { return "no $Profile gate record: run -Verify -Profile $Profile" }
  $g = Get-Content $gateFile -Raw | ConvertFrom-Json
  if ($g.profile -ne $Profile) { return "gate record is for another profile" }
  if ($g.fingerprint -ne (Get-Fingerprint)) { return "gate record is stale: specs, tests, protected code or configuration changed since -Verify ($($g.verifiedAt))" }
  if (-not $g.allPassed) { return "gate record shows failures" }
  if (-not $g.unitGate -or -not $g.unitGate.ok) { return "gate record shows unit-suite failures" }
  return $null
}

function Get-GateProblems {
  $p = @(Test-Specs)
  $p += @(Test-Widening)
  $r = Test-Record; if ($r) { $p += $r }
  $n = Test-Loopback; if ($n) { $p += $n }
  return $p
}

function Remove-Block {
  if (-not (Test-Path $envFile)) { return }
  $lines = Get-Content $envFile
  $out = New-Object System.Collections.Generic.List[string]
  $skip = $false
  foreach ($l in $lines) {
    if ($l -eq $begin) { $skip = $true; continue }
    if ($l -eq $end) { $skip = $false; continue }
    if (-not $skip) { $out.Add($l) }
  }
  Set-Content -Path $envFile -Value $out -Encoding utf8
}

function Close-Window([string]$why) {
  Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -ErrorAction SilentlyContinue
  Remove-Block
  Write-Error "Closed the window (ngrok stopped, session block removed): $why"
}

function Get-TunnelUrl {
  try { return ((Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1).public_url } catch { return $null }
}

# Through the public URL: unrelated paths must be 404; the MCP secret-URL path must reach MCP (not 404).
function Invoke-Probe([string]$url) {
  $blocked = @("/", "/__nextjs_source-map", "/__nextjs_original-stack-frames", "/__nextjs_launch-editor", "/_next/static/chunks/main.js",
    "/api/ai/models", "/api/ai/run", "/api/embed/check?url=http%3A%2F%2F127.0.0.1%3A3000%2F", "/api/mcp/bridge", "/api/mcp/access", "/api/mcp",
    "/.well-known/oauth-protected-resource")
  $failures = @()
  $headers = @{ "ngrok-skip-browser-warning" = "1"; "user-agent" = "acute-mcp-gate-probe" }
  foreach ($path in $blocked) {
    $code = $null
    try { $code = (Invoke-WebRequest -UseBasicParsing -Uri ($url.TrimEnd("/") + $path) -Headers $headers -TimeoutSec 20 -MaximumRedirection 0).StatusCode }
    catch { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } else { $code = "no response" } }
    if ($code -ne 404) { $failures += "$path answered $code (expected 404)" }
  }
  $mcp = $null
  try { $mcp = (Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($url.TrimEnd("/") + "/api/mcp/s/gateprobe") -Headers $headers -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"ping"}' -TimeoutSec 20).StatusCode }
  catch { if ($_.Exception.Response) { $mcp = [int]$_.Exception.Response.StatusCode } else { $mcp = "no response" } }
  if ($mcp -eq 404 -or $mcp -eq "no response") { $failures += "/api/mcp/s/<token> answered $mcp (the MCP path must be reachable)" }
  return @{ failures = $failures; mcp = $mcp }
}

if ($Verify) {
  $specProblems = @(Test-Specs) + @(Test-Widening)
  if ($specProblems.Count) { Write-Error "Refusing to verify ($Profile): $($specProblems -join '; ')" }
  $n = Test-Loopback
  if ($n) { Write-Error "Refusing to verify (the specs switch MCP access on): $n" }
  New-Item -ItemType Directory -Force -Path $gateDir | Out-Null
  $report = Join-Path $gateDir "report-$Profile.json"
  if (Test-Path $report) { Remove-Item $report }
  $fingerprint = Get-Fingerprint
  $unit = Invoke-UnitTests
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $report
  Push-Location $root
  try { & npx playwright test --project=local @($required.Keys) --reporter=json --trace off --output (Join-Path $gateDir "out-$Profile") | Out-Null } finally { Pop-Location }
  if (-not (Test-Path $report)) { Write-Error "no Playwright report written" }
  $json = Get-Content $report -Raw | ConvertFrom-Json
  $results = New-Object System.Collections.Generic.List[object]
  function Walk($suite) {
    foreach ($sp in @($suite.specs)) {
      if (-not $sp) { continue }
      foreach ($t in @($sp.tests)) {
        $last = @($t.results)[-1]
        $results.Add([pscustomobject]@{ file = ($sp.file -replace "\\", "/"); title = $sp.title; expected = $t.expectedStatus; status = $last.status; outcome = $t.status })
      }
    }
    foreach ($c in @($suite.suites)) { if ($c) { Walk $c } }
  }
  foreach ($s in @($json.suites)) { Walk $s }
  $bad = @($results | Where-Object { $_.expected -ne "passed" -or $_.status -ne "passed" -or $_.outcome -ne "expected" })
  $short = @()
  foreach ($s in $required.Keys) {
    $name = Split-Path $s -Leaf
    $count = @($results | Where-Object { $_.file -like "*$name" -and $_.status -eq "passed" -and $_.expected -eq "passed" }).Count
    if ($count -lt $required[$s]) { $short += "$name passed $count of the $($required[$s]) required" }
  }
  $ok = (-not $bad.Count) -and (-not $short.Count) -and $unit.ok -and ($fingerprint -eq (Get-Fingerprint))
  $record = [ordered]@{
    profile = $Profile; verifiedAt = (Get-Date).ToString("o"); fingerprint = $fingerprint; allPassed = $ok
    tests = $results; unitGate = $unit
    problems = @($bad | ForEach-Object { "$($_.file): $($_.title) [$($_.expected)/$($_.status)]" }) + $short + @($unit.problems | ForEach-Object { "unit: $_" })
  }
  if ($ok) { $record | ConvertTo-Json -Depth 5 | Set-Content -Path $gateFile -Encoding utf8; Write-Output "verified ($Profile): $($results.Count) e2e tests passed, unit suites $($unit.passed)/$($unit.ran) passed; gate record written (fingerprint $fingerprint)" }
  else { if (Test-Path $gateFile) { Remove-Item $gateFile }; Write-Output "NOT verified ($Profile):"; $record.problems | ForEach-Object { Write-Output "  $_" }; exit 1 }
  exit 0
}

if ($Probe) {
  $url = Get-TunnelUrl
  if (-not $url) { Write-Error "no ngrok tunnel is running" }
  $r = Invoke-Probe $url
  if ($r.failures.Count) { Close-Window ("probe failed: " + ($r.failures -join "; ")) }
  Write-Output "probe passed through $url : every unrelated path is 404; the MCP secret-URL path answered $($r.mcp)"
  exit 0
}

if ($Check -or (-not $Start -and -not $Stop)) {
  $ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($ngrok) { Write-Output "ngrok: $((& ngrok version) -join ' ')" } else { Write-Output "ngrok: NOT FOUND" }
  Write-Output "profile: $Profile"
  if (Test-Path $envFile) {
    if (Select-String -Path $envFile -Pattern ([regex]::Escape($begin)) -Quiet) { Write-Output ".env.local: a session block is still present (run -Stop)" }
  }
  if (Test-Path $gateFile) {
    $g = Get-Content $gateFile -Raw | ConvertFrom-Json
    Write-Output "last -Verify ($Profile): $($g.verifiedAt), e2e $(@($g.tests).Count) passed, unit $($g.unitGate.passed)/$($g.unitGate.ran), fingerprint $($g.fingerprint)"
  }
  $problems = @(Get-GateProblems)
  if ($problems.Count) { Write-Output "gate ($Profile): CLOSED"; $problems | ForEach-Object { Write-Output "  - $_" } } else { Write-Output "gate ($Profile): open (fingerprint $(Get-Fingerprint))" }
  if ($ngrok -and -not $problems.Count) { Write-Output "ready: -Start -Profile $Profile only with the user's explicit authorization for the real session" } else { Write-Output "not ready" }
  exit 0
}

if ($Start) {
  $problems = @(Get-GateProblems)
  if ($problems.Count) { Write-Error "Refusing to expose the dev server ($Profile): $($problems -join '; ')" }
  Remove-Block
  $ngrokArgs = @("http", "3000", "--log=stdout")
  if ($Profile -eq "restricted") { $ngrokArgs += "--traffic-policy-file=$policyFile" }
  $proc = Start-Process ngrok -ArgumentList $ngrokArgs -PassThru -WindowStyle Hidden
  $url = $null
  for ($i = 0; $i -lt 30 -and -not $url; $i++) { Start-Sleep -Milliseconds 500; $url = Get-TunnelUrl }
  if (-not $url) { Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue; Write-Error "ngrok didn't report a tunnel (a traffic-policy error also stops it here)" }
  $hostName = ([Uri]$url).Host
  $block = @($begin, "MCP_ALLOWED_HOSTS=$hostName", "MCP_PUBLIC_BASE_URL=$url", "AI_HOST_MODE=server", "MCP_REMOTE_PROFILE=$Profile")
  if ($OAuth -and $Profile -eq "full") { $block += "MCP_OAUTH_FEATURE=on" }
  $block += $end
  Add-Content -Path $envFile -Value $block -Encoding utf8
  $r = Invoke-Probe $url
  if ($r.failures.Count) { Close-Window ("probe failed: " + ($r.failures -join "; ")) }
  Write-Output "Tunnel ($Profile): $url (ngrok pid $($proc.Id)); probe passed (MCP path answered $($r.mcp))"
  Write-Output "Next: restart the dev server with npx next dev -H 127.0.0.1, then run -Probe again; in the app: menu > MCP access > On, Create secret URL; then follow the runbook."
  Write-Output "When done: powershell -File scripts/chatgpt-mcp-session.ps1 -Stop"
  exit 0
}

if ($Stop) {
  Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -ErrorAction SilentlyContinue
  Remove-Block
  Write-Output "ngrok stopped; .env.local session block removed. Restart the dev server, and revoke the secret URL in the app if not done."
  exit 0
}
