<#
.SYNOPSIS
  작업 폴더를 ZIP 으로 묶어 ARCHIVE\backups\ 에 만든다.

.DESCRIPTION
  웹 페이지에서 압축하기엔 큰 폴더(수 GB)를 위한 보조 스크립트.
  여기서 만든 ZIP 을 페이지의 "ZIP 파일 올리기" 버튼으로 드라이브에 올리면 된다.

.EXAMPLE
  .\backup.ps1 -Path "..\vodo"

.EXAMPLE
  # 바탕화면의 주요 작업 폴더를 한 번에
  .\backup.ps1 -Path "..\vodo", "..\glados", "..\Shiver", "..\Scaved", "..\backrooms"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]] $Path,

    [string] $OutDir = (Join-Path $PSScriptRoot "backups"),

    [string[]] $Exclude = @(
        ".git", "node_modules", ".venv", "venv", "__pycache__",
        "dist", "build", "out", ".next", "target", "bin", "obj",
        ".gradle", ".idea", ".vs"
    )
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$excludeSet = [System.Collections.Generic.HashSet[string]]::new(
    [string[]]$Exclude, [System.StringComparer]::OrdinalIgnoreCase)

foreach ($src in $Path) {
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Warning "경로를 찾을 수 없습니다: $src"
        continue
    }

    $root = (Resolve-Path -LiteralPath $src).Path.TrimEnd('\')
    $name = Split-Path $root -Leaf
    $zipPath = Join-Path $OutDir "$name`_$stamp.zip"

    Write-Host "`n[$name] 파일 목록 수집 중…" -ForegroundColor Cyan

    $files = Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $rel = $_.FullName.Substring($root.Length).TrimStart('\')
            $segments = $rel.Split('\')
            # 마지막 조각은 파일명이므로 상위 폴더 이름들만 검사
            -not ($segments[0..([Math]::Max(0, $segments.Length - 2))] |
                Where-Object { $excludeSet.Contains($_) })
        }

    if (-not $files) {
        Write-Warning "$name : 압축할 파일이 없습니다."
        continue
    }

    $totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
    Write-Host ("  {0:N0}개 파일 · {1:N1} MB" -f $files.Count, ($totalBytes / 1MB))

    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $i = 0
        foreach ($f in $files) {
            $i++
            if ($i % 200 -eq 0) {
                Write-Progress -Activity "압축 중: $name" -Status "$i / $($files.Count)" `
                    -PercentComplete (($i / $files.Count) * 100)
            }
            $entryName = "$name\" + $f.FullName.Substring($root.Length).TrimStart('\')
            $entryName = $entryName.Replace('\', '/')
            try {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip, $f.FullName, $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            } catch {
                Write-Warning "  건너뜀: $entryName ($($_.Exception.Message))"
            }
        }
    } finally {
        $zip.Dispose()
        Write-Progress -Activity "압축 중: $name" -Completed
    }

    $zipSize = (Get-Item -LiteralPath $zipPath).Length
    Write-Host ("  완료 → {0} ({1:N1} MB)" -f $zipPath, ($zipSize / 1MB)) -ForegroundColor Green
}

Write-Host "`n결과 폴더: $OutDir" -ForegroundColor Cyan
Write-Host "이제 페이지에서 'ZIP 파일 올리기' 로 드라이브에 올리세요."
