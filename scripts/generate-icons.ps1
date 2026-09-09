Add-Type -AssemblyName System.Drawing

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$root = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $root "icons"
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $margin = $size * 0.04
  $background = New-RoundedPath $margin $margin ($size - $margin * 2) ($size - $margin * 2) ($size * 0.20)
  $graphics.FillPath([System.Drawing.Brushes]::HotPink, $background)

  $circleMargin = $size * 0.20
  $graphics.FillEllipse([System.Drawing.Brushes]::White, $circleMargin, $circleMargin, $size - $circleMargin * 2, $size - $circleMargin * 2)

  $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(251, 114, 153))
  $pen = [System.Drawing.Pen]::new($accent, [Math]::Max(1.0, $size * 0.095))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $stemX = $size * 0.57
  $graphics.DrawLine($pen, $stemX, $size * 0.31, $stemX, $size * 0.63)
  $graphics.DrawLine($pen, $stemX, $size * 0.31, $size * 0.72, $size * 0.31)
  $graphics.FillEllipse($accent, $size * 0.39, $size * 0.57, $size * 0.22, $size * 0.15)
  $graphics.FillEllipse($accent, $size * 0.59, $size * 0.57, $size * 0.22, $size * 0.15)

  $background.Dispose()
  $pen.Dispose()
  $accent.Dispose()
  $graphics.Dispose()
  $bitmap.Save((Join-Path $iconDirectory "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}
