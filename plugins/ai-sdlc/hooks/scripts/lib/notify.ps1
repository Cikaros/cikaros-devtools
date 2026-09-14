# notify.ps1 — ai-sdlc Windows 通知端（v0.11.0）
#
# 由 hooks/scripts/lib/notify.mjs 以
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File <本文件> -Title .. -Body ..
# 脱钩调用（detached + unref，绝不阻塞 hook）。标题/正文经 argv 传入（不经
# -Command 拼接），中文以 UTF-16 原生过 CreateProcessW，无注入面、无乱码。
#
# 降级链（Windows PowerShell 5.1 系预装，零依赖）：
#   1. Win10+ Toast 通知（通知中心弹窗 + 系统默认提示音，AUMID 借用 PowerShell
#      自身——无需注册应用即显示；$NoSound 时在 toast XML 注入 silent audio）
#   2. Toast 不可用（旧系统 / WinRT 投影失败）→ msg.exe 弹窗（家庭版可能缺失，
#      静默失败）
#   3. 纯声音模式（-NoPopup）→ SystemSounds（异步播放后短暂等待确保发声）
#
# 参数：
#   -Title <string>   通知标题（默认 'ai-sdlc'）
#   -Body  <string>   通知正文（默认空）
#   -NoPopup          仅声音（不弹窗）
#   -NoSound          仅弹窗（toast 静默）
param(
    [string]$Title = 'ai-sdlc',
    [string]$Body = '',
    [switch]$NoPopup,
    [switch]$NoSound
)

$ErrorActionPreference = 'Stop'

# PowerShell 自身 AUMID（Toast 显示来源归因，免注册）
$Script:AppId = '{1AC14E9A-02E7-490D-B0C1-3D7922E7B8B4}\WindowsPowerShell\v1.0\powershell.exe'

function Show-Toast {
    try {
        # 加载 WinRT 类型（5.1 语法；PS7 不支持该投影——本文件始终由 5.1 执行）
        $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        $null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]

        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $texts = $xml.GetElementsByTagName('text')
        $null = $texts.Item(0).AppendChild($xml.CreateTextNode($Title))
        $null = $texts.Item(1).AppendChild($xml.CreateTextNode($Body))

        if ($NoSound) {
            # 静默 toast：默认提示音关闭（audio@silent）
            $audio = $xml.CreateElement('audio')
            $audio.SetAttribute('silent', 'true')
            $null = $xml.DocumentElement.AppendChild($audio)
        }

        $toast = New-Object Windows.UI.Notifications.ToastNotification -ArgumentList $xml
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
        return $true
    } catch { return $false }
}

function Show-MsgFallback {
    try {
        # msg.exe 弹窗（会话级对话框；家庭版可能没有 → 静默）
        $text = ($Title + ' ' + $Body) -replace '"', ''
        & msg.exe * $text 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function Play-Sound {
    try {
        [System.Media.SystemSounds]::Exclamation.Play()
        # SystemSounds 异步：进程若立刻退出声音会被截断，短暂驻留确保发声
        Start-Sleep -Milliseconds 400
    } catch { }
}

if (-not $NoPopup) {
    # 弹窗链：toast（含声音时用 toast 默认提示音，避免双重发声）→ msg 兜底；
    # toast 降级到 msg 时（msg 静默）且用户要声音 → SystemSounds 补一声
    $shown = Show-Toast
    if (-not $shown) { $null = Show-MsgFallback }
    if (-not $shown -and -not $NoSound) { Play-Sound }
} elseif (-not $NoSound) {
    # 纯声音模式（-NoPopup）：无弹窗即无 toast 声，用 SystemSounds
    Play-Sound
}
