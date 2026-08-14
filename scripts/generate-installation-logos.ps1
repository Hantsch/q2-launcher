$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourcePath = Join-Path $workspace 'assets\q2-logo-classic-green.png'
$outputDir = Join-Path $workspace 'assets\installations'

if (-not $outputDir.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output directory escaped the workspace.'
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

function New-TintedLogo {
  param(
    [Parameter(Mandatory)] [System.Drawing.Image] $Source,
    [System.Drawing.Color] $Tint,
    [float] $Gain = 1.0,
    [switch] $KeepOriginal
  )

  $bitmap = [System.Drawing.Bitmap]::new(
    $Source.Width,
    $Source.Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $destination = [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height)

    if ($KeepOriginal) {
      $graphics.DrawImage($Source, $destination)
      return $bitmap
    }

    $red = $Tint.R / 255.0
    $green = $Tint.G / 255.0
    $blue = $Tint.B / 255.0
    $matrix = [System.Drawing.Imaging.ColorMatrix]::new()

    # Convert the source texture to luminance, then tint it. Values above 1.0
    # are intentional: they keep the old metal highlights bright after tinting.
    $matrix.Matrix00 = 0.2126 * $red * $Gain
    $matrix.Matrix01 = 0.2126 * $green * $Gain
    $matrix.Matrix02 = 0.2126 * $blue * $Gain
    $matrix.Matrix10 = 0.7152 * $red * $Gain
    $matrix.Matrix11 = 0.7152 * $green * $Gain
    $matrix.Matrix12 = 0.7152 * $blue * $Gain
    $matrix.Matrix20 = 0.0722 * $red * $Gain
    $matrix.Matrix21 = 0.0722 * $green * $Gain
    $matrix.Matrix22 = 0.0722 * $blue * $Gain
    $matrix.Matrix33 = 1.0
    $matrix.Matrix44 = 1.0

    $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
    try {
      $attributes.SetColorMatrix($matrix)
      $graphics.DrawImage(
        $Source,
        $destination,
        0,
        0,
        $Source.Width,
        $Source.Height,
        [System.Drawing.GraphicsUnit]::Pixel,
        $attributes
      )
    } finally {
      $attributes.Dispose()
    }

    return $bitmap
  } catch {
    $bitmap.Dispose()
    throw
  } finally {
    $graphics.Dispose()
  }
}

function Add-EditionLabel {
  param(
    [Parameter(Mandatory)] [System.Drawing.Bitmap] $Bitmap,
    [Parameter(Mandatory)] [string] $Text,
    [Parameter(Mandatory)] [float] $EmSize,
    [Parameter(Mandatory)] [System.Drawing.Color] $TopColor,
    [Parameter(Mandatory)] [System.Drawing.Color] $BottomColor
  )

  $graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $family = [System.Drawing.FontFamily]::new('Bahnschrift SemiBold Condensed')
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $path.AddString(
      $Text,
      $family,
      [int][System.Drawing.FontStyle]::Bold,
      $EmSize,
      [System.Drawing.PointF]::new(0, 0),
      [System.Drawing.StringFormat]::GenericTypographic
    )

    $bounds = $path.GetBounds()
    $targetCenterX = $Bitmap.Width / 2.0
    $targetCenterY = $Bitmap.Height * 0.30
    $transform = [System.Drawing.Drawing2D.Matrix]::new()
    try {
      $transform.Translate(
        $targetCenterX - ($bounds.X + $bounds.Width / 2.0),
        $targetCenterY - ($bounds.Y + $bounds.Height / 2.0)
      )
      $path.Transform($transform)
    } finally {
      $transform.Dispose()
    }

    $bounds = $path.GetBounds()
    $outline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(235, 7, 9, 12), 24)
    $outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $fill = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $bounds,
      $TopColor,
      $BottomColor,
      [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $highlight = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 255, 255, 255), 3)

    try {
      $graphics.DrawPath($outline, $path)
      $graphics.FillPath($fill, $path)
      $graphics.DrawPath($highlight, $path)
    } finally {
      $outline.Dispose()
      $fill.Dispose()
      $highlight.Dispose()
    }
  } finally {
    $path.Dispose()
    $family.Dispose()
    $graphics.Dispose()
  }
}

function Save-Logo {
  param(
    [Parameter(Mandatory)] [System.Drawing.Bitmap] $Bitmap,
    [Parameter(Mandatory)] [string] $Name
  )

  $size = 512
  $output = [System.Drawing.Bitmap]::new(
    $size,
    $size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($output)

  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Bitmap, 0, 0, $size, $size)
    $output.Save((Join-Path $outputDir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $output.Dispose()
  }
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $vanilla = New-TintedLogo -Source $source -KeepOriginal
  try {
    Save-Logo -Bitmap $vanilla -Name 'vanilla-logo.png'
  } finally {
    $vanilla.Dispose()
  }

  $r1q2 = New-TintedLogo -Source $source -Tint ([System.Drawing.Color]::FromArgb(55, 132, 224)) -Gain 2.45
  try {
    $r1Label = @{
      Bitmap = $r1q2
      Text = 'R1'
      EmSize = 310
      TopColor = [System.Drawing.Color]::FromArgb(183, 220, 255)
      BottomColor = [System.Drawing.Color]::FromArgb(38, 105, 194)
    }
    Add-EditionLabel @r1Label
    Save-Logo -Bitmap $r1q2 -Name 'r1q2-logo.png'
  } finally {
    $r1q2.Dispose()
  }

  $q2pro = New-TintedLogo -Source $source -Tint ([System.Drawing.Color]::FromArgb(255, 118, 24)) -Gain 2.55
  try {
    $proLabel = @{
      Bitmap = $q2pro
      Text = 'PRO'
      EmSize = 245
      TopColor = [System.Drawing.Color]::FromArgb(255, 213, 148)
      BottomColor = [System.Drawing.Color]::FromArgb(230, 82, 0)
    }
    Add-EditionLabel @proLabel
    Save-Logo -Bitmap $q2pro -Name 'q2pro-logo.png'
  } finally {
    $q2pro.Dispose()
  }
} finally {
  $source.Dispose()
}

Get-ChildItem -Path (Join-Path $outputDir '*-logo.png') |
  Select-Object Name, @{ Name = 'SizeKB'; Expression = { [math]::Round($_.Length / 1KB) } }
