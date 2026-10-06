const prisma = require("../config/db");
const { SUB_COUNTIES, WARDS, FORMER_PARENT } = require("../data/kenyaGeography");
const { syncReference } = require("./geographySync");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Make sure a county's sub-counties and wards exist in the database. Called
 * lazily by the dropdown endpoints, so a fresh deploy (or a county nobody has
 * opened yet) fills itself in on first use, the same self-healing approach as
 * the county list. Matches by official code: idempotent, never deletes, and
 * never duplicates. Normally a single count query. (Wards that move between
 * sub-counties are handled at server start-up by reconcileGeography.)
 */
async function ensureCountyGeography(countyId) {
  const county = await prisma.county.findUnique({ where: { id: countyId } });
  if (!county) throw httpError(404, "County not found");
  const countyCode = Number(county.code);
  const expectedSubs = SUB_COUNTIES.filter(([, cc]) => cc === countyCode);
  const have = await prisma.subCounty.count({ where: { countyId } });
  if (have >= expectedSubs.length) return county;
  await syncReference(prisma);
  return county;
}

// Match a free-text name (from older records or older API clients) to the
// reference list, including known alternative spellings.
function matchSubCountyCode(countyCode, text) {
  const t = norm(text);
  if (!t) return null;
  const hit = SUB_COUNTIES.find(([, cc, name]) => cc === countyCode && norm(name) === t);
  return hit ? hit[0] : null;
}
const wardNameMatches = (t) => ([, , name, aliases]) => norm(name) === t || (aliases || []).some((a) => norm(a) === t);
function matchWardCode(subCountyCode, text) {
  const t = norm(text);
  if (!t) return null;
  const hit = WARDS.find((w) => w[1] === subCountyCode && wardNameMatches(t)(w));
  return hit ? hit[0] : null;
}

/**
 * Match free text for a sub-county and ward to official codes. If the ward
 * has since moved to a newer sub-county (e.g. "Mbeere South" + "Mwea" now
 * belongs to Mwea Sub-County), the ward's current sub-county is returned, so
 * the record lands where the ward actually is.
 * Returns { subCountyCode, wardCode } (either may be null).
 */
function matchTextLocation(countyCode, subText, wardText) {
  const subCountyCode = matchSubCountyCode(countyCode, subText);
  if (!subCountyCode) return { subCountyCode: null, wardCode: null };
  const t = norm(wardText);
  if (!t) return { subCountyCode, wardCode: null };
  const direct = matchWardCode(subCountyCode, wardText);
  if (direct) return { subCountyCode, wardCode: direct };
  const moved = WARDS.find((w) => FORMER_PARENT[w[0]] === subCountyCode && wardNameMatches(t)(w));
  if (moved) return { subCountyCode: moved[1], wardCode: moved[0] };
  return { subCountyCode, wardCode: null };
}

/**
 * Turn whatever location a form or API client sent into a consistent set of
 * fields to store. Structured ids (from the dropdowns) win; the matching text
 * names are written alongside them so every existing screen that reads the
 * text fields keeps working. If only text was sent (older clients), it's
 * matched to the reference list where possible.
 *
 * Rejects a sub-county from another county, or a ward from another
 * sub-county, so a record can never claim an impossible location.
 */
async function resolveLocation({ countyId, subCountyId, wardId, subCounty, ward }) {
  const out = {};
  if (!countyId) return out;

  if (wardId && !subCountyId) {
    const w = await prisma.ward.findUnique({ where: { id: wardId } });
    if (!w) throw httpError(400, "Unknown ward");
    subCountyId = w.subCountyId;
  }

  if (subCountyId) {
    const sc = await prisma.subCounty.findUnique({ where: { id: subCountyId } });
    if (!sc || sc.countyId !== countyId) throw httpError(400, "That sub-county is not in the selected county");
    out.subCountyId = sc.id;
    out.subCounty = sc.name;
    if (wardId) {
      const w = await prisma.ward.findUnique({ where: { id: wardId } });
      if (!w || w.subCountyId !== sc.id) throw httpError(400, "That ward is not in the selected sub-county");
      out.wardId = w.id;
      out.ward = w.name;
    }
    return out;
  }

  // Text only: keep the text exactly as sent, and link it if it matches.
  if (subCounty !== undefined) out.subCounty = subCounty;
  if (ward !== undefined) out.ward = ward;
  if (subCounty) {
    const county = await ensureCountyGeography(countyId);
    const { subCountyCode, wardCode } = matchTextLocation(Number(county.code), subCounty, ward);
    if (subCountyCode) {
      const sc = await prisma.subCounty.findUnique({ where: { code: subCountyCode } });
      if (sc) {
        out.subCountyId = sc.id;
        // The ward moved to a newer sub-county: store the name it's under now.
        if (norm(sc.name) !== norm(subCounty)) out.subCounty = sc.name;
      }
      if (wardCode && sc) {
        const w = await prisma.ward.findUnique({ where: { code: wardCode } });
        if (w && w.subCountyId === sc.id) out.wardId = w.id;
      }
    }
  }
  return out;
}

/**
 * The single rule for "which part of the country may this staff member see".
 *   NATIONAL_ADMIN                   -> everything
 *   DIRECTOR, FIELD_OFFICER          -> their own county
 *   SUBCOUNTY_OFFICER with a sub-county assigned -> only that sub-county
 *   SUBCOUNTY_OFFICER not yet assigned           -> their county (and the
 *     Staff page flags them so a Director assigns one)
 * Returns a Prisma `where` fragment for any model carrying countyId and
 * subCountyId (Cooperative, AgrovetShop, User).
 */
function areaScope(user) {
  if (!user || user.role === "NATIONAL_ADMIN") return {};
  if (user.role === "SUBCOUNTY_OFFICER" && user.subCountyId) {
    return { countyId: user.countyId, subCountyId: user.subCountyId };
  }
  return { countyId: user.countyId };
}

// Does a record (anything with countyId/subCountyId) fall inside the user's area?
function inArea(user, record) {
  const scope = areaScope(user);
  return Object.entries(scope).every(([k, v]) => record[k] === v);
}

module.exports = { ensureCountyGeography, resolveLocation, areaScope, inArea, matchSubCountyCode, matchWardCode, matchTextLocation, httpError, norm };
