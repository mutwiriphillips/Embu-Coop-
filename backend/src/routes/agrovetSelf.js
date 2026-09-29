const express = require("express");
const { authenticateAgrovet, requireApprovedShop } = require("../middleware/auth");
const products = require("../controllers/inputProductController");
const collections = require("../controllers/inputCollectionController");

// Mounted at /api/agrovet — every route here acts on "my own shop" only,
// derived from the verified token, never from a client-supplied ID.
const router = express.Router();
router.use(authenticateAgrovet);

// Catalog management — requires approval, since an unapproved shop has no
// business publishing prices yet.
router.get("/products", requireApprovedShop(), products.listProducts);
router.post("/products", requireApprovedShop(), products.addProduct);
router.patch("/products/:productId", requireApprovedShop(), products.updateProduct);
router.patch("/products/:productId/deactivate", requireApprovedShop(), products.deactivateProduct);

// Point of sale — also requires approval.
router.get("/farmer-lookup", requireApprovedShop(), collections.farmerLookup);
router.post("/collections", requireApprovedShop(), collections.recordCollection);
router.get("/collections", requireApprovedShop(), collections.listShopCollections);

module.exports = router;
