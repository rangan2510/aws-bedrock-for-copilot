# Probe Anthropic models on AWS Bedrock for capabilities
# Distinguishes: REACHABLE / LEGACY / ACCESS_DENIED / NOT_FOUND / VALIDATION_ERROR

param(
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Continue"

# Get all Anthropic foundation models
Write-Host "Fetching Anthropic models in $Region..." -ForegroundColor Cyan
$modelsJson = aws bedrock list-foundation-models --region $Region --query "modelSummaries[?providerName=='Anthropic']" --output json 2>&1 | Out-String
$models = $modelsJson | ConvertFrom-Json

# Get inference profiles
Write-Host "Fetching inference profiles..." -ForegroundColor Cyan
$profilesJson = aws bedrock list-inference-profiles --region $Region --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')]" --output json 2>&1 | Out-String
$profiles = $profilesJson | ConvertFrom-Json

# Build lookup: modelId -> us-prefix profile id
$profileMap = @{}
foreach ($p in $profiles) {
    if ($p.inferenceProfileId -like "us.*") {
        $baseId = $p.inferenceProfileId.Substring(3)
        $profileMap[$baseId] = $p.inferenceProfileId
    }
}

function Test-Endpoint {
    param([string]$ModelOrProfileId, [string]$Region, [hashtable]$ExtraFields)
    $msg = '[{"role":"user","content":[{"text":"hi"}]}]'
    $cfg = '{"maxTokens":100}'
    $args = @(
        "bedrock-runtime","converse",
        "--region",$Region,
        "--model-id",$ModelOrProfileId,
        "--messages",$msg,
        "--inference-config",$cfg,
        "--output","json"
    )
    if ($ExtraFields) {
        $extraJson = $ExtraFields | ConvertTo-Json -Compress -Depth 5
        $args += @("--additional-model-request-fields", $extraJson)
    }
    $output = aws @args 2>&1 | Out-String
    return $output
}

function Classify-Result {
    param([string]$Output)
    if ($Output -match 'AccessDeniedException') { return "ACCESS_DENIED" }
    if ($Output -match 'ResourceNotFoundException') {
        if ($Output -match 'Legacy') { return "LEGACY" }
        return "NOT_FOUND"
    }
    if ($Output -match 'ValidationException') {
        if ($Output -match "doesn't support on-demand throughput|requires.*inference profile") { return "NEEDS_PROFILE" }
        return "VALIDATION_ERROR"
    }
    if ($Output -match '"stopReason"') { return "OK" }
    return "UNKNOWN"
}

function Extract-ErrorMessage {
    param([string]$Output)
    if ($Output -match 'message:\s*(.+)') {
        return ($Matches[1].Trim() -split "`n")[0]
    }
    if ($Output -match '"message":"([^"]+)"') {
        return $Matches[1]
    }
    return ""
}

Write-Host ""
Write-Host "=== Reachability Check ===" -ForegroundColor Cyan
$reachable = @()
foreach ($m in $models) {
    $mid = $m.modelId
    $name = $m.modelName
    $lifecycle = $m.modelLifecycle.status

    # Try direct invoke first
    $result = Test-Endpoint -ModelOrProfileId $mid -Region $Region
    $status = Classify-Result $result
    $usedProfile = $false

    # If needs profile, try with us. prefix
    if ($status -eq "NEEDS_PROFILE" -and $profileMap.ContainsKey($mid)) {
        $result = Test-Endpoint -ModelOrProfileId $profileMap[$mid] -Region $Region
        $status = Classify-Result $result
        $usedProfile = $true
    }

    $color = switch ($status) {
        "OK" { "Green" }
        "LEGACY" { "DarkGray" }
        "ACCESS_DENIED" { "Yellow" }
        default { "Red" }
    }
    $profileTag = if ($usedProfile) { " [via profile]" } else { "" }
    Write-Host ("  {0,-50} ({1,-8}) -> {2}{3}" -f $mid, $lifecycle, $status, $profileTag) -ForegroundColor $color

    if ($status -eq "OK") {
        $invokeId = if ($usedProfile) { $profileMap[$mid] } else { $mid }
        $reachable += @{ ModelId = $mid; InvokeId = $invokeId; Name = $name; Lifecycle = $lifecycle }
    }
}

Write-Host ""
Write-Host "=== Capability Matrix (reachable models) ===" -ForegroundColor Cyan
Write-Host ("  {0,-50}  enabled+budget  adaptive  effort_max  effort_xhigh" -f "Model")
foreach ($r in $reachable) {
    $invokeId = $r.InvokeId
    $name = $r.Name

    # Test 1: thinking.enabled + budget_tokens
    $r1 = Test-Endpoint -ModelOrProfileId $invokeId -Region $Region -ExtraFields @{ thinking = @{ type = "enabled"; budget_tokens = 1024 } }
    $s1 = Classify-Result $r1

    # Test 2: thinking.adaptive (no effort)
    $r2 = Test-Endpoint -ModelOrProfileId $invokeId -Region $Region -ExtraFields @{ thinking = @{ type = "adaptive" } }
    $s2 = Classify-Result $r2

    # Test 3: adaptive + effort=max
    $r3 = Test-Endpoint -ModelOrProfileId $invokeId -Region $Region -ExtraFields @{ thinking = @{ type = "adaptive" }; output_config = @{ effort = "max" } }
    $s3 = Classify-Result $r3

    # Test 4: adaptive + effort=xhigh
    $r4 = Test-Endpoint -ModelOrProfileId $invokeId -Region $Region -ExtraFields @{ thinking = @{ type = "adaptive" }; output_config = @{ effort = "xhigh" } }
    $s4 = Classify-Result $r4

    Write-Host ("  {0,-50}  {1,-14}  {2,-8}  {3,-10}  {4}" -f $name, $s1, $s2, $s3, $s4)
}
