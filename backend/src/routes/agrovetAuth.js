const express = require("express");
const { apply, login, me } = require("../controllers/agrovetAuthController");
const { authenticateAgrovet } = require("../middleware/auth");

const router = express.Router();

router.post("/apply", apply);
router.post("/login", login);
router.get("/me", authenticateAgrovet, me);

module.exports = router;
