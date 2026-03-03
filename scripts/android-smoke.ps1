param(
    [string]$ProjectRoot = "$PSScriptRoot/..",
    [string]$EmulatorSerial = "emulator-5554",
    [string]$PackageName = "org.openwaqf.signer",
    [string]$MainActivity = ".MainActivity",
    [int]$CaptureSeconds = 8,
    [object]$AutoTapSample = $false,
    [int]$SampleTapDelaySeconds = 6,
    [int]$SampleTapX = 540,
    [int]$SampleTapY = 1580,
    [int]$SampleTapAttempts = 4,
    [int]$SampleTapStepY = 90,
    [object]$RunMaestro = $false,
    [string]$MaestroFlow = "$PSScriptRoot/../maestro/android/full-e2e.yaml",
    [object]$AssertSampleFlow = $false,
    [object]$AssembleApk = $true,
    [object]$InstallApk = $true,
    [string]$JavaHome = ""
)

$ErrorActionPreference = 'Stop'

function Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function To-Bool([object]$value) {
    if ($value -is [bool]) { return $value }
    $text = "$value".Trim().ToLowerInvariant()
    if ($text -in @("1", "true", "$true", "yes", "y", "on")) { return $true }
    if ($text -in @("0", "false", "$false", "no", "n", "off", "")) { return $false }
    throw "Invalid boolean value '$value'. Use true/false or 1/0."
}

function Resolve-Tool($toolName, $fallback) {
    $cmd = Get-Command $toolName -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Path }
    return $fallback
}

function Ensure-DeviceReady([string]$adbPath, [string]$serial, [int]$timeoutSeconds = 45) {
    & $adbPath start-server | Out-Null
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $state = (& $adbPath -s $serial get-state 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($state -eq "device") { return }
        if ($state -eq "offline") {
            & $adbPath reconnect offline | Out-Null
        }
        Start-Sleep -Seconds 2
    }
    throw "ADB device '$serial' is not ready (state is not 'device')."
}

function Invoke-CmdAt([string]$workingDir, [string]$command) {
    $cmd = "pushd `"$workingDir`" && $command && popd"
    cmd /c $cmd | Out-Null
}

function Write-AdbTextFile([string]$adbPath, [string]$serial, [string]$adbArgs, [string]$outputPath, [string]$cmdWorkingDir) {
    $cmd = "`"$adbPath`" -s $serial $adbArgs > `"$outputPath`""
    Invoke-CmdAt $cmdWorkingDir $cmd
}

function Ensure-AppForeground([string]$adbPath, [string]$serial, [string]$packageName, [string]$launchTarget) {
    Start-Sleep -Milliseconds 700
    $focus = (& $adbPath -s $serial shell dumpsys window windows 2>$null | Out-String)
    if ($focus -notmatch [regex]::Escape($packageName)) {
        Write-Host "App not in foreground yet; relaunching $launchTarget and waiting." -ForegroundColor Yellow
        & $adbPath -s $serial shell am start -W -n $launchTarget | Out-Null
        Start-Sleep -Milliseconds 900
    }
}

function Get-JavaMajorVersion([string]$javaExePath) {
    try {
        $verText = & $javaExePath -version 2>&1 | Out-String
        $m = [regex]::Match($verText, 'version "(\d+)(?:\.\d+)?')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    } catch {}
    return -1
}

