import { describe, expect, it } from "bun:test";
import { qrMatrix, renderTerminalQr } from "./terminalQr.ts";

const URL_TEXT = "http://192.168.1.20:3000/#access=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

/** Reads a rendered code back into modules, quiet zone stripped. */
function decode(rendered: string, quiet: number, ansi: boolean): boolean[][] {
  const rows: boolean[][] = [];
  for (const line of rendered.split("\n")) {
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    if (ansi) {
      for (const match of line.matchAll(/\u001B\[(\d+);(\d+)m▀/g)) {
        top.push(match[1] === "30");
        bottom.push(match[2] === "40");
      }
    } else {
      for (const ch of line) {
        top.push(ch === " " || ch === "▄");
        bottom.push(ch === " " || ch === "▀");
      }
    }
    rows.push(top, bottom);
  }
  return rows.slice(quiet, rows.length - quiet).map(row => row.slice(quiet, row.length - quiet));
}

describe("renderTerminalQr", () => {
  it("round-trips the exact module matrix in both modes", () => {
    const matrix = qrMatrix(URL_TEXT);
    for (const ansi of [true, false]) {
      const decoded = decode(renderTerminalQr(URL_TEXT, { ansi }), 2, ansi).slice(0, matrix.length);
      expect(decoded).toEqual(matrix);
    }
  });

  it("is square-ish: two module rows per text line, with a quiet zone", () => {
    const size = qrMatrix(URL_TEXT).length;
    const lines = renderTerminalQr(URL_TEXT, { ansi: false }).split("\n");
    expect(lines).toHaveLength(Math.ceil((size + 4) / 2));
    expect(Array.from(lines[0] as string)).toHaveLength(size + 4);
  });

  it("builds a different code for different text", () => {
    expect(renderTerminalQr("a")).not.toBe(renderTerminalQr("b"));
  });
});
