[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
  throw "Package path is not a directory: $Path"
}
$resolvedPath = (Resolve-Path -LiteralPath $Path).Path

$manifestPath = Join-Path $resolvedPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'Package is missing manifest.json.'
}

$forbiddenNames = @('.git', '.github', 'node_modules', 'tests', 'coverage')
$forbiddenExtensions = @('.ts', '.tsx', '.map', '.log')
$violations = [System.Collections.Generic.List[string]]::new()

Get-ChildItem -LiteralPath $resolvedPath -Recurse -Force | ForEach-Object {
  $relativePath = [System.IO.Path]::GetRelativePath($resolvedPath, $_.FullName)
  if ($forbiddenNames -contains $_.Name -or $forbiddenExtensions -contains $_.Extension) {
    $violations.Add($relativePath)
  }
  if ($_.Name -like '.env*') {
    $violations.Add($relativePath)
  }
}

if ($violations.Count -gt 0) {
  $violations | Sort-Object -Unique | ForEach-Object { Write-Error "Forbidden package entry: $_" }
  exit 1
}

Write-Host "Package verification passed: $resolvedPath"