function Resolve-Java21Home([string]$requestedJavaHome) {
    $candidates = @()
    if ($requestedJavaHome) {
        $explicitJava = Join-Path $requestedJavaHome "bin\java.exe"
        if (Test-Path $explicitJava) {
            return $requestedJavaHome
        }
    }
    if ($requestedJavaHome) { $candidates += $requestedJavaHome }
    if ($env:JDK21_HOME) { $candidates += $env:JDK21_HOME }
    if ($env:GRADLE_LOCAL_JAVA_HOME) { $candidates += $env:GRADLE_LOCAL_JAVA_HOME }
    if ($env:ORG_GRADLE_JAVA_HOME) { $candidates += $env:ORG_GRADLE_JAVA_HOME }
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    # Scan env vars for other java home hints (e.g. JAVA21_HOME, JDK_HOME)
    foreach ($entry in Get-ChildItem Env:) {
        if ($entry.Name -match 'JAVA.*HOME|JDK.*HOME|GRADLE.*JAVA.*HOME') {
            if ($entry.Value) { $candidates += $entry.Value }
        }
    }
    $candidates += @(
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Java\jdk-21",
        "C:\Program Files\Eclipse Adoptium\jdk-21.0.6.7-hotspot",
        "C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot"
    )
    foreach ($jdkHome in $candidates | Select-Object -Unique) {
        $javaExe = Join-Path $jdkHome "bin\java.exe"
        if (Test-Path $javaExe) {
            $major = Get-JavaMajorVersion $javaExe
            if ($major -ge 21) {
                return $jdkHome
            }
        }
    }
    return $null
}

$resolvedRoot = [System.IO.Path]::GetFullPath((Convert-Path $ProjectRoot))
$isUncRoot = $resolvedRoot.StartsWith("\\")
if ($isUncRoot) {
    # Keep a local Windows cwd so cmd.exe/batch calls don't start from UNC.
    Set-Location $env:TEMP
} else {
    Set-Location $resolvedRoot
}

$adb = Resolve-Tool "adb" "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
    throw "adb not found. Checked PATH and '$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe'."
}

$AutoTapSample = To-Bool $AutoTapSample
$RunMaestro = To-Bool $RunMaestro
$AssertSampleFlow = To-Bool $AssertSampleFlow
$AssembleApk = To-Bool $AssembleApk
$InstallApk = To-Bool $InstallApk

if ($AssembleApk) {
    $resolvedJavaHome = Resolve-Java21Home $JavaHome
    if (-not $resolvedJavaHome) {
        throw "Java 21 not found. Pass -JavaHome '<jdk21 path>' or set JAVA_HOME to JDK 21."
    }
    $env:JAVA_HOME = $resolvedJavaHome
    $env:Path = "$resolvedJavaHome\bin;$env:Path"
}

Step "Checking emulator/device connection"
& $adb devices -l
$devices = (& $adb devices) -split "`n" | Where-Object { $_ -match "\sdevice$" }
if (-not ($devices -match "^$EmulatorSerial\s")) {
    throw "Device '$EmulatorSerial' not connected. Start emulator and retry."
}
Ensure-DeviceReady $adb $EmulatorSerial

$sourceAndroidDir = Join-Path $resolvedRoot "android"
$androidDir = $sourceAndroidDir
$stagedRoot = $null
$cmdWorkingDir = if ($isUncRoot) { $env:TEMP } else { $resolvedRoot }
if ($isUncRoot) {
    $stagedRoot = Join-Path $env:TEMP "owq-signer-build"
    $androidDir = Join-Path $stagedRoot "android"
    Step "Staging Android + Capacitor plugin modules to local Windows path for Gradle build"
    if (Test-Path $stagedRoot) {
        Remove-Item -Recurse -Force $stagedRoot
    }
    New-Item -ItemType Directory -Path $androidDir -Force | Out-Null
    robocopy $sourceAndroidDir $androidDir /MIR /NFL /NDL /NJH /NJS /NC /NS | Out-Null

    $pluginPaths = @(
        "node_modules\@capacitor\android",
        "node_modules\@capacitor\app",
        "node_modules\@capacitor\filesystem",
        "node_modules\@capacitor\haptics",
        "node_modules\@capacitor\share",
        "node_modules\@capacitor\status-bar",
        "node_modules\@capacitor-mlkit\barcode-scanning"
    )
    foreach ($rel in $pluginPaths) {
        $src = Join-Path $resolvedRoot $rel
        if (Test-Path $src) {
            $dst = Join-Path $stagedRoot $rel
            New-Item -ItemType Directory -Path $dst -Force | Out-Null
            robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NC /NS | Out-Null
        }
    }
}

$apkPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"

