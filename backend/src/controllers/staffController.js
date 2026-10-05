const bcrypt = require("bcryptjs");
const { defaultPermissionsForRole } = require("../utils/rolePermissions");
const { z } = require("zod");
const prisma = require("../config/db");
const { recordAudit } = require("../utils/audit");
const { resolveLocation, areaScope, httpError } = require("../utils/geography");
const { toPublicUser } = require("./authController");

// HTML forms send "" for every blank field. z.string().uuid().optional()
// rejects "" (it's neither absent nor a valid id), which made EVERY staff
// creation by a County Director fail: the Director's form hides the county
// picker, so countyId always arrived as "". Blank strings now count as absent.
const blankToUndefined = (schema) => z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);

const createStaffSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["NATIONAL_ADMIN", "DIRECTOR", "SUBCOUNTY_OFFICER", "FIELD_OFFICER", "COOPERATIVE_MANAGER"]),
  countyId: blankToUndefined(z.string().uuid().optional()),
  cooperativeId: blankToUndefined(z.string().uuid().optional()),
  jobGroup: blankToUndefined(z.string().optional()),
  designation: blankToUndefined(z.string().optional()),
  phoneNumber: blankToUndefined(z.string().optional()),
  subCounty: blankToUndefined(z.string().optional()),
  ward: blankToUndefined(z.string().optional()),
  subCountyId: blankToUndefined(z.string().uuid().optional()),
  wardId: blankToUndefined(z.string().uuid().optional()),
  reportsToId: blankToUndefined(z.string().uuid().optional()),
});

const updateStaffSchema = createStaffSchema.partial().omit({ password: true });

const permissionSchema = z.object({
  module: z.string().min(1),
  canView: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canApprove: z.boolean().optional(),
});

async function listStaff(req, res) {
  // Directors see their county's staff; a Sub-County Officer sees the staff
  // in their own sub-county; the National Admin can filter by county.
  const scope = areaScope(req.user);
  const countyId = scope.countyId || req.query.countyId;
  const { subCountyId, wardId } = req.query;
  if (scope.subCountyId && subCountyId && subCountyId !== scope.subCountyId) {
    throw httpError(403, "You can only view your own sub-county");
  }
  const staff = await prisma.user.findMany({
    where: {
      ...(countyId ? { countyId } : {}),
      ...(scope.subCountyId ? { subCountyId: scope.subCountyId } : subCountyId ? { subCountyId } : {}),
      ...(wardId ? { wardId } : {}),
    },
    include: {
      permissions: true,
      county: { select: { id: true, name: true } },
      reportsTo: { select: { id: true, fullName: true } },
      managedCoops: { select: { id: true, name: true } },
    },
    orderBy: { fullName: "asc" },
  });
  res.json(staff.map(toPublicUser));
}

async function getStaff(req, res) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { permissions: true },
  });
  res.json(toPublicUser(user));
}

async function createStaff(req, res) {
  const data = createStaffSchema.parse(req.body);

  // A County Director can only create staff within their own county; only a
  // NATIONAL_ADMIN may create staff for an arbitrary county (or another
  // NATIONAL_ADMIN / DIRECTOR account).
  const countyId = req.user.role === "NATIONAL_ADMIN" ? data.countyId : req.user.countyId;

  if (req.user.role === "DIRECTOR" && ["NATIONAL_ADMIN", "DIRECTOR"].includes(data.role)) {
    return res.status(403).json({ error: "Only a National Admin can create Director or National Admin accounts" });
  }
  if (data.role !== "NATIONAL_ADMIN" && !countyId) {
    return res.status(400).json({ error: "Select a county for this staff member" });
  }

  // A Cooperative Manager must be tied to exactly one cooperative in their
  // own county that doesn't already have a manager. Without this link they
  // could log in but every cooperative page returned "You do not manage this
  // cooperative".
  let cooperative = null;
  if (data.role === "COOPERATIVE_MANAGER") {
    if (!data.cooperativeId) {
      return res.status(400).json({ error: "Select the cooperative this manager will run" });
    }
    cooperative = await prisma.cooperative.findUnique({ where: { id: data.cooperativeId } });
    if (!cooperative) return res.status(404).json({ error: "Cooperative not found" });
    if (cooperative.countyId !== countyId) {
      return res.status(400).json({ error: "That cooperative is in a different county from this staff member" });
    }
    if (cooperative.managerId) {
      return res.status(409).json({ error: "That cooperative already has a manager. Deactivate or reassign them first." });
    }
  }

  const location = countyId
    ? await resolveLocation({ countyId, subCountyId: data.subCountyId, wardId: data.wardId, subCounty: data.subCounty, ward: data.ward })
    : {};
  // A Sub-County Officer's sub-county is what decides what they can see, so
  // it's required for that role.
  if (data.role === "SUBCOUNTY_OFFICER" && !location.subCountyId) {
    throw httpError(400, "Choose the sub-county this officer covers");
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      fullName: data.fullName,
      email: data.email,
      passwordHash,
      role: data.role,
      countyId,
      jobGroup: data.jobGroup,
      designation: data.designation,
      phoneNumber: data.phoneNumber,
      subCounty: location.subCounty ?? data.subCounty,
      ward: location.ward ?? data.ward,
      subCountyId: location.subCountyId,
      wardId: location.wardId,
      reportsToId: data.reportsToId,
      // Role defaults, so a new Sub-County Officer / Field Officer /
      // Cooperative Manager can actually use the system on first login.
      permissions: { create: defaultPermissionsForRole(data.role) },
    },
  });

  if (cooperative) {
    await prisma.cooperative.update({ where: { id: cooperative.id }, data: { managerId: user.id } });
  }

  await recordAudit({
    userId: req.user.id,
    action: "CREATE_STAFF",
    entityType: "User",
    entityId: user.id,
    metadata: { role: data.role, cooperativeId: cooperative?.id },
  });

  res.status(201).json(toPublicUser(user));
}

