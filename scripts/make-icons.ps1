# Builds the GooseOS app icons from icons/source/goose.png:
# the goose centered on a blue grid-paper tile, at every size the app needs.
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
$goose = [System.Drawing.Image]::FromFile((Join-Path $out "source\goose.png"))

# $content = how much of the tile the goose fills (smaller for maskable icons, which get cropped to a circle)
function Draw-Icon([int]$size, [double]$content, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $g.Clear([System.Drawing.Color]::FromArgb(255, 35, 72, 201))

  # faint grid-paper lines
  $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(28, 255, 255, 255)), ([single]([Math]::Max(1, $size / 256)))
  $step = $size / 12
  for ($i = 1; $i -lt 12; $i++) {
    $v = [single]($i * $step)
    $g.DrawLine($gridPen, $v, 0, $v, $size)
    $g.DrawLine($gridPen, 0, $v, $size, $v)
  }

  $w = [int]($size * $content)
  $x = [int](($size - $w) / 2)
  $y = [int](($size - $w) / 2)
  $g.DrawImage($goose, (New-Object System.Drawing.Rectangle $x, $y, $w, $w))

  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Draw-Icon 512 0.76 "icon-512.png"
Draw-Icon 192 0.76 "icon-192.png"
Draw-Icon 180 0.76 "apple-touch-icon.png"
Draw-Icon 512 0.60 "icon-maskable-512.png"
Draw-Icon 64  0.84 "favicon-64.png"
$goose.Dispose()
"Icons written to $out"