if ($AssembleApk) {
    Step "Assembling debug APK (Windows Gradle wrapper)"
    Write-Host "Using JAVA_HOME=$env:JAVA_HOME" -ForegroundColor DarkGray
    $gradleCmd = "pushd `"$androidDir`" && gradlew.bat assembleDebug && popd"
    Invoke-CmdAt $cmdWorkingDir $gradleCmd
}

if ($InstallApk) {
    if (-not (Test-Path $apkPath)) {
        throw "APK not found at '$apkPath'. Build failed or output path changed."
    }
    Step "Installing APK on $EmulatorSerial"
    Ensure-DeviceReady $adb $EmulatorSerial
    $installSource = $apkPath
    if ($installSource.StartsWith("\\")) {
        $staged = Join-Path $env:TEMP "owq-app-debug.apk"
        Copy-Item -Force $installSource $staged
        $installSource = $staged
    }
    $installOut = (& $adb -s $EmulatorSerial install -r $installSource 2>&1 | Out-String)
    if ($installOut -notmatch "Success") {
        throw "APK install failed for '$installSource'. adb output: $installOut"
    }
}

$outDir = Join-Path $resolvedRoot "test-results\android-smoke"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Step "Checking app installation"
Ensure-DeviceReady $adb $EmulatorSerial
$installed = & $adb -s $EmulatorSerial shell pm list packages $PackageName
if (-not ($installed -match "package:$PackageName")) {
    $candidates = (& $adb -s $EmulatorSerial shell pm list packages) `
        | Where-Object { $_ -match "package:.*signer" }
    if ($candidates -and $candidates.Count -gt 0) {
        $detected = ($candidates[0] -replace "^package:", "").Trim()
        Write-Host "Package '$PackageName' not found. Using detected package '$detected'." -ForegroundColor Yellow
        $PackageName = $detected
    } else {
        throw "Package '$PackageName' is not installed on $EmulatorSerial. Install APK first."
    }
}

Step "Launching app"
$launchLog = Join-Path $resolvedRoot "test-results\android-smoke\launch.txt"
New-Item -ItemType Directory -Path (Split-Path -Parent $launchLog) -Force | Out-Null
& $adb -s $EmulatorSerial logcat -c
$resolvedActivity = (& $adb -s $EmulatorSerial shell cmd package resolve-activity --brief $PackageName 2>$null | Select-Object -Last 1).Trim()
$launchTarget = if ($resolvedActivity -match "^$PackageName\/") { $resolvedActivity } else { "$PackageName/$MainActivity" }
$launchOut = & $adb -s $EmulatorSerial shell am start -W -n $launchTarget 2>&1
$launchText = ($launchOut | Out-String)
$launchText | Out-File -FilePath $launchLog -Encoding utf8
if ($launchText -match "Error type\s+\d+" -or $launchText -match "does not exist") {
    throw "Failed to launch activity '$launchTarget'. adb output: $launchText"
}
Ensure-AppForeground $adb $EmulatorSerial $PackageName $launchTarget

Step "Collecting diagnostics and logs into $outDir"

$deviceInfo = Join-Path $outDir "device-info.txt"
$dumpsysMem = Join-Path $outDir "meminfo.txt"
$dumpsysActivity = Join-Path $outDir "activity-top.txt"
$uiDump = Join-Path $outDir "window-dump.xml"
$screenPng = Join-Path $outDir "screenshot.png"
$logcatDump = Join-Path $outDir "logcat.txt"

Write-AdbTextFile $adb $EmulatorSerial "shell getprop" $deviceInfo $cmdWorkingDir
Write-AdbTextFile $adb $EmulatorSerial "shell dumpsys meminfo $PackageName" $dumpsysMem $cmdWorkingDir
Write-AdbTextFile $adb $EmulatorSerial "shell dumpsys activity top" $dumpsysActivity $cmdWorkingDir
& $adb -s $EmulatorSerial shell uiautomator dump /sdcard/window_dump.xml | Out-Null
& $adb -s $EmulatorSerial pull /sdcard/window_dump.xml $uiDump | Out-Null
$screenCmd = "`"$adb`" -s $EmulatorSerial exec-out screencap -p > `"$screenPng`""
Invoke-CmdAt $cmdWorkingDir $screenCmd

