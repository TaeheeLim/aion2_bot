# Discord voice 가 node.exe 에서만 막히는 원인 진단
# 실행: powershell -ExecutionPolicy Bypass -File D:\project\aion2\discord_aion_bot\scripts\diagnose-node-network.ps1
# (관리자 권한 불필요)

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Path
Write-Host "=== node.exe 위치 ===" -ForegroundColor Cyan
if ($nodeExe) {
    Write-Host "  $nodeExe"
} else {
    Write-Host "  ❌ node 명령을 PATH 에서 찾지 못함" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== node.exe 에 대한 방화벽 Block 규칙 ===" -ForegroundColor Cyan
$nodeBlocks = Get-NetFirewallRule -Action Block -Enabled True 2>$null |
    ForEach-Object {
        $r = $_
        $app = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        if ($app.Program -and $app.Program -like "*node*") {
            [PSCustomObject]@{
                Name      = $r.DisplayName
                Direction = $r.Direction
                Program   = $app.Program
                Profile   = $r.Profile
            }
        }
    }
if ($nodeBlocks) {
    Write-Host "  ⚠️ Block 규칙 발견 — 이게 원인일 가능성 높음:" -ForegroundColor Yellow
    $nodeBlocks | Format-Table -AutoSize
} else {
    Write-Host "  ✅ node 관련 Block 규칙 없음"
}

Write-Host ""
Write-Host "=== node.exe 에 대한 방화벽 Allow 규칙 ===" -ForegroundColor Cyan
$nodeAllows = Get-NetFirewallRule -Action Allow -Enabled True 2>$null |
    ForEach-Object {
        $r = $_
        $app = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        if ($app.Program -and $app.Program -like "*node*") {
            [PSCustomObject]@{
                Name      = $r.DisplayName
                Direction = $r.Direction
                Program   = $app.Program
            }
        }
    }
if ($nodeAllows) {
    $nodeAllows | Format-Table -AutoSize
} else {
    Write-Host "  ⚠️ Allow 규칙도 없음 — 기본 정책에 따라 차단될 수 있음" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Windows Defender 방화벽 상태 ===" -ForegroundColor Cyan
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultOutboundAction | Format-Table -AutoSize

Write-Host ""
Write-Host "=== 35.216.82.138 (Discord voice GCP) 로 가는 경로 ===" -ForegroundColor Cyan
try {
    $route = Find-NetRoute -RemoteIPAddress '35.216.82.138' -ErrorAction Stop
    $route | Select-Object IPAddress, InterfaceAlias, InterfaceIndex, NextHop, RouteMetric | Format-Table -AutoSize
} catch {
    Write-Host "  ❌ 경로 조회 실패: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 모든 네트워크 인터페이스 우선순위 ===" -ForegroundColor Cyan
Get-NetIPInterface -AddressFamily IPv4 |
    Sort-Object InterfaceMetric |
    Select-Object InterfaceAlias, InterfaceMetric, ConnectionState, Dhcp |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== 가상 어댑터 감지 (WSL/Hyper-V/Docker) ===" -ForegroundColor Cyan
$virtual = Get-NetAdapter | Where-Object {
    $_.InterfaceDescription -match 'Hyper-V|WSL|Docker|VMware|VirtualBox|Loopback'
}
if ($virtual) {
    Write-Host "  ⚠️ 가상 어댑터 존재:" -ForegroundColor Yellow
    $virtual | Select-Object Name, InterfaceDescription, Status | Format-Table -AutoSize
} else {
    Write-Host "  ✅ 가상 어댑터 없음"
}
