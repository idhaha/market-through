$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$build = Join-Path $PSScriptRoot 'build'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path "$build\MarketThroughIndependent.exe")) { throw '먼저 desktop/build.ps1로 앱을 빌드하세요.' }
& $compiler /nologo /target:exe /platform:x64 "/out:$build\RankNativeSmoke.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/reference:$build\Microsoft.Web.WebView2.Core.dll" "/reference:$build\Microsoft.Web.WebView2.WinForms.dll" "$root\tests\RankNativeSmoke.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native smoke 컴파일 실패' }
& $compiler /nologo /target:exe /platform:x64 /main:RankUninstallTest "/out:$build\RankUninstallTest.exe" /reference:System.Windows.Forms.dll "$PSScriptRoot\Uninstaller.cs" "$root\tests\RankUninstallTest.cs"
if ($LASTEXITCODE -ne 0) { throw '제거 테스트 컴파일 실패' }
Push-Location $build
try { ./RankUninstallTest.exe; if ($LASTEXITCODE -ne 0) { throw '제거 기능 테스트 실패' } }
finally { Pop-Location }
Push-Location $root
try {
    node tests/rank-refresh.test.cjs; if ($LASTEXITCODE -ne 0) { throw 'Rank 갱신 테스트 실패' }
    node tests/rank-independent.test.cjs; if ($LASTEXITCODE -ne 0) { throw 'Rank 독립창 테스트 실패' }
}
finally { Pop-Location }
