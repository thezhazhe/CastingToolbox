# ============================================================
# Casting Toolbox · 安卓 APK 构建（离线，无 gradle）
# 依赖：JDK 11+（javac/keytool）+ Android SDK build-tools + platform
# 产物：dist/apk/CastingToolbox.apk
# 用法：powershell -ExecutionPolicy Bypass -File build_apk.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$SDK  = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
# PHASE 73：不再写死 build-tools/34.0.0 与 android-34（本机只装了 36.x）——
#   自动挑可用的最高版本，缺哪个版本都能构建；可用环境变量 BT_VER / PLAT_VER 覆盖。
function Pick-Dir($parent, $filter) {
  if (-not (Test-Path $parent)) { return $null }
  $d = Get-ChildItem $parent -Directory -ErrorAction SilentlyContinue |
       Where-Object { $_.Name -like $filter } |
       Sort-Object { try { [version]($_.Name -replace '[^0-9.]', '') } catch { [version]'0.0' } } -Descending
  if ($d) { return $d[0].FullName } else { return $null }
}
$BT = if ($env:BT_VER) { Join-Path $SDK "build-tools\$env:BT_VER" } else { Pick-Dir (Join-Path $SDK 'build-tools') '*' }
$platDir = if ($env:PLAT_VER) { Join-Path $SDK "platforms\android-$env:PLAT_VER" } else { Pick-Dir (Join-Path $SDK 'platforms') 'android-*' }
$PLAT = if ($platDir) { Join-Path $platDir 'android.jar' } else { $null }
$PROJ = Join-Path $ROOT 'dist\apk\project'
$BLD  = Join-Path $ROOT 'dist\apk\build'
$APK  = Join-Path $ROOT 'dist\apk'
$OUT  = Join-Path $APK 'CastingToolbox.apk'
$PASS = 'castingbox123'

foreach ($p in @($BT, $PLAT)) { if (-not (Test-Path $p)) { Write-Host "[ERROR] 缺少: $p" -ForegroundColor Red; exit 1 } }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$null = New-Item -ItemType Directory -Force "$BLD\gen", "$BLD\classes", "$BLD\dexout"

Write-Host '[1/6] 重新生成图标（Cx 品牌图标，PIL）...' -ForegroundColor Cyan
& python (Join-Path $APK 'gen_icons.py')

Write-Host '[2/6] 拷贝 Web 资源 -> assets/www...' -ForegroundColor Cyan
$www = Join-Path $PROJ 'assets\www'
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
$null = New-Item -ItemType Directory -Force $www
foreach ($f in @('index.html', 'favicon.svg')) { Copy-Item (Join-Path $ROOT $f) $www }
# vendor = three.js / mesh-bvh 本地模块（设计中心 3D 视图靠 importmap 解析 'three'）——必须一起打包，
#   否则 Android 上进设计中心会因解析不到模块而白屏（PHASE 73 审计发现：旧 APK 缺 vendor）。
foreach ($d in @('css', 'js', 'calcs', 'data', 'assets', 'vendor')) { Copy-Item (Join-Path $ROOT $d) $www -Recurse }

Write-Host '[3/6] aapt2 compile + link...' -ForegroundColor Cyan
& "$BT\aapt2.exe" compile --dir "$PROJ\res" -o "$BLD\res.zip"
& "$BT\aapt2.exe" link -I "$PLAT" --manifest "$PROJ\AndroidManifest.xml" -o "$BLD\base.apk" "$BLD\res.zip" --java "$BLD\gen" --auto-add-overlay
if (-not $?) { throw 'aapt2 link 失败' }

Write-Host '[4/6] javac + d8...' -ForegroundColor Cyan
$R = Join-Path $BLD 'gen\com\castingtoolbox\app\R.java'
$JAVA = Get-ChildItem "$PROJ\java" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& javac -encoding UTF-8 -source 8 -target 8 -classpath "$PLAT" -d "$BLD\classes" $R $JAVA
if (-not $?) { throw 'javac 失败' }
$classFiles = Get-ChildItem "$BLD\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$BT\d8.bat" --release --lib "$PLAT" --min-api 21 --output "$BLD\dexout" $classFiles
if (-not $?) { throw 'd8 失败' }

Write-Host '[5/6] 注入 dex + assets（正斜杠路径）...' -ForegroundColor Cyan
$zip = [System.IO.Compression.ZipFile]::Open("$BLD\base.apk", [System.IO.Compression.ZipArchiveMode]::Update)
function AddZip([System.IO.Compression.ZipArchive]$z, [string]$name, [string]$path) {
  $e = $z.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $s = $e.Open(); $b = [System.IO.File]::ReadAllBytes($path); $s.Write($b, 0, $b.Length); $s.Dispose()
}
AddZip $zip 'classes.dex' "$BLD\dexout\classes.dex"
$files = Get-ChildItem $www -Recurse -File
foreach ($f in $files) {
  $rel = $f.FullName.Substring($www.Length + 1) -replace '\\', '/'
  AddZip $zip ("assets/www/" + $rel) $f.FullName
}
$zip.Dispose()

Write-Host '[6/6] zipalign + 签名...' -ForegroundColor Cyan
& "$BT\zipalign.exe" -f 4 "$BLD\base.apk" "$BLD\aligned.apk"
if (-not (Test-Path (Join-Path $APK 'castingtoolbox.keystore'))) {
  $jdkBin = Split-Path -Parent (Get-Command javac).Source
  & (Join-Path $jdkBin 'keytool.exe') -genkeypair -keystore (Join-Path $APK 'castingtoolbox.keystore') -alias castingtoolbox -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Casting Toolbox,OU=OSS,O=Casting Toolbox,L=China,ST=China,C=CN" -storepass $PASS -keypass $PASS
}
& "$BT\apksigner.bat" sign --ks (Join-Path $APK 'castingtoolbox.keystore') --ks-pass pass:$PASS --key-pass pass:$PASS --out $OUT "$BLD\aligned.apk"
& "$BT\apksigner.bat" verify --print-certs $OUT | Select-Object -First 1

Write-Host "`n构建完成: $OUT ($([math]::Round((Get-Item $OUT).Length/1KB,1)) KB)" -ForegroundColor Green
$wwwFiles = Get-ChildItem $www -Recurse -File
$json = $wwwFiles | Where-Object { $_.Extension -eq '.json' }
$js = $wwwFiles | Where-Object { $_.Extension -eq '.js' }
$wwwBytes = ($wwwFiles | Measure-Object -Property Length -Sum).Sum
Write-Host ("  内含: {0} 个文件 / 解压约 {1} KB / 知识数据 {2} 条 / JS {3} 个 / CSS {4} 个" -f `
  $wwwFiles.Count, [math]::Round($wwwBytes/1KB,1), $json.Count, $js.Count, ($wwwFiles | Where-Object { $_.Extension -eq '.css' }).Count) -ForegroundColor Cyan
