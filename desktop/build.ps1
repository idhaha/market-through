param([string[]]$ServerOrigin = @('https://azikanbal.duckdns.org','http://localhost:3000'), [switch]$Publish)
$ErrorActionPreference = 'Stop'
$origins = foreach ($address in $ServerOrigin) {
    $origin = [Uri]$address
    if ($origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment -or $origin.UserInfo) { throw 'ServerOrigin에는 경로 없는 서버 주소를 입력하세요.' }
    if ($origin.Scheme -ne 'https' -and -not ($origin.Scheme -eq 'http' -and $origin.Host -in @('localhost','127.0.0.1'))) { throw '운영 서버는 HTTPS 주소를 사용하세요.' }
    $origin.GetLeftPart([UriPartial]::Authority)
}
if (-not $origins) { throw '허용 서버 주소가 필요합니다.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$package = Join-Path $PSScriptRoot 'packages/webview2'
if (-not (Test-Path "$package/lib/net462/Microsoft.Web.WebView2.Core.dll")) {
    New-Item -ItemType Directory -Force "$PSScriptRoot\packages" | Out-Null
    Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3537.50/microsoft.web.webview2.1.0.3537.50.nupkg' -OutFile "$PSScriptRoot\packages/webview2.zip"
    Expand-Archive "$PSScriptRoot\packages/webview2.zip" $package -Force
}
$build = Join-Path $PSScriptRoot 'build'
$output = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force $build, $output | Out-Null
Copy-Item "$package/lib/net462/Microsoft.Web.WebView2.Core.dll", "$package/lib/net462/Microsoft.Web.WebView2.WinForms.dll", "$package/runtimes/win-x64/native/WebView2Loader.dll" $build -Force
Set-Content -LiteralPath "$build\server-origin.txt" -Value ($origins | Select-Object -Unique) -Encoding UTF8
Copy-Item "$package/LICENSE.txt" "$build\WebView2-LICENSE.txt" -Force
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32manifest:$PSScriptRoot\app.manifest" "/out:$build\MarketThroughIndependent.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$build\Microsoft.Web.WebView2.Core.dll" "/reference:$build\Microsoft.Web.WebView2.WinForms.dll" "$PSScriptRoot\IndependentWindow.cs"
if ($LASTEXITCODE -ne 0) { throw '앱 컴파일 실패' }
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32manifest:$PSScriptRoot\app.manifest" "/out:$build\Uninstall.exe" /reference:System.Windows.Forms.dll "$PSScriptRoot\Uninstaller.cs"
if ($LASTEXITCODE -ne 0) { throw '제거 프로그램 컴파일 실패' }
$payloadFiles = @('MarketThroughIndependent.exe','Uninstall.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','server-origin.txt','WebView2-LICENSE.txt') | ForEach-Object { Join-Path $build $_ }
Compress-Archive -Path $payloadFiles -DestinationPath "$output\payload.zip" -Force
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32manifest:$PSScriptRoot\app.manifest" "/out:$output\MarketThroughSetup.exe" /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$output\payload.zip,payload.zip" "$PSScriptRoot\Installer.cs"
if ($LASTEXITCODE -ne 0) { throw '설치 파일 컴파일 실패' }
if ($Publish) {
    $downloads = Join-Path $PSScriptRoot '../public/downloads'
    New-Item -ItemType Directory -Force $downloads | Out-Null
    Copy-Item "$output\MarketThroughSetup.exe" $downloads -Force
}
Get-Item "$output\MarketThroughSetup.exe" | Select-Object FullName, Length

