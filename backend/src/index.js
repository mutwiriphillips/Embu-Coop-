require("dotenv").config();
require("express-async-errors");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const staffRoutes = require("./routes/staff");
const cooperativeRoutes = require("./routes/cooperatives");
const documentRoutes = require("./routes/documents");
const governanceRoutes = require("./routes/governance");
const fieldOpsRoutes = require("./routes/fieldOps");
const countyRoutes = require("./routes/counties");
const contributionRoutes = require("./routes/contributions");
const creditAssessmentRoutes = require("./routes/creditAssessment");
const produceRoutes = require("./routes/produce");
const payoutRoutes = require("./routes/payouts");
const assetRoutes = require("./routes/assets");
const reportsRoutes = require("./routes/reports");
const factoryRoutes = require("./routes/factories");
const memberAuthRoutes = require("./routes/memberAuth");
const memberRoutes = require("./routes/member");
const inputCreditRoutes = require("./routes/inputCredits");
const agrovetAuthRoutes = require("./routes/agrovetAuth");
const cooperativeAuthRoutes = require("./routes/cooperativeAuth");
const fileRoutes = require("./routes/files");
const agrovetSelfRoutes = require("./routes/agrovetSelf");
const agrovetRoutes = require("./routes/agrovets");
const staffDirectoryRoutes = require("./routes/staffDirectory");
const adminRoutes = require("./routes/admin");
const errorHandler = require("./middleware/errorHandler");

// Refuse to run in production with a missing or guessable signing secret.
if (process.env.NODE_ENV === "production" && (process.env.JWT_SECRET || "").length < 32) {
  console.error("FATAL: JWT_SECRET must be set to a random value of at least 32 characters.");
  process.exit(1);
}

const app = express();

// Behind Render's proxy the client's address arrives in X-Forwarded-For. Without
// this every visitor looked like the same IP, so rate limits were shared by
// everyone and could not tell an attacker from a user. Set TRUST_PROXY_HOPS=0
// when running without a proxy.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Sign-in brute-force protection: failed attempts per IP + account, and a
// looser cap per IP to stop one address trying many accounts. Successful
// sign-ins are not counted.
const identifierOf = (req) => String((req.body && (req.body.email || req.body.identifier || req.body.nationalId || (req.body.mfaToken ? "mfa:" + String(req.body.mfaToken).slice(-24) : ""))) || "").trim().toLowerCase().slice(0, 120);
const tooMany = { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
const LOGIN_PATHS = ["/api/auth/login", "/api/auth/mfa/verify", "/api/cooperative-auth/login", "/api/member-auth/login", "/api/agrovet-auth/login"];
app.use(LOGIN_PATHS, rateLimit({
  windowMs: 15 * 60 * 1000, max: 8, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${identifierOf(req)}`, message: tooMany,
}));
app.use(LOGIN_PATHS, rateLimit({
  windowMs: 15 * 60 * 1000, max: 40, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: tooMany,
}));
// Public sign-up style endpoints and password changes.
app.use(["/api/auth/signup", "/api/member-auth/register", "/api/agrovet-auth/apply", "/api/auth/change-password"], rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests from this address. Please try again later." },
}));

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "embu-coop-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/counties", countyRoutes);
app.use("/api/cooperatives", cooperativeRoutes);
// Nested resources under a cooperative
app.use("/api/cooperatives/:id/documents", documentRoutes);
app.use("/api/cooperatives/:id/governance", governanceRoutes);
app.use("/api/cooperatives/:id/contributions", contributionRoutes);
app.use("/api/cooperatives/:id/credit-assessment", creditAssessmentRoutes);
app.use("/api/cooperatives/:id/produce", produceRoutes);
app.use("/api/cooperatives/:id/payouts", payoutRoutes);
app.use("/api/cooperatives/:id/assets", assetRoutes);
app.use("/api/cooperatives/:id/input-credits", inputCreditRoutes);
app.use("/api/field-ops", fieldOpsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/factories", factoryRoutes);
app.use("/api/member-auth", memberAuthRoutes);
app.use("/api/member", memberRoutes);
app.use("/api/agrovet-auth", agrovetAuthRoutes);
app.use("/api/cooperative-auth", cooperativeAuthRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/agrovet", agrovetSelfRoutes);
app.use("/api/agrovets", agrovetRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/staff-directory", staffDirectoryRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Embu Coop backend listening on port ${PORT}`);
  // Bring sub-counties/wards in line with the reference data (e.g. the gazetted
  // Mwea Sub-County, Embu) and keep every record's sub-county matching its
  // ward. Does nothing when everything already matches; never deletes. Runs in
  // the background so it can't delay start-up, and a failure is only logged.
  // Set GEO_AUTO_SYNC=false to switch it off (then run `npm run geo:sync`).
  if (process.env.GEO_AUTO_SYNC !== "false") {
    const prisma = require("./config/db");
    require("./utils/geographySync")
      .reconcileGeography(prisma)
      .catch((e) => console.error("[geography] start-up sync failed (the app is unaffected; run npm run geo:sync):", e.message));
  }
});

module.exports = app;
