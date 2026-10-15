import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, parseCsv } from "./csv";
import { nameKey } from "./fields";
import { dupKey, finishImport, prepareImport, type Candidate } from "./import";
import type { Lead } from "./types";

test("parseCsv: RFC 4180 quotes, escaped quotes, embedded commas and line breaks, CRLF, BOM", () => {
  const text = '﻿name,notes\r\n"Bean, Inc","said ""hi""\nthen left"\r\n\r\nplain,\n';
  assert.deepEqual(parseCsv(text), [["name", "notes"], ["Bean, Inc", 'said "hi"\nthen left'], ["plain", ""]]);
});

test("csvCell neutralises spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(-80), "-80");
});

test("nameKey: case, &, punctuation and filler words collapse to one key", () => {
  assert.equal(nameKey("The Bean & Bun Co., LLC"), "bean and bun");
  assert.equal(nameKey("BEAN AND BUN"), "bean and bun");
  assert.equal(nameKey("Joe's  Café"), "joes cafe");
});

const NYC_HEAD = "camis,dba,boro,building,street,zipcode,phone,cuisine_description";
const nyc = (rows: string[]) => {
  const r = prepareImport("nyc_dohmh", [NYC_HEAD, ...rows].join("\n"), {}, "2026-10-14");
  assert.ok(!("error" in r));
  return r;
};

test("chains are filtered by list, spelling variant and 5+ rows; placeholder phones are invalid", () => {
  const r = nyc([
    "1,STARBUCKS COFFEE #4521,Manhattan,1,MAIN ST,10001,2125550101,Coffee/Tea",
    "2,MC DONALD'S,Manhattan,2,MAIN ST,10001,2125550102,American",
    ...[3, 4, 5, 6, 7].map((n) => `${n},LOCAL BEANS #${n},Brooklyn,${n},ELM ST,11201,21255501${10 + n},Coffee/Tea`),
    "8,CRUMBLY CAFE,Queens,8,OAK ST,11101,__________,Coffee/Tea",
    "9,OTHER CAFE,Queens,9,OAK ST,11101,91756477__,Coffee/Tea",
  ]);
  const done = finishImport(r.candidates, new Map(), new Map(), new Set(), r);
  assert.equal(done.report.chain, 7);
  assert.equal(done.report.invalidPhone, 2);
  assert.equal(done.report.wouldInsert, 2);
  assert.ok(done.inserts.every((l) => l.phone == null && l.segment === "cafe" && l.state === "NY"));
});

test("dedupe: phone first, else name + ZIP; suppressed rows never import; duplicates only fill empty fields", () => {
  const r = nyc([
    "1,Bean & Bun,Brooklyn,12,ELM ST,11201,(212) 555-0100,Coffee/Tea",
    "2,Bean and Bun Bakery,Brooklyn,14,ELM ST,11201,2125550100,Bakery Products/Desserts", // same phone, same file
    "3,Corner Cup,Brooklyn,3,OAK ST,11201,,Coffee/Tea",
    "4,CORNER CUP INC,Brooklyn,3,OAK ST,11201,,Coffee/Tea", // same name + ZIP, same file
    "5,Opted Out Cafe,Queens,5,PINE ST,11101,2125550199,Coffee/Tea",
    "6,Known Shop,Queens,6,PINE ST,11101,2125550111,Coffee/Tea",
  ]);
  const known = { id: "k1", phone: "+12125550111", address: null, source_id: "old" } as unknown as Lead;
  const done = finishImport(r.candidates, new Map([["+12125550111", known]]), new Map(), new Set(["+12125550199"]), r);
  assert.deepEqual(
    { insert: done.report.wouldInsert, phone: done.report.dupPhone, nameZip: done.report.dupNameZip, suppressed: done.report.suppressed },
    { insert: 2, phone: 2, nameZip: 1, suppressed: 1 }
  );
  assert.equal(done.updates.length, 1);
  assert.equal(done.updates[0].patch.address, "6 PINE ST");
  assert.equal("source_id" in done.updates[0].patch, false);
  assert.equal(dupKey(nameKey("Corner Cup"), "11201"), "corner cup|11201");
});

test("a second import of the same file inserts nothing", () => {
  const rows = ["1,Bean & Bun,Brooklyn,12,ELM ST,11201,2125550100,Coffee/Tea", "3,Corner Cup,Brooklyn,3,OAK ST,11201,,Coffee/Tea"];
  const first = finishImport(nyc(rows).candidates, new Map(), new Map(), new Set(), { rows: 2, invalid: 0 });
  const asRows = (ls: Candidate["lead"][]) => ls.map((l, i) => ({ ...l, id: `id${i}` }) as unknown as Lead);
  const saved = asRows(first.inserts);
  const again = finishImport(
    nyc(rows).candidates,
    new Map(saved.filter((l) => l.phone).map((l) => [l.phone!, l])),
    new Map(saved.map((l) => [dupKey(l.name_key, l.zip), l])),
    new Set(),
    { rows: 2, invalid: 0 }
  );
  assert.equal(again.report.wouldInsert, 0);
  assert.equal(again.report.dupPhone + again.report.dupNameZip, 2);
});

test("repeated rows of one shop count once for the chain rule", () => {
  const r = nyc([1, 2, 3, 4, 5].map(() => "50000001,TINY BEAN CAFE,Brooklyn,10,COURT ST,11201,7185550999,Coffee/Tea"));
  const done = finishImport(r.candidates, new Map(), new Map(), new Set(), r);
  assert.deepEqual({ chain: done.report.chain, insert: done.report.wouldInsert }, { chain: 0, insert: 1 });
  assert.equal(done.inserts[0].chain_size, undefined);
});

test("a do-not-contact lead is never re-created, and a generic mapping can't set compliance or stage", () => {
  const r = nyc(["1,Judge Optout Bakery,Brooklyn,,,11231,(718) 555-0400,Bakery Products/Desserts"]);
  const dnc = { id: "d1", phone: null, zip: "11231", name_key: "judge optout bakery", do_not_contact: true } as unknown as Lead;
  const done = finishImport(r.candidates, new Map(), new Map([[dupKey(dnc.name_key, dnc.zip), dnc]]), new Set(), r);
  assert.deepEqual({ suppressed: done.report.suppressed, insert: done.report.wouldInsert, fill: done.updates.length }, { suppressed: 1, insert: 0, fill: 0 });

  const csv = "shop,zip,phone,c\nConsent Forge Cafe,98101,(206) 555-0177,marketing";
  const forged = prepareImport("generic", csv, { mapping: { business_name: "shop", sms_consent: "c" } as never }, "2026-10-14");
  assert.ok("error" in forged && forged.error.startsWith("sms_consent"));
});
