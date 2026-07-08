# Quick latency comparison for Sonnet 4.6, Sonnet 5, and Haiku 4.5 via global inference profiles
param(
    [string]$Region = "ap-south-1",
    [int]$Runs = 3
)

$models = @(
    @{ Name = "Sonnet 4.6"; Id = "global.anthropic.claude-sonnet-4-6" },
    @{ Name = "Sonnet 5"; Id = "global.anthropic.claude-sonnet-5" },
    @{ Name = "Haiku 4.5"; Id = "global.anthropic.claude-haiku-4-5-20251001-v1:0" }
)

$msg = '[{"role":"user","content":[{"text":"Say hi in one word."}]}]'
$cfg = '{"maxTokens":50}'
$results = @()

foreach ($m in $models) {
    for ($i = 1; $i -le $Runs; $i++) {
        $out = aws bedrock-runtime converse --region $Region --model-id $m.Id --messages $msg --inference-config $cfg --output json 2>&1 | Out-String
        $parsed = $out | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($parsed -and $parsed.metrics -and $parsed.metrics.latencyMs) {
            $results += [PSCustomObject]@{
                Model        = $m.Name
                Run          = $i
                LatencyMs    = $parsed.metrics.latencyMs
                OutputTokens = $parsed.usage.outputTokens
                InputTokens  = $parsed.usage.inputTokens
            }
        }
        else {
            $snippet = $out.Substring(0, [Math]::Min(150, $out.Length))
            $results += [PSCustomObject]@{
                Model        = $m.Name
                Run          = $i
                LatencyMs    = "ERROR"
                OutputTokens = $snippet
                InputTokens  = ""
            }
        }
    }
}

$results | Format-Table -AutoSize

Write-Host ""
Write-Host "=== Averages ===" -ForegroundColor Cyan
$results | Where-Object { $_.LatencyMs -ne "ERROR" } | Group-Object Model | ForEach-Object {
    $avg = ($_.Group | Measure-Object -Property LatencyMs -Average).Average
    Write-Host ("{0}: {1:N0} ms avg" -f $_.Name, $avg)
}
