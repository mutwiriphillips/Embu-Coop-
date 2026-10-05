const prisma = require("../config/db");
const { inArea, httpError } = require("../utils/geography");
const { FILE_LIST_SELECT } = require("../utils/fileStorage");

/**
 * The one access rule for every stored file, based on what the file belongs to:
 *  - Agrovet shop files: that shop's own owner, or county staff whose area
 *    covers the shop (never cooperative managers, never other counties).
 *  - Cooperative files (documents, AGM papers, asset and visit photos): the
 *    cooperative's own manager, or county staff whose area covers it.
 *  - National Admin: everything.
 */
async function canAccess(req, scope) {
  if (req.agrovetShop) {
    return Boolean(scope.agrovetShopId) && scope.agrovetShopId === req.agrovetShop.id;
  }
  const user = req.user;
  if (!user) return false;
  if (user.role === "NATIONAL_ADMIN") return true;

  if (scope.agrovetShopId) {
    if (user.role === "COOPERATIVE_MANAGER") return false;
    const shop = await prisma.agrovetShop.findUnique({ where: { id: scope.agrovetShopId } });
    return Boolean(shop) && shop.countyId === user.countyId && inArea(user, shop);
  }
  if (scope.cooperativeId) {
    const coop = await prisma.cooperative.findUnique({ where: { id: scope.cooperativeId } });
    if (!coop) return false;
    if (user.role === "COOPERATIVE_MANAGER") return coop.managerId === user.id;
    return coop.countyId === user.countyId && inArea(user, coop);
  }
  return false;
}

// GET /api/files/:id: streams the file to someone allowed to see it.
async function download(req, res) {
  const file = await prisma.storedFile.findUnique({ where: { id: req.params.id } });
  if (!file || !(await canAccess(req, file))) {
    // Same answer whether it doesn't exist or isn't theirs: no probing for ids.
    throw httpError(404, "File not found");
  }
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  res.set({
    "Content-Type": file.mimeType,
    "Content-Length": String(data.length),
    "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${file.fileName}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  res.send(data);
}

// GET /api/files?agrovetShopId=|assetId=|visitId=|cooperativeId= [&purpose=]
// File metadata (never the bytes) for one record, after the same access check.
async function list(req, res) {
  const { agrovetShopId, assetId, visitId, cooperativeId, purpose } = req.query;
  let scope;
  if (agrovetShopId) scope = { agrovetShopId };
  else if (assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw httpError(404, "Not found");
    scope = { cooperativeId: asset.cooperativeId };
  } else if (visitId) {
    const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw httpError(404, "Not found");
    scope = { cooperativeId: visit.cooperativeId };
  } else if (cooperativeId) scope = { cooperativeId };
  else throw httpError(400, "Say which record's files you want");

  if (!(await canAccess(req, scope))) throw httpError(404, "Not found");
  const files = await prisma.storedFile.findMany({
    where: { ...(agrovetShopId ? { agrovetShopId } : {}), ...(assetId ? { assetId } : {}), ...(visitId ? { visitId } : {}), ...(cooperativeId ? { cooperativeId } : {}), ...(purpose ? { purpose } : {}) },
    select: FILE_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });
  res.json(files);
}

module.exports = { download, list, canAccess };
