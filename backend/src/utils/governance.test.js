/**
 * Unit tests for the governance rules and the governance-record validators.
 *   node src/utils/governance.test.js
 * Plain assert, no framework, like creditScore.test.js.
 */
const assert = require("assert");
const {
  isServing, checkOneThirdRule, deriveCommitteeStatus, latestPerType, withLiveStatus,
  boardMemberStatus, computeReelectionDueDate,
} = require("./governance");
const { normalizeKenyanPhone, phoneSchema, nationalIdSchema, requiredDate, optionalDate, clearableDate } = require("./validators");
const { z } = require("zod");

const NOW = new Date("2026-10-07T00:00:00Z");
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const m = (role, gender, extra = {}) => ({ role, gender, reelectionDueDate: new Date("2029-01-01"), ...extra });

console.log("\nServing vs retired");
test("no retirement date = serving", () => assert.ok(isServing({}, NOW)));
test("retirement date in the future = still serving", () => assert.ok(isServing({ retirementDate: "2027-01-01" }, NOW)));
test("retirement date in the past = retired", () => assert.ok(!isServing({ retirementDate: "2026-01-01" }, NOW)));
test("retiring today (midnight earlier) = retired", () => assert.ok(!isServing({ retirementDate: "2026-10-07T00:00:00Z" }, NOW)));

console.log("\n1/3 gender rule ignores retired members");
const six = [m("CHAIRPERSON", "MALE"), m("VICE_CHAIRPERSON", "MALE"), m("SECRETARY", "MALE"), m("TREASURER", "MALE"), m("BOARD_MEMBER", "FEMALE"), m("BOARD_MEMBER", "FEMALE")];
test("4 men + 2 women of 6 is compliant (exactly 2/3)", () => assert.ok(checkOneThirdRule(six, NOW).compliant));
test("a retiring woman tips it to non-compliant (4 of 5 men)", () => {
  const after = six.map((x, i) => (i === 5 ? { ...x, retirementDate: "2026-06-01" } : x));
  const r = checkOneThirdRule(after, NOW);
  assert.ok(!r.compliant); assert.strictEqual(r.totalElectedSeats, 5); assert.strictEqual(r.femaleCount, 1);
});
test("a retirement still in the future changes nothing yet", () => {
  const after = six.map((x, i) => (i === 5 ? { ...x, retirementDate: "2027-06-01" } : x));
  assert.ok(checkOneThirdRule(after, NOW).compliant);
});
test("executive manager is still excluded from the rule", () => {
  assert.ok(checkOneThirdRule([...six, m("EXECUTIVE_MANAGER", "MALE")], NOW).compliant);
});

console.log("\nCommittee status");
test("a retired member's old term no longer makes the committee 'expired'", () => {
  const members = [
    { ...m("CHAIRPERSON", "MALE"), reelectionDueDate: new Date("2025-01-01"), retirementDate: new Date("2024-12-01") },
    m("SECRETARY", "FEMALE"), m("TREASURER", "MALE"),
  ];
  assert.strictEqual(deriveCommitteeStatus(members, NOW), "COMPLIANT");
});
test("an expired term of someone still serving does mark it expired", () => {
  const members = [{ ...m("CHAIRPERSON", "MALE"), reelectionDueDate: new Date("2025-01-01") }, m("SECRETARY", "FEMALE")];
  assert.strictEqual(deriveCommitteeStatus(members, NOW), "TERM_EXPIRED");
});
test("everyone retired = no mandate = expired", () => {
  const members = [m("CHAIRPERSON", "MALE", { retirementDate: "2026-01-01" }), m("SECRETARY", "FEMALE", { retirementDate: "2026-02-01" })];
  assert.strictEqual(deriveCommitteeStatus(members, NOW), "TERM_EXPIRED");
});
test("term within 90 days of a serving member = expiring", () => {
  const members = [{ ...m("CHAIRPERSON", "MALE"), reelectionDueDate: new Date("2026-11-15") }, m("SECRETARY", "FEMALE")];
  assert.strictEqual(deriveCommitteeStatus(members, NOW), "TERM_EXPIRING");
});
test("legacy members without the new fields still work", () => {
  assert.strictEqual(deriveCommitteeStatus([m("CHAIRPERSON", "MALE"), m("SECRETARY", "FEMALE")], NOW), "COMPLIANT");
});

