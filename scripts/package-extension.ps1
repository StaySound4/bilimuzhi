[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath '.').Path
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot $Destination))
$workspacePrefix = $workspaceRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

if (-not $destinationPath.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Destination must stay inside the workspace root.'
}

if (Test-Path -LiteralPath $destinationPath) {
  if (-not $Force) {
    throw "Destination already exists; explicit -Force approval is required: $destinationPath"
  }
  Remove-Item -LiteralPath $destinationPath -Recurse -Force
}

New-Item -ItemType Directory -Path $destinationPath | Out-Null
Get-ChildItem -LiteralPath $sourcePath -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
}

& (Join-Path $PSScriptRoot 'verify-package.ps1') -Path $destinationPath
Write-Host "Extension package assembled: $destinationPath"
