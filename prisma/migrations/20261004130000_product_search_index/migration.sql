-- Lista y búsqueda de productos (INV-10/11): el orden por nombre y las tres
-- columnas en las que se busca (nombre, clave y código de barras) viven en
-- un solo índice. MySQL filtra dentro del índice y solo lee de la tabla las
-- filas de la página. Se crea el nuevo antes de quitar el anterior, que
-- queda contenido en él.
CREATE INDEX `product_organizationId_status_name_sku_barcode_idx` ON `product`(`organizationId`, `status`, `name`, `sku`, `barcode`);

DROP INDEX `product_organizationId_status_name_idx` ON `product`;
