# 自动提交并推送 embedded-notes
# 用法：计划任务每天定时运行，有改动就提交推送，无改动则跳过。

$ErrorActionPreference = "Continue"
$repo = "C:\Users\XIAONIE\embedded-notes"

Set-Location $repo
& "D:\Git\cmd\git.exe" pull --rebase origin main 2>&1 | Out-Null

$status = & "D:\Git\cmd\git.exe" status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Output "无改动，跳过"
    exit 0
}

& "D:\Git\cmd\git.exe" add -A
& "D:\Git\cmd\git.exe" commit -m "自动提交 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
& "D:\Git\cmd\git.exe" push origin main
