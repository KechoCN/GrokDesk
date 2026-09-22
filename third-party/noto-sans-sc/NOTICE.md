# Noto Sans SC

GrokDesk includes the complete Noto Sans SC variable font as an offline Linux
CJK fallback. Windows and macOS continue to use their existing font stacks.
Latin terminal text continues to prefer the system monospace font.

Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
The font is licensed under the SIL Open Font License 1.1, reproduced in `OFL.txt`.
The font remains under that license; GrokDesk's Apache-2.0 license does not replace it.

## Source

- Official repository: https://github.com/google/fonts/tree/main/ofl/notosanssc
- Source file: `NotoSansSC[wght].ttf`, font version `2.004-H2`.
- Immutable source revision: `2894aab31764f10f29c421bdfd2340d3b382d384`.
- Original font: https://raw.githubusercontent.com/google/fonts/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
- License: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt
- Upstream metadata is preserved in `METADATA.pb`.
- Retrieved and verified on 2026-09-22.

The original TTF is 17,772,300 bytes, SHA-256:
`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`.

## Local format conversion

The bundled `renderer/assets/fonts/noto-sans-sc-full-wght.woff2` was converted
from the entire official TTF using fontTools 4.65.0 and Brotli 1.2.0. No glyphs
were removed, and no outline, character coverage, or weight-axis subset was made.
The CSS-only family alias is `GrokDesk Noto Sans SC`; font internal names are unchanged.

The equivalent Python conversion is:

```python
from fontTools.ttLib import TTFont
font = TTFont('NotoSansSC[wght].ttf', recalcTimestamp=False)
font.flavor = 'woff2'
font.save('noto-sans-sc-full-wght.woff2')
```

The WOFF2 is 7,782,072 bytes, SHA-256:
`aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a`.

Conversion verification confirmed identical character maps, glyph order and
variable weight axes: 31,036 glyphs, 30,890 mapped Unicode codepoints, and the
full original weight axis 100–900. It preserves the source font's coverage,
including all 658 distinct Han characters currently present in renderer source.
This is the full upstream font, rather than a subset made from application text.

The font and license are packaged with the application. Font loading uses local
asset URLs and makes no runtime request to Google Fonts or another font service.
