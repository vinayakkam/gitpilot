#!/bin/bash
# Generates the Windows installer artwork (BMP, 24-bit) from the GitPilot brand colours.
# Usage: ./make-art.sh <plex-400.ttf> <plex-600.ttf> <out-dir>
set -e
R=$1; B=$2; OUT=$3
ACCENT='#3550C8'; DEEP='#2B43AD'; INK='#1B1E24'; MUTED='#5B6370'
mkdir -p "$OUT"

# The mark: branch line with a fork (same geometry as the app icon), white on transparent.
mark() { # size
  local s=$1
  magick -size 240x240 xc:none -stroke white -strokewidth 18 -fill none \
    -draw "line 86,62 86,178" -draw "path 'M 86,142 C 86,112 156,117 156,87'" \
    -stroke none -fill white -draw "circle 86,178 86,197" -draw "circle 86,62 86,81" -draw "circle 156,87 156,106" \
    -resize ${s}x${s} "$OUT/_mark$s.png"
}
# A faint commit-graph motif for the sidebar: three lanes with merges.
graph() { # w h — kept in the lower part of the panel, clear of the name and tagline
  magick -size $1x$2 xc:none -stroke 'rgba(255,255,255,0.10)' -strokewidth 3 -fill none \
    -draw "line 30,196 30,$2" -draw "path 'M 30,214 C 30,240 70,240 70,262'" -draw "line 70,262 70,$2" \
    -draw "path 'M 70,276 C 70,296 110,296 110,314'" \
    -stroke none -fill 'rgba(255,255,255,0.14)' \
    -draw "circle 30,196 30,202" -draw "circle 70,262 70,268" -draw "circle 30,288 30,294" \
    "$OUT/_graph.png"
}

mark 64; mark 40; mark 34; graph 164 314

# NSIS sidebar (welcome/finish pages): 164x314
magick -size 164x314 gradient:"$ACCENT"-"$DEEP" "$OUT/_graph.png" -geometry +0+0 -composite \
  "$OUT/_mark64.png" -geometry +24+40 -composite \
  -font "$B" -pointsize 22 -fill white -annotate +26+142 'GitPilot' \
  -font "$R" -pointsize 11 -fill 'rgba(255,255,255,0.78)' -annotate +27+164 'Git, made clear.' \
  -alpha off -type TrueColor BMP3:"$OUT/nsis-sidebar.bmp"

# NSIS header (top-right of inner pages): 150x57, white
magick -size 150x57 xc:white \
  \( -size 34x34 xc:none -fill "$ACCENT" -draw "roundrectangle 0,0 33,33 7,7" "$OUT/_mark34.png" -composite \) -geometry +108+12 -composite \
  -alpha off -type TrueColor BMP3:"$OUT/nsis-header.bmp"

# WiX dialog background (welcome/finish): 493x312. Left 164px brand panel, rest white for text.
magick -size 493x312 xc:white \
  \( -size 164x312 gradient:"$ACCENT"-"$DEEP" "$OUT/_graph.png" -composite \
     "$OUT/_mark64.png" -geometry +24+40 -composite \
     -font "$B" -pointsize 22 -fill white -annotate +26+142 'GitPilot' \
     -font "$R" -pointsize 11 -fill 'rgba(255,255,255,0.78)' -annotate +27+164 'Git, made clear.' \) -geometry +0+0 -composite \
  -alpha off -type TrueColor BMP3:"$OUT/wix-dialog.bmp"

# WiX top banner: 493x58, white with the mark at the right and a thin accent rule.
magick -size 493x58 xc:white \
  \( -size 40x40 xc:none -fill "$ACCENT" -draw "roundrectangle 0,0 39,39 8,8" "$OUT/_mark40.png" -composite \) -geometry +441+9 -composite \
  -fill "$ACCENT" -draw "rectangle 0,56 493,57" \
  -alpha off -type TrueColor BMP3:"$OUT/wix-banner.bmp"

rm -f "$OUT"/_*.png
