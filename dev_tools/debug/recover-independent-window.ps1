$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if (-not ('MarketThroughWindowRecovery' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MarketThroughWindowRecovery {
    public delegate bool WindowCallback(IntPtr handle, IntPtr data);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int capacity);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rectangle);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
}

$processes = @(Get-Process -Name MarketThroughIndependent -ErrorAction SilentlyContinue)
if (-not $processes) { throw 'MarketThroughIndependent.exe가 실행 중이지 않습니다. 트레이딩 탭의 독립창 버튼으로 먼저 실행하세요.' }
$ids = @($processes | ForEach-Object { [uint32]$_.Id })
$windows = [System.Collections.Generic.List[object]]::new()
$callback = [MarketThroughWindowRecovery+WindowCallback] {
    param([IntPtr]$handle, [IntPtr]$data)
    [uint32]$owner = 0
    [void][MarketThroughWindowRecovery]::GetWindowThreadProcessId($handle, [ref]$owner)
    if ($ids -contains $owner) {
        $title = [System.Text.StringBuilder]::new(256)
        [void][MarketThroughWindowRecovery]::GetWindowText($handle, $title, $title.Capacity)
        if ($title.ToString().Contains('독립창')) {
            $windows.Add([pscustomobject]@{ Handle = $handle; ProcessId = $owner; Title = $title.ToString() })
        }
    }
    return $true
}
[void][MarketThroughWindowRecovery]::EnumWindows($callback, [IntPtr]::Zero)
if (-not $windows.Count) { throw '프로세스는 실행 중이지만 독립창 핸들을 찾지 못했습니다. 앱을 완전히 종료한 뒤 다시 실행하세요.' }

$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
foreach ($window in $windows) {
    $before = New-Object MarketThroughWindowRecovery+Rect
    [void][MarketThroughWindowRecovery]::GetWindowRect($window.Handle, [ref]$before)
    $wasVisible = [MarketThroughWindowRecovery]::IsWindowVisible($window.Handle)
    $width = [Math]::Min($area.Width, [Math]::Max(320, $before.Right - $before.Left))
    $height = [Math]::Min($area.Height, [Math]::Max(160, $before.Bottom - $before.Top))
    $x = $area.Left + [int](($area.Width - $width) / 2)
    $y = $area.Top + [int](($area.Height - $height) / 2)
    [void][MarketThroughWindowRecovery]::ShowWindow($window.Handle, 9) # SW_RESTORE
    if (-not [MarketThroughWindowRecovery]::SetWindowPos($window.Handle, [IntPtr]::Zero, $x, $y, $width, $height, 0x0040)) {
        throw "독립창 위치 변경 실패: PID $($window.ProcessId), Win32 오류 $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    [void][MarketThroughWindowRecovery]::SetForegroundWindow($window.Handle)
    $after = New-Object MarketThroughWindowRecovery+Rect
    [void][MarketThroughWindowRecovery]::GetWindowRect($window.Handle, [ref]$after)
    "PID $($window.ProcessId): 표시=$wasVisible, 이전=($($before.Left),$($before.Top),$($before.Right),$($before.Bottom)), 현재=($($after.Left),$($after.Top),$($after.Right),$($after.Bottom))"
}
