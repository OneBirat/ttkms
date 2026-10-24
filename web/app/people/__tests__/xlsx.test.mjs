import { test } from "node:test";
import assert from "node:assert/strict";
import { buildXlsx, cellRef, columnLetter, crc32, escapeXml, workbookParts, zipStored } from "../_lib/xlsx.ts";

test("column letters and cell refs", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(cellRef(9, 20), "J20");
});

test("crc32 matches the reference value for 'hello'", () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
});

test("zip: every local header carries the right crc and size, central directory lists each entry", () => {
  const entries = [
    { name: "a.txt", data: "hello" },
    { name: "dir/b.xml", data: "<x>ünïcode &amp;</x>" },
  ];
  const bytes = zipStored(entries);
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  let p = 0;
  for (const entry of entries) {
    assert.equal(view.getUint32(p, true), 0x04034b50);
    const data = new TextEncoder().encode(entry.data);
    assert.equal(view.getUint32(p + 14, true), crc32(data));
    assert.equal(view.getUint32(p + 18, true), data.length);
    const nameLen = view.getUint16(p + 26, true);
    assert.equal(decoder.decode(bytes.slice(p + 30, p + 30 + nameLen)), entry.name);
    assert.equal(decoder.decode(bytes.slice(p + 30 + nameLen, p + 30 + nameLen + data.length)), entry.data);
    p += 30 + nameLen + data.length;
  }
  assert.equal(view.getUint32(p, true), 0x02014b50);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), entries.length);
  assert.equal(view.getUint32(eocd + 16, true), p);
});

test("workbook parts: sheets, autofilter, formulas, escaped strings, number styles", () => {
  const parts = workbookParts([
    {
      name: "Payments",
      autoFilter: "A4:C6",
      rows: [
        [{ v: "Title <&>", s: "title" }],
        [],
        [],
        ["Date", "Name", "Amount"].map((h) => ({ v: h, s: "header" })),
        ["2083-07-01", "Anita \"AG\" Gurung", { v: 8000, s: "number" }],
        ["2083-07-02", "Ramesh K.C.", { v: 1500, s: "number" }],
        [{ v: "Total", s: "total" }, null, { f: "SUM(C5:C6)", v: 9500, s: "total" }],
      ],
    },
    { name: "By employee", rows: [["x"]] },
  ]);
  const names = parts.map((p) => p.name);
  assert.deepEqual(names, [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
  ]);
  const sheet = parts.find((p) => p.name === "xl/worksheets/sheet1.xml").data;
  assert.ok(sheet.includes('<autoFilter ref="A4:C6"/>'));
  assert.ok(sheet.includes("<f>SUM(C5:C6)</f><v>9500</v>"));
  assert.ok(sheet.includes("Title &lt;&amp;&gt;"));
  assert.ok(sheet.includes("Anita &quot;AG&quot; Gurung"));
  assert.ok(sheet.includes('<c r="C5" s="6"><v>8000</v></c>'));
  assert.ok(!sheet.includes('r="B7"'), "null cells are skipped");
  const workbook = parts.find((p) => p.name === "xl/workbook.xml").data;
  assert.ok(workbook.includes('<sheet name="Payments" sheetId="1" r:id="rId1"/>'));
  assert.ok(workbook.includes("_xlnm._FilterDatabase"));
  assert.ok(workbook.includes("'Payments'!$A$4:$C$6"));
  assert.equal(escapeXml("a<b"), "a&lt;b");
  const bytes = buildXlsx([{ name: "S", rows: [["a"]] }]);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