console.log("\nOnly the newest committee of a type is in force");
const c1 = { id: "old", committeeType: "MANAGEMENT", createdAt: "2026-01-01", members: [{ ...m("CHAIRPERSON", "MALE"), reelectionDueDate: new Date("2025-01-01") }] };
const c2 = { id: "new", committeeType: "MANAGEMENT", createdAt: "2026-09-01", members: [m("CHAIRPERSON", "FEMALE"), m("SECRETARY", "MALE")] };
test("latestPerType keeps only the newest per type", () => assert.deepStrictEqual(latestPerType([c1, c2]).map((c) => c.id), ["new"]));
test("order of input doesn't matter", () => assert.deepStrictEqual(latestPerType([c2, c1]).map((c) => c.id), ["new"]));
test("withLiveStatus refreshes status and flags the current one", () => {
  const out = withLiveStatus([c1, c2], NOW);
  assert.strictEqual(out.find((c) => c.id === "old").status, "TERM_EXPIRED");
  assert.strictEqual(out.find((c) => c.id === "old").current, false);
  assert.strictEqual(out.find((c) => c.id === "new").current, true);
  assert.strictEqual(out.find((c) => c.id === "new").status, "COMPLIANT");
});

console.log("\nSupervisory board member status (3-year term, rule 28(1))");
test("recently appointed = serving", () => assert.strictEqual(boardMemberStatus({ appointmentDate: "2025-10-01" }, NOW), "SERVING"));
test("three years to the day approaching (within 90 days) = expiring", () => assert.strictEqual(boardMemberStatus({ appointmentDate: "2023-11-20" }, NOW), "TERM_EXPIRING"));
test("past three years with no retirement = term expired", () => assert.strictEqual(boardMemberStatus({ appointmentDate: "2023-01-01" }, NOW), "TERM_EXPIRED"));
test("retired member = retired, whatever the dates", () => assert.strictEqual(boardMemberStatus({ appointmentDate: "2023-01-01", retirementDate: "2025-06-01" }, NOW), "RETIRED"));
test("term end is appointment + 3 years", () => assert.strictEqual(computeReelectionDueDate("2025-10-01", 3).getUTCFullYear(), 2028));

console.log("\nPhone numbers");
for (const [input, want] of [
  ["0712345678", "+254712345678"], ["0712 345 678", "+254712345678"], ["+254712345678", "+254712345678"],
  ["254 712-345-678", "+254712345678"], ["712345678", "+254712345678"], ["0112345678", "+254112345678"], ["(0712) 345678", "+254712345678"],
]) test(`${input} -> ${want}`, () => assert.strictEqual(normalizeKenyanPhone(input), want));
for (const bad of ["0712", "07123456789", "+2547123456", "abc", "", "0012345678", "+255712345678", "0712 34567a"])
  test(`rejects "${bad}"`, () => assert.strictEqual(normalizeKenyanPhone(bad), null));
test("phoneSchema message names the problem", () => {
  const r = phoneSchema.safeParse("123");
  assert.ok(!r.success); assert.match(r.error.issues[0].message, /valid Kenyan phone/);
});

console.log("\nID numbers");
for (const good of ["12345678", " 1234567 ", "A1234567", "a1234567"]) test(`accepts "${good}"`, () => assert.ok(nationalIdSchema.safeParse(good).success));
test("is stored trimmed and upper-case", () => assert.strictEqual(nationalIdSchema.parse(" a1234567 "), "A1234567"));
for (const bad of ["", "1234", "12 345 678", "1234-5678", "x".repeat(16)]) test(`rejects "${bad}"`, () => assert.ok(!nationalIdSchema.safeParse(bad).success));

console.log("\nDates");
test("required date: blank -> 'is required'", () => assert.match(requiredDate("Date of appointment").safeParse("").error.issues[0].message, /Date of appointment is required/));
test("required date: garbage -> 'not a valid date'", () => assert.match(requiredDate("X").safeParse("banana").error.issues[0].message, /not a valid date/));
test("a year typo (0202) is caught", () => assert.ok(!requiredDate("X").safeParse("0202-05-01").success));
test("optional date: blank -> undefined", () => assert.strictEqual(optionalDate("X").parse(""), undefined));
test("clearable: '' and null clear, missing leaves alone", () => {
  const s = z.object({ r: clearableDate("R") });
  assert.strictEqual(s.parse({ r: "" }).r, null);
  assert.strictEqual(s.parse({ r: null }).r, null);
  assert.strictEqual(s.parse({}).r, undefined);
  assert.ok(s.parse({ r: "2027-01-01" }).r instanceof Date);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
