# Probe Bedrock models via CLI to determine parameter support
# Tests: basic converse, temperature, tool calling, thinking modes
# Usage: .\scripts\probe-models.ps1

$region = "us-east-1"
$simpleMessage = '{"role":"user","content":[{"text":"Say hi in one word."}]}'

# Representative models to test (one per provider/generation)
$models = @(
    # Claude adaptive-thinking models
    @{ id = "anthropic.claude-opus-4-7"; label = "Claude Opus 4.7" }
    @{ id = "anthropic.claude-sonnet-4-6"; label = "Claude Sonnet 4.6" }
    @{ id = "anthropic.claude-haiku-4-5-20251001-v1:0"; label = "Claude Haiku 4.5" }
    # Claude legacy-thinking models
    @{ id = "anthropic.claude-sonnet-4-20250514-v1:0"; label = "Claude Sonnet 4" }
    @{ id = "anthropic.claude-3-7-sonnet-20250219-v1:0"; label = "Claude 3.7 Sonnet" }
    # Claude no-thinking models
    @{ id = "anthropic.claude-3-haiku-20240307-v1:0"; label = "Claude 3 Haiku" }
    # Meta
    @{ id = "meta.llama3-3-70b-instruct-v1:0"; label = "Llama 3.3 70B" }
    @{ id = "meta.llama4-maverick-17b-instruct-v1:0"; label = "Llama 4 Maverick" }
    # Mistral
    @{ id = "mistral.mistral-large-3-675b-instruct"; label = "Mistral Large 3" }
    @{ id = "mistral.magistral-small-2509"; label = "Magistral Small" }
    # DeepSeek
    @{ id = "deepseek.r1-v1:0"; label = "DeepSeek R1" }
    @{ id = "deepseek.v3.2"; label = "DeepSeek V3.2" }
    # Amazon Nova
    @{ id = "amazon.nova-lite-v1:0"; label = "Nova Lite" }
    @{ id = "amazon.nova-pro-v1:0"; label = "Nova Pro" }
    # Others
    @{ id = "openai.gpt-oss-20b-1:0"; label = "GPT OSS 20B" }
    @{ id = "qwen.qwen3-32b-v1:0"; label = "Qwen3 32B" }
    @{ id = "google.gemma-3-12b-it"; label = "Gemma 3 12B" }
)

# Simple tool definition for tool-calling tests
$toolConfig = '{"tools":[{"toolSpec":{"name":"get_weather","description":"Get weather","inputSchema":{"json":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}}]}'

function Test-Model {
    param(
        [string]$ModelId,
        [string]$Label,
        [string]$TestName,
        [string]$ExtraArgs
    )

    $cmd = "aws bedrock-runtime converse --region $region --model-id $ModelId --messages '$simpleMessage' --inference-config '{""maxTokens"":50}' $ExtraArgs --output json 2>&1"

    try {
        $result = Invoke-Expression $cmd
        $parsed = $result | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($parsed.output.message.content) {
            $text = $parsed.output.message.content[0].text
            if ($text.Length -gt 60) { $text = $text.Substring(0, 60) + "..." }
            return @{ status = "OK"; detail = $text; stopReason = $parsed.stopReason }
        }
        if ($parsed.PSObject.Properties['__type'] -or $result -match 'Error|Exception') {
            $errMsg = if ($result -match '"message"\s*:\s*"([^"]+)"') { $Matches[1] } else { ($result | Out-String).Substring(0, [Math]::Min(120, ($result | Out-String).Length)) }
            return @{ status = "ERROR"; detail = $errMsg }
        }
        return @{ status = "OK"; detail = "response received"; stopReason = $parsed.stopReason }
    }
    catch {
        return @{ status = "ERROR"; detail = $_.Exception.Message.Substring(0, [Math]::Min(120, $_.Exception.Message.Length)) }
    }
}

Write-Host "`n=== BEDROCK MODEL SMOKE TESTS ===" -ForegroundColor Cyan
Write-Host "Region: $region`n"

$results = @()

foreach ($model in $models) {
    $id = $model.id
    $label = $model.label
    Write-Host "--- $label ($id) ---" -ForegroundColor Yellow

    # Test 1: Basic converse (no temperature)
    Write-Host "  [1] Basic (no temp)... " -NoNewline
    $r1 = Test-Model -ModelId $id -Label $label -TestName "basic"
    Write-Host "$($r1.status)" -ForegroundColor $(if ($r1.status -eq "OK") { "Green" } else { "Red" })

    # Test 2: With temperature
    Write-Host "  [2] With temperature=0.7... " -NoNewline
    $r2 = Test-Model -ModelId $id -Label $label -TestName "temperature" -ExtraArgs "--inference-config '{""maxTokens"":50,""temperature"":0.7}'"
    # Override the base inference-config
    $cmd2 = "aws bedrock-runtime converse --region $region --model-id $id --messages '$simpleMessage' --inference-config '{""maxTokens"":50,""temperature"":0.7}' --output json 2>&1"
    $raw2 = Invoke-Expression $cmd2
    $ok2 = $raw2 -notmatch 'Error|Exception|error'
    Write-Host "$(if ($ok2) { 'OK' } else { 'ERROR' })" -ForegroundColor $(if ($ok2) { "Green" } else { "Red" })
    if (-not $ok2) {
        $errSnippet = ($raw2 | Out-String).Substring(0, [Math]::Min(150, ($raw2 | Out-String).Length))
        Write-Host "    -> $errSnippet" -ForegroundColor DarkRed
    }

    # Test 3: With tool config
    Write-Host "  [3] With tool config... " -NoNewline
    $cmd3 = "aws bedrock-runtime converse --region $region --model-id $id --messages '$simpleMessage' --inference-config '{""maxTokens"":50}' --tool-config '$toolConfig' --output json 2>&1"
    $raw3 = Invoke-Expression $cmd3
    $ok3 = $raw3 -notmatch 'Error|Exception|error'
    Write-Host "$(if ($ok3) { 'OK' } else { 'ERROR' })" -ForegroundColor $(if ($ok3) { "Green" } else { "Red" })
    if (-not $ok3) {
        $errSnippet = ($raw3 | Out-String).Substring(0, [Math]::Min(150, ($raw3 | Out-String).Length))
        Write-Host "    -> $errSnippet" -ForegroundColor DarkRed
    }

    $results += [PSCustomObject]@{
        Model = $label
        ModelId = $id
        Basic = $r1.status
        Temperature = if ($ok2) { "OK" } else { "REJECTED" }
        ToolCalling = if ($ok3) { "OK" } else { "REJECTED" }
    }

    Write-Host ""
}

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

# Save results for reference
$results | ConvertTo-Json | Out-File -FilePath "scripts\probe-results.json" -Encoding utf8
Write-Host "Results saved to scripts\probe-results.json"
