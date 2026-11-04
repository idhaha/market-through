$ErrorActionPreference = 'Stop'
$viRoot = Split-Path $PSScriptRoot -Parent
& "$PSScriptRoot\build.ps1"
$viCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$viBuild = Join-Path $PSScriptRoot 'build'
& $viCompiler /nologo /target:exe /platform:x64 "/out:$viBuild\ViNativeSmoke.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$viBuild\Microsoft.Web.WebView2.Core.dll" "/reference:$viBuild\Microsoft.Web.WebView2.WinForms.dll" "$viRoot\dev\tests\ViNativeSmoke.cs"
if ($LASTEXITCODE -ne 0) { throw 'VI native smoke compile failed' }
Push-Location $viRoot
try {
    node dev/tests/vi-monitor.test.cjs --native
    if ($LASTEXITCODE -ne 0) { throw 'VI browser and native integration test failed' }
} finally { Pop-Location }