async function updateStaff(req, res) {
  const { cooperativeId, ...data } = updateStaffSchema.parse(req.body);

  // cooperativeId isn't a User column, so it's handled separately: it
  // (re)assigns an existing Cooperative Manager to a cooperative. This is how
  // a Director fixes a manager account that was created before managers were
  // linked automatically.
  if (cooperativeId) {
    const target = req.targetStaff || (await prisma.user.findUnique({ where: { id: req.params.id } }));
    if (target.role !== "COOPERATIVE_MANAGER") {
      return res.status(400).json({ error: "Only a Cooperative Manager can be assigned to a cooperative" });
    }
    const coop = await prisma.cooperative.findUnique({ where: { id: cooperativeId } });
    if (!coop) return res.status(404).json({ error: "Cooperative not found" });
    if (coop.countyId !== target.countyId) {
      return res.status(400).json({ error: "That cooperative is in a different county from this manager" });
    }
    if (coop.managerId && coop.managerId !== target.id) {
      return res.status(409).json({ error: "That cooperative already has a different manager" });
    }
    await prisma.cooperative.update({ where: { id: coop.id }, data: { managerId: target.id } });
  }

  if (["subCountyId", "wardId", "subCounty", "ward"].some((k) => data[k] !== undefined)) {
    const target = req.targetStaff || (await prisma.user.findUnique({ where: { id: req.params.id } }));
    const { subCountyId, wardId, subCounty, ward, ...restData } = data;
    const location = await resolveLocation({ countyId: data.countyId || target.countyId, subCountyId, wardId, subCounty, ward });
    Object.keys(data).forEach((k) => delete data[k]);
    Object.assign(data, restData, location);
  }

  const user = Object.keys(data).length
    ? await prisma.user.update({ where: { id: req.params.id }, data })
    : await prisma.user.findUnique({ where: { id: req.params.id } });

  await recordAudit({
    userId: req.user.id,
    action: "UPDATE_STAFF",
    entityType: "User",
    entityId: user.id,
    metadata: { ...data, ...(cooperativeId ? { cooperativeId } : {}) },
  });

  res.json(toPublicUser(user));
}

async function deactivateStaff(req, res) {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { active: false },
  });

  await recordAudit({
    userId: req.user.id,
    action: "DEACTIVATE_STAFF",
    entityType: "User",
    entityId: user.id,
  });

  res.json(toPublicUser(user));
}

async function setPermission(req, res) {
  const data = permissionSchema.parse(req.body);
  const permission = await prisma.permission.upsert({
    where: { userId_module: { userId: req.params.id, module: data.module } },
    update: data,
    create: { userId: req.params.id, ...data },
  });

  await recordAudit({
    userId: req.user.id,
    action: "SET_PERMISSION",
    entityType: "Permission",
    entityId: permission.id,
    metadata: data,
  });

  res.status(201).json(permission);
}

module.exports = {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deactivateStaff,
  setPermission,
};
