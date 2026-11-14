# Draws the GooseOS app icons: an orange goose footprint on blue grid paper.
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
New-Item -ItemType Directory -Force $out | Out-Null

function P([double]$x, [double]$y, [double]$s, [double]$ox, [double]$oy) {
  return New-Object System.Drawing.PointF ([single]($ox + $x * $s)), ([single]($oy + $y * $s))
}

# Footprint drawn in a 100x100 box: heel at the bottom, three toes fanning up,
# webbing scalloped between the toes.
function Foot-Path([double]$s, [double]$ox, [double]$oy) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.StartFigure()
  # heel -> left toe tip
  $p.AddBezier((P 50 96 $s $ox $oy), (P 40 93 $s $ox $oy), (P 16 66 $s $ox $oy), (P 4 34 $s $ox $oy))
  # webbing curves in, then up to the middle toe
  $p.AddBezier((P 4 34 $s $ox $oy), (P 12 40 $s $ox $oy), (P 22 47 $s $ox $oy), (P 31 46 $s $ox $oy))
  $p.AddBezier((P 31 46 $s $ox $oy), (P 41 42 $s $ox $oy), (P 46 20 $s $ox $oy), (P 50 2 $s $ox $oy))
  # middle toe down into the webbing, then out to the right toe
  $p.AddBezier((P 50 2 $s $ox $oy), (P 54 20 $s $ox $oy), (P 59 42 $s $ox $oy), (P 69 46 $s $ox $oy))
  $p.AddBezier((P 69 46 $s $ox $oy), (P 78 47 $s $ox $oy), (P 88 40 $s $ox $oy), (P 96 34 $s $ox $oy))
  # right toe tip -> heel
  $p.AddBezier((P 96 34 $s $ox $oy), (P 84 66 $s $ox $oy), (P 60 93 $s $ox $oy), (P 50 96 $s $ox $oy))
  $p.CloseFigure()
  return $p
}

# Toe lines from the heel out to each tip.
function Toe-Lines($g, [double]$s, [double]$ox, [double]$oy, $pen) {
  $g.DrawLine($pen, (P 50 82 $s $ox $oy), (P 12 38 $s $ox $oy))
  $g.DrawLine($pen, (P 50 82 $s $ox $oy), (P 50 12 $s $ox $oy))
  $g.DrawLine($pen, (P 50 82 $s $ox $oy), (P 88 38 $s $ox $oy))
}

# $content = share of the tile the footprint fills (smaller for maskable icons, which get cropped)
function Draw-Icon([int]$size, [double]$content, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $g.Clear([System.Drawing.Color]::FromArgb(255, 35, 72, 201))

  # faint grid-paper lines
  $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(28, 255, 255, 255)), ([single]([Math]::Max(1, $size / 256)))
  $step = $size / 12
  for ($i = 1; $i -lt 12; $i++) {
    $v = [single]($i * $step)
    $g.DrawLine($gridPen, $v, 0, $v, $size)
    $g.DrawLine($gridPen, 0, $v, $size, $v)
  }

  $s = $size * $content / 100
  $ox = ($size - 100 * $s) / 2
  $oy = ($size - 100 * $s) / 2 + $size * 0.01

  $orange = [System.Drawing.Color]::FromArgb(255, 255, 159, 28)
  $path = Foot-Path $s $ox $oy

  # soft shadow
  $shadow = Foot-Path $s ($ox) ($oy + $size * 0.018)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 10, 20, 70))), $shadow)

  # rounded edges: fill, then stroke with the same color and round joins
  $g.FillPath((New-Object System.Drawing.SolidBrush $orange), $path)
  $edge = New-Object System.Drawing.Pen $orange, ([single]($s * 7))
  $edge.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPath($edge, $path)

  # darker toe lines
  $toePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 214, 112, 0)), ([single]($s * 4.2))
  $toePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $toePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  Toe-Lines $g $s $ox $oy $toePen

  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Draw-Icon 192 0.62 "icon-192.png"
Draw-Icon 512 0.62 "icon-512.png"
Draw-Icon 512 0.46 "icon-maskable-512.png"
Draw-Icon 180 0.62 "apple-touch-icon.png"
"Icons written to $out"
