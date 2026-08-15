[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$patterns = [ordered]@{
  'private-key' = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
  'openai-key' = '\bsk-[A-Za-z0-9_-]{20,}\b'
  'github-token' = '\bgh[opsu]_[A-Za-z0-9]{20,}\b'
  'google-api-key' = '\bAIza[0-9A-Za-z_-]{30,}\b'
}

$trackedFiles = @(git ls-files --cached --others --exclude-standard)
if ($LASTEXITCODE -ne 0) {
  throw 'git ls-files failed; secret scanning requires a Git worktree.'
}

$findings = [System.Collections.Generic.List[string]]::new()
foreach ($relativePath in $trackedFiles) {
  if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
    continue
  }

  $content = Get-Content -Raw -LiteralPath $relativePath -ErrorAction SilentlyContinue
  if ($null -eq $content) {
    continue
  }

  foreach ($entry in $patterns.GetEnumerator()) {
    if ($content -match $entry.Value) {
      $findings.Add("$($entry.Key): $relativePath")
    }
  }
}

if ($findings.Count -gt 0) {
  $findings | Sort-Object -Unique | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Host "Secret scan passed for $($trackedFiles.Count) versioned or untracked project files."
