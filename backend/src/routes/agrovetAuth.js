const express = require("express");
const { apply, login, me } = require("../controllers/agrovetAuthController");
const { authenticateAgrovet } = require("../middleware/auth");
const { upload } = require("../utils/fileStorage");

const router = express.Router();

// multipart (with optional shopPhoto / permit) or plain JSON both work
router.post("/apply", upload.fields([{ name: "shopPhoto", maxCount: 1 }, { name: "permit", maxCount: 1 }]), apply);
router.post("/login", login);
router.get("/me", authenticateAgrovet, me);

module.exports = router;
