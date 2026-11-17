import qrcode from "qrcode-generator";

/** The QR matrix for `text` (true = dark module), without a quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/**
 * Renders `text` as a QR code for a terminal, two rows of modules per line with the half-block glyph
 * (so it stays roughly square), surrounded by a 2-module quiet zone.
 *
 * By default each cell sets explicit black and white colors, so the code scans the same on dark and light
 * terminal themes. With `ansi: false` it prints plain glyphs instead (light modules filled), which only
 * scans on a dark theme. Server-only: nothing here is shared with the browser bundle.
 */
export function renderTerminalQr(text: string, options: { quietZone?: number; ansi?: boolean } = {}): string {
  const quiet = options.quietZone ?? 2;
  const ansi = options.ansi ?? true;
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const total = size + quiet * 2;
  const dark = (row: number, col: number): boolean => {
    const r = row - quiet;
    const c = col - quiet;
    return r >= 0 && c >= 0 && r < size && c < size && matrix[r]?.[c] === true;
  };

  const lines: string[] = [];
  for (let row = 0; row < total; row += 2) {
    let line = "";
    for (let col = 0; col < total; col++) {
      const top = dark(row, col);
      const bottom = dark(row + 1, col);
      if (ansi) {
        // Upper half block: foreground paints the top module, background the bottom one.
        line += `\u001B[${top ? 30 : 97};${bottom ? 40 : 107}m▀`;
      } else {
        line += top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
      }
    }
    lines.push(ansi ? `${line}\u001B[0m` : line);
  }
  return lines.join("\n");
}
