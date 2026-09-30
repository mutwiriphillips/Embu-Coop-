const { ZodError } = require("zod");
const { Prisma } = require("@prisma/client");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    // Name the field that failed, so the user sees something actionable
    // instead of a bare "Validation failed".
    const first = err.errors?.[0];
    const field = first?.path?.join(".") || "input";
    return res.status(400).json({ error: `Validation failed on "${field}": ${first?.message || "invalid value"}`, details: err.errors });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "A record with this unique value already exists", fields: err.meta?.target });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Record not found" });
    }
  }

  console.error(err);
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || "Internal server error" });
}

module.exports = errorHandler;
