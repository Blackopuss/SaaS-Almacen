-- VAL-06 (ADR 0031): los productos que ya tenían un último costo de compra
-- (ADR 0017) arrancan con él como costo promedio. Solo inserta filas nuevas
-- de product_cost: no toca ninguna que ya exista (las escritas por
-- movimientos posteriores a VAL-02 mandan). Costo por unidad del producto
-- = último costo ÷ contenido de la presentación con la que se compró. Si un
-- producto tiene varios proveedores, gana el costo más reciente.
INSERT INTO `product_cost` (`id`, `organizationId`, `productId`, `averageCost`, `stockValue`, `updatedAt`)
SELECT
  UUID(),
  latest.`organizationId`,
  latest.`productId`,
  latest.`unitCost`,
  ROUND(COALESCE(stock.`quantity`, 0) * latest.`unitCost`, 6),
  CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    ps.`organizationId`,
    ps.`productId`,
    ROUND(ps.`lastCost` / COALESCE(pv.`factor`, 1), 6) AS `unitCost`,
    ROW_NUMBER() OVER (
      PARTITION BY ps.`organizationId`, ps.`productId`
      ORDER BY ps.`lastCostAt` DESC, ps.`id` DESC
    ) AS `position`
  FROM `product_supplier` ps
  LEFT JOIN `presentation_version` pv
    ON pv.`organizationId` = ps.`organizationId`
    AND pv.`id` = ps.`lastCostPresentationVersionId`
  WHERE ps.`lastCost` IS NOT NULL
) latest
LEFT JOIN (
  SELECT `organizationId`, `productId`, SUM(`quantity`) AS `quantity`
  FROM `stock_balance`
  GROUP BY `organizationId`, `productId`
) stock
  ON stock.`organizationId` = latest.`organizationId`
  AND stock.`productId` = latest.`productId`
WHERE latest.`position` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `product_cost` pc
    WHERE pc.`organizationId` = latest.`organizationId`
      AND pc.`productId` = latest.`productId`
  );
