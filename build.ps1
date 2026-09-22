[CmdletBinding()]
param(
    [switch]$InstallDependencies,
    [switch]$DirectoryOnly,
    [ValidateSet('win', 'mac', 'linux')][string]$Platform = 'win',
    [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($InstallDependencies) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
}
$buildArguments = @('scripts/package.mjs', '--platform', $Platform, '--arch', $Arch)
if ($DirectoryOnly) { $buildArguments += '--dir' }
if ($SkipTests) { $buildArguments += '--skip-tests' }
& node @buildArguments
if ($LASTEXITCODE -ne 0) { throw "GrokDesk packaging failed (exit $LASTEXITCODE)." }