if ($RunMaestro) {
    Step "Running Maestro flow"
    $maestro = Resolve-Tool "maestro" "$env:USERPROFILE\scoop\shims\maestro.cmd"
    if (-not (Test-Path $maestro)) {
        throw "maestro CLI not found. Install with 'scoop install maestro' or add to PATH."
    }

    $flowPath = $MaestroFlow
    if (-not [System.IO.Path]::IsPathRooted($flowPath)) {
        $flowPath = Join-Path $resolvedRoot $flowPath
    }
    $flowPath = [System.IO.Path]::GetFullPath($flowPath)
    if (-not (Test-Path $flowPath)) {
        throw "Maestro flow file not found: $flowPath"
    }

    $flowToRun = $flowPath
    if ($flowToRun.StartsWith("\\")) {
        # Stage the whole maestro/android tree so runFlow relative includes keep working.
        $maestroRoot = Split-Path -Parent $flowPath
        $localMaestroRoot = Join-Path $env:TEMP "owq-maestro"
        if (Test-Path $localMaestroRoot) {
            Remove-Item -Recurse -Force $localMaestroRoot
        }
        New-Item -ItemType Directory -Path $localMaestroRoot -Force | Out-Null
        robocopy $maestroRoot $localMaestroRoot /MIR /NFL /NDL /NJH /NJS /NC /NS | Out-Null
        $flowToRun = Join-Path $localMaestroRoot ([System.IO.Path]::GetFileName($flowPath))
    }

    $maestroOutFile = Join-Path $outDir "maestro-output.txt"
    New-Item -ItemType Directory -Path (Split-Path -Parent $maestroOutFile) -Force | Out-Null
    $maestroOutput = (& $maestro test $flowToRun 2>&1 | Out-String)
    $maestroOutput | Out-File -FilePath $maestroOutFile -Encoding utf8
    $expectedFlowCount = 1
    if (Test-Path $flowToRun) {
        $expectedFlowCount = [Math]::Max(1, ([regex]::Matches((Get-Content -Path $flowToRun -Raw), '^\s*-\s*runFlow\s*:', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count)
    }
    $maestroCompleted = ([regex]::Matches($maestroOutput, '\.\.\. COMPLETED')).Count
    $maestroSkipped = ([regex]::Matches($maestroOutput, '\.\.\. SKIPPED')).Count
    $maestroFailed = ([regex]::Matches($maestroOutput, '\.\.\. FAILED')).Count
    Write-Host "- Maestro flow: $flowToRun" -ForegroundColor DarkGray
    Write-Host "- Maestro expected runFlow count: $expectedFlowCount" -ForegroundColor DarkGray
    Write-Host "- Maestro steps: completed=$maestroCompleted skipped=$maestroSkipped failed=$maestroFailed" -ForegroundColor DarkGray
    Write-Host "- Maestro output: $maestroOutFile" -ForegroundColor DarkGray
    if ($LASTEXITCODE -ne 0) {
        throw "Maestro flow failed (exit=$LASTEXITCODE). See $maestroOutFile"
    }
} elseif ($AutoTapSample) {
    Step "Auto tap sample button after ${SampleTapDelaySeconds}s (x=$SampleTapX, y=$SampleTapY, attempts=$SampleTapAttempts, stepY=$SampleTapStepY)"
    Start-Sleep -Seconds $SampleTapDelaySeconds
    $attemptCount = [Math]::Max(1, $SampleTapAttempts)
    for ($i = 0; $i -lt $attemptCount; $i++) {
        $tapY = $SampleTapY + ($i * $SampleTapStepY)
        if ($tapY -gt 2300) { $tapY = 2300 }
        Write-Host "  - tap #$($i + 1): x=$SampleTapX y=$tapY" -ForegroundColor DarkGray
        & $adb -s $EmulatorSerial shell input tap $SampleTapX $tapY | Out-Null
        Start-Sleep -Milliseconds 700
    }
}

Start-Sleep -Seconds $CaptureSeconds
Write-AdbTextFile $adb $EmulatorSerial "logcat -d" $logcatDump $cmdWorkingDir

if ($AssertSampleFlow) {
    Step "Asserting sample-flow markers in logcat"
    $logText = Get-Content -Path $logcatDump -Raw
    $sampleClickIdx = $logText.IndexOf("[OWQ][SAMPLE_CLICK]")
    $sampleLoadedStaticIdx = $logText.IndexOf("[OWQ][SAMPLE_LOADED][STATIC]")
    $sampleLoadedGeneratedIdx = $logText.IndexOf("[OWQ][SAMPLE_LOADED][GENERATED]")
    $workspaceLoadedIdx = $logText.IndexOf("[OWQ][WORKSPACE_LOADED]")
    $workspaceLoadFailedIdx = $logText.IndexOf("[OWQ][WORKSPACE_LOAD_FAILED]")
    $saveStartIdx = $logText.IndexOf("[OWQ][SAVE_START]")
    $saveSuccessIdx = $logText.IndexOf("[OWQ][SAVE_SUCCESS]")
    $saveFailedIdx = $logText.IndexOf("[OWQ][SAVE_FAILED]")
    $openFileIdx = $logText.IndexOf("[OWQ][OPEN_FILE][home-drop]")

    if ($sampleClickIdx -lt 0) {
        $hasOwqMarkers = $logText.IndexOf("[OWQ][") -ge 0
        if (-not $hasOwqMarkers) {
            throw "Sample flow assert failed: no [OWQ] markers found in logcat. Installed APK is likely stale. Re-run with -AssembleApk 1 -InstallApk 1."
        }
        throw "Sample flow assert failed: [OWQ][SAMPLE_CLICK] not found. Tap likely missed coordinates."
    }

    $sampleLoadedIdx = if ($sampleLoadedStaticIdx -ge 0) { $sampleLoadedStaticIdx } else { $sampleLoadedGeneratedIdx }
    if ($sampleLoadedIdx -lt 0) {
        throw "Sample flow assert failed: sample load marker not found after click."
    }

    if ($workspaceLoadFailedIdx -ge 0 -and ($workspaceLoadedIdx -lt 0 -or $workspaceLoadFailedIdx -gt $workspaceLoadedIdx)) {
        throw "Sample flow assert failed: workspace load failed after sample click."
    }
    if ($workspaceLoadedIdx -lt 0) {
        throw "Sample flow assert failed: [OWQ][WORKSPACE_LOADED] not found."
    }

    if ($openFileIdx -ge 0 -and $openFileIdx -gt $sampleClickIdx) {
        throw "Sample flow assert failed: home drop open-file flow triggered after sample click."
    }

    if ($RunMaestro) {
        if ($saveStartIdx -lt 0) {
            throw "Sample flow assert failed: [OWQ][SAVE_START] not found."
        }
        if ($saveFailedIdx -ge 0 -and ($saveSuccessIdx -lt 0 -or $saveFailedIdx -gt $saveSuccessIdx)) {
            throw "Sample flow assert failed: save failed during Maestro flow."
        }
        if ($saveSuccessIdx -lt 0) {
            throw "Sample flow assert failed: [OWQ][SAVE_SUCCESS] not found."
        }
    }

    Write-Host "- Sample flow markers passed" -ForegroundColor Green
}

Step "Smoke summary"
Write-Host "- App launched on $EmulatorSerial" -ForegroundColor Green
Write-Host "- Logs saved to: $outDir" -ForegroundColor Green
if ($RunMaestro) {
    Write-Host "- Maestro summary saved in: $outDir\\maestro-output.txt" -ForegroundColor Green
}
Write-Host "- Share files from this folder so I can analyze failures/perf: logcat.txt, meminfo.txt, screenshot.png, window-dump.xml, maestro-output.txt" -ForegroundColor Green
