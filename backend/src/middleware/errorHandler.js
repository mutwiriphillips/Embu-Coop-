const { ZodError } = require("zod");
const { Prisma } = require("@prisma/client");
const multer = require("multer");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Upload problems (too large, too many files) are the user's to fix, not a
  // server crash, so they get a plain 400 explaining what went wrong.
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "That file is too large. The limit is 10 MB (5 MB for photos).",
      LIMIT_FILE_COUNT: "Too many files in one go. Upload at most 5.",
      LIMIT_UNEXPECTED_FILE: "That file was sent in the wrong field.",
    };
    return res.status(400).json({ error: messages[err.code] || "The upload couldn't be processed." });
  }

  if (err instanceof ZodError) {
    // Name the field that failed, so the user sees something actionable
    // instead of a bare "Validation failed".
    const first = err.errors?.[0];
    // "members.1.phoneNumber" reads better as "members › row 2 › phoneNumber".
    const field = first?.path?.map((p) => (typeof p === "number" ? `row ${p + 1}` : p)).join(" › ") || "input";
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
