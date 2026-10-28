import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// PLT-15: every server action is an HTTP endpoint anyone can call with any
// body. Each one is reviewed here: what it takes from the client, where
// the user/company come from, and which test proves it cannot reach other
// people's data. A new action fails this test until it is added.

type Review = {
  /** What the client can send. */
  input: string;
  /** Where the account/company used by the action come from. */
  identity: string;
  /** Test that covers the cross-account / cross-company case. */
  coveredBy: string;
};

const REVIEWED: Record<string, Review> = {
  openCashAction: {
    input: "efectivo con el que se abre la caja",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la caja se abre a nombre de esa persona en esa empresa",
    coveredBy: "tests/sales/cash.int.test.ts",
  },
  cashMovementAction: {
    input: "si entra o sale dinero, importe y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo en la caja abierta de esa persona",
    coveredBy: "tests/sales/cash.int.test.ts",
  },
  closeCashAction: {
    input: "id de la caja y lo contado por forma de pago",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la caja se busca y se bloquea solo en esa empresa",
    coveredBy: "tests/sales/cash.int.test.ts",
  },
  findQuoteProductsAction: {
    input: "texto buscado (nombre, clave o código de barras)",
    identity:
      "sesión y empresa activa (getModuleAccess); solo busca productos de esa empresa",
    coveredBy: "tests/sales/quotes.int.test.ts",
  },
  loadQuoteProductAction: {
    input: "id del producto",
    identity:
      "sesión y empresa activa (getModuleAccess); el producto se busca solo en esa empresa",
    coveredBy: "tests/sales/quotes.int.test.ts",
  },
  previewQuoteAction: {
    input: "líneas (id de producto, presentación y cantidad) y descuento",
    identity:
      "sesión y empresa activa (getModuleAccess); precios de esa empresa",
    coveredBy: "tests/sales/quotes.int.test.ts",
  },
  saveQuoteAction: {
    input:
      "id de la cotización (al editar), cliente, vigencia, notas, descuento y líneas",
    identity:
      "sesión y empresa activa (requireOrganizationContext); cotización, cliente y productos se buscan solo en esa empresa",
    coveredBy: "tests/sales/quotes.int.test.ts",
  },
  sendQuoteAction: {
    input: "id de la cotización",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la cotización se bloquea solo en esa empresa y el correo sale de la ficha del cliente",
    coveredBy: "tests/sales/quote-delivery.int.test.ts",
  },
  setQuoteCustomerEmailAction: {
    input: "id de la cotización y el correo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el cliente es el de la cotización, buscada solo en esa empresa",
    coveredBy: "tests/sales/quote-delivery.int.test.ts",
  },
  changeQuoteStatusAction: {
    input:
      "id de la cotización, el estado al que pasa y el motivo de un rechazo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la cotización se bloquea solo en esa empresa",
    coveredBy: "tests/sales/quote-status.int.test.ts",
  },
  cancelOrderAction: {
    input: "id del pedido y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el pedido se bloquea solo en esa empresa",
    coveredBy: "tests/sales/order-fulfillment.int.test.ts",
  },
  previewFulfillmentAction: {
    input:
      "id del pedido, líneas (id de línea, cantidad, ubicación) y pagos tecleados",
    identity:
      "sesión y empresa activa (getModuleAccess); el pedido se busca solo en esa empresa y no escribe nada",
    coveredBy: "tests/sales/order-fulfillment.int.test.ts",
  },
  fulfillOrderAction: {
    input:
      "id del pedido, líneas (id de línea, cantidad, ubicación), pagos y clave",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el pedido y la caja se bloquean solo en esa empresa y la caja es la de quien cobra",
    coveredBy: "tests/sales/order-fulfillment.int.test.ts",
  },
  convertQuoteAction: {
    input: "id de la cotización",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la cotización se bloquea solo en esa empresa",
    coveredBy: "tests/sales/sales-orders.int.test.ts",
  },
  returnSaleAction: {
    input:
      "id de la venta, cantidades por línea, motivo, forma de reembolso y referencia",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la venta se busca y se bloquea solo en esa empresa",
    coveredBy: "tests/sales/returns.int.test.ts",
  },
  cancelSaleAction: {
    input: "id de la venta, motivo, forma de reembolso y referencia",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la venta se busca y se bloquea solo en esa empresa",
    coveredBy: "tests/sales/returns.int.test.ts",
  },
  checkSaleReturnAction: {
    input: "clave de confirmación",
    identity:
      "sesión y empresa activa (getModuleAccess); solo encuentra devoluciones de esa persona en esa empresa",
    coveredBy: "tests/sales/returns.int.test.ts",
  },
  authorizeDiscountAction: {
    input: "id de quien autoriza, su contraseña, porcentaje y motivo",
    identity:
      "sesión y empresa activa (getModuleAccess) para quien cobra; quien autoriza se busca entre los miembros activos de esa empresa y su contraseña se verifica con límite de intentos",
    coveredBy: "tests/sales/discounts.int.test.ts",
  },
  registerSaleAction: {
    input:
      "líneas (id de producto, presentación, cantidad tecleada, ubicación), id de cliente, pagos tecleados y clave de confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); productos, ubicaciones y cliente se buscan solo en esa empresa; precios, IVA y cambio los calcula el servidor",
    coveredBy: "tests/sales/sale.int.test.ts",
  },
  checkSaleAction: {
    input: "clave de confirmación",
    identity:
      "sesión y empresa activa (getModuleAccess); solo encuentra ventas de esa persona en esa empresa",
    coveredBy: "tests/sales/sale.int.test.ts",
  },
  findCustomersAction: {
    input: "texto buscado (nombre, teléfono o RFC)",
    identity:
      "sesión y empresa activa (getModuleAccess); solo lee clientes de esa empresa",
    coveredBy: "tests/sales/customers.int.test.ts",
  },
  createCustomerAction: {
    input: "nombre, teléfono y RFC del cliente; si acepta un posible duplicado",
    identity:
      "sesión y empresa activa (getModuleAccess); el cliente se crea en esa empresa a nombre de esa persona",
    coveredBy: "tests/sales/customers.int.test.ts",
  },
  findSaleProductsAction: {
    input: "texto buscado (nombre, clave o código de barras)",
    identity:
      "sesión y empresa activa (getModuleAccess); solo lee productos de esa empresa",
    coveredBy: "tests/sales/cart.int.test.ts",
  },
  loadSaleProductAction: {
    input: "id de producto",
    identity:
      "sesión y empresa activa (getModuleAccess); el producto se busca solo en esa empresa",
    coveredBy: "tests/sales/cart.int.test.ts",
  },
  quoteSaleAction: {
    input:
      "líneas del carrito: id de producto, presentación, cantidad tecleada y ubicación",
    identity:
      "sesión y empresa activa (getModuleAccess); productos, precios e IVA se leen solo de esa empresa; solo lee",
    coveredBy: "tests/sales/cart.int.test.ts",
  },
  updateSalesSettingsAction: {
    input: "modo de IVA (incluido o sumado) y tasa",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo el titular (assertOwnerAction) y solo para su empresa",
    coveredBy: "tests/sales/settings.int.test.ts",
  },
  setSalePricesAction: {
    input: "id de producto y precio de la unidad y de cada presentación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto y sus presentaciones se buscan solo en esa empresa",
    coveredBy: "tests/sales/prices.int.test.ts",
  },
  receivePurchaseOrderAction: {
    input: "id de orden, id de ubicación, remisión y clave de confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden y la ubicación se buscan solo en esa empresa",
    coveredBy: "tests/purchasing/receipts.int.test.ts",
  },
  checkReceiptAction: {
    input: "clave de confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo encuentra recepciones de esa persona en esa empresa",
    coveredBy: "tests/purchasing/receipts.int.test.ts",
  },
  sendPurchaseOrderAction: {
    input: "id de orden",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden se busca solo en esa empresa y el destinatario sale de la ficha del proveedor, nunca del navegador",
    coveredBy: "tests/purchasing/order-delivery.int.test.ts",
  },
  submitPurchaseOrderAction: {
    input: "id de orden",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden se busca solo en esa empresa",
    coveredBy: "tests/purchasing/order-transitions.int.test.ts",
  },
  cancelPurchaseOrderAction: {
    input: "id de orden y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden se busca solo en esa empresa",
    coveredBy: "tests/purchasing/order-transitions.int.test.ts",
  },
  returnToSupplierAction: {
    input:
      "id de orden, id de recepción, cantidades por línea, ubicaciones, motivo y clave de confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); recepción y ubicaciones se buscan solo en esa empresa",
    coveredBy: "tests/purchasing/returns.int.test.ts",
  },
  checkReturnAction: {
    input: "clave de confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo devoluciones de esa persona en esa empresa",
    coveredBy: "tests/purchasing/returns.int.test.ts",
  },
  generateSuggestedOrdersAction: {
    input: "ids de productos",
    identity:
      "sesión y empresa activa (requireOrganizationContext); productos, mínimos, proveedores y cantidades se calculan en el servidor solo en esa empresa",
    coveredBy: "tests/purchasing/suggestions.int.test.ts",
  },
  closePurchaseOrderAction: {
    input: "id de orden y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden se busca solo en esa empresa",
    coveredBy: "tests/purchasing/order-close.int.test.ts",
  },
  createPurchaseOrderAction: {
    input: "id de proveedor, día esperado y notas",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el proveedor se busca solo entre los de esa empresa",
    coveredBy: "tests/purchasing/orders.int.test.ts",
  },
  updatePurchaseOrderAction: {
    input: "id de orden, día esperado y notas",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la orden se busca solo en esa empresa",
    coveredBy: "tests/purchasing/orders.int.test.ts",
  },
  addOrderLineAction: {
    input: "id de orden, id de producto, forma de pedirlo, cantidad y costo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); orden, producto y presentación se buscan solo en esa empresa; el costo exige además el permiso de registrar costos",
    coveredBy: "tests/purchasing/orders.int.test.ts",
  },
  updateOrderLineAction: {
    input:
      "id de orden (solo para volver a su pantalla), id de línea, forma de pedirlo, cantidad y costo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la línea y su orden se buscan solo en esa empresa; el costo exige además el permiso de registrar costos",
    coveredBy: "tests/purchasing/orders.int.test.ts",
  },
  removeOrderLineAction: {
    input: "id de orden (solo para repintar su pantalla) e id de línea",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la línea y su orden se buscan solo en esa empresa",
    coveredBy: "tests/purchasing/orders.int.test.ts",
  },
  linkProductSupplierAction: {
    input:
      "id de proveedor, id de producto, código del proveedor e id de presentación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); proveedor, producto y presentación se buscan solo en esa empresa",
    coveredBy: "tests/purchasing/product-suppliers.int.test.ts",
  },
  updateProductSupplierAction: {
    input:
      "id de proveedor (solo para volver a su pantalla), id del vínculo, código del proveedor e id de presentación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el vínculo y la presentación se buscan solo en esa empresa",
    coveredBy: "tests/purchasing/product-suppliers.int.test.ts",
  },
  createSupplierAction: {
    input:
      "datos del proveedor (nombre, razón social, RFC, contacto, correo, teléfono, dirección, notas) y si acepta guardar un posible duplicado",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el proveedor se crea en esa empresa",
    coveredBy: "tests/platform/suppliers.int.test.ts",
  },
  updateSupplierAction: {
    input:
      "id del proveedor, sus datos y si acepta guardar un posible duplicado",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el proveedor se busca solo entre los de esa empresa",
    coveredBy: "tests/platform/suppliers.int.test.ts",
  },
  startExitImportAction: {
    input: "archivo .csv o .xlsx de salidas y separador decimal",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el archivo se guarda como privado de esa empresa",
    coveredBy: "tests/inventory/exit-import.int.test.ts",
  },
  confirmExitImportAction: {
    input: "id de importación de salidas",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la importación se busca solo en esa empresa",
    coveredBy: "tests/inventory/exit-import.int.test.ts",
  },
  cancelExitImportAction: {
    input: "id de importación de salidas",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la importación se busca solo en esa empresa",
    coveredBy: "tests/inventory/exit-import.int.test.ts",
  },
  cancelImportAction: {
    input: "id de importación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la importación se busca solo en esa empresa",
    coveredBy: "tests/inventory/import-release.int.test.ts",
  },
  confirmImportAction: {
    input: "id de importación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la importación se busca solo en esa empresa",
    coveredBy: "tests/inventory/import-confirmation.int.test.ts",
  },
  startImportAction: {
    input: "archivo .xlsx o .csv",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el archivo se guarda como privado de esa empresa",
    coveredBy: "tests/inventory/imports.int.test.ts",
  },
  saveMappingAction: {
    input:
      "id de importación, columna del archivo para cada dato y separador decimal",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la importación se busca solo en esa empresa",
    coveredBy: "tests/inventory/imports.int.test.ts",
  },
  applyCountAction: {
    input: "id de conteo y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el conteo se busca solo en esa empresa",
    coveredBy: "tests/inventory/count-apply.int.test.ts",
  },
  openCountAction: {
    input: "id de ubicación y nota",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  captureCountAction: {
    input: "id de conteo, id de producto, forma de captura y cantidad",
    identity:
      "sesión y empresa activa (requireOrganizationContext); conteo, producto y presentación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  removeCaptureAction: {
    input: "id de conteo e id de captura",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la captura se busca solo dentro de ese conteo y esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  cancelCountAction: {
    input: "id de conteo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el conteo se busca solo en esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  findCountProductsAction: {
    input: "texto de búsqueda (nombre, clave o código de barras)",
    identity:
      "sesión y empresa activa (getModuleAccess); solo lee productos de esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  loadCountProductAction: {
    input: "id de producto",
    identity:
      "sesión y empresa activa (getModuleAccess); el producto se busca solo en esa empresa",
    coveredBy: "tests/inventory/counts.int.test.ts",
  },
  setMinimumAction: {
    input: "id de producto y cantidad mínima (vacía = quitarla)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/inventory/minimums.int.test.ts",
  },
  registerQuickExitAction: {
    input:
      "líneas (id de producto, ubicación, cantidad, forma de captura), motivo, referencia y clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); productos, presentaciones y ubicaciones se buscan solo en esa empresa",
    coveredBy: "tests/inventory/quick-exit.int.test.ts",
  },
  findExitProductsAction: {
    input: "texto de búsqueda (nombre, clave o código de barras)",
    identity:
      "sesión y empresa activa (getModuleAccess); solo lee productos de esa empresa",
    coveredBy: "tests/inventory/quick-exit.int.test.ts",
  },
  loadExitProductAction: {
    input: "id de producto",
    identity:
      "sesión y empresa activa (getModuleAccess); el producto se busca solo en esa empresa",
    coveredBy: "tests/inventory/quick-exit.int.test.ts",
  },
  reverseMovementAction: {
    input: "id del movimiento, clave de la confirmación y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el movimiento se busca solo en esa empresa",
    coveredBy: "tests/inventory/reversals.int.test.ts",
  },
  registerAdjustmentAction: {
    input:
      "id de producto, ubicación, cantidad contada, forma de captura, motivo y clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/adjustments.int.test.ts",
  },
  registerTransferAction: {
    input:
      "id de producto, ubicación de origen y de destino, cantidad, forma de captura, nota y clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicaciones se buscan solo en esa empresa",
    coveredBy: "tests/inventory/transfers.int.test.ts",
  },
  checkConfirmationAction: {
    input: "clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo responde por movimientos confirmados por la misma persona",
    coveredBy: "tests/inventory/lost-answer.int.test.ts",
  },
  registerExitAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura, referencia y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/exits.int.test.ts",
  },
  registerInitialBalanceAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/initial-balance.int.test.ts",
  },
  previewEntryAction: {
    input:
      "id de producto, forma de captura (id de presentación o código de unidad) y cantidad; solo lee",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y presentación se buscan solo en esa empresa",
    coveredBy: "tests/platform/conversion.int.test.ts",
  },
  registerEntryAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura (id de presentación o código de unidad), referencia y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/entries.int.test.ts",
  },
  createLocationAction: {
    input: "nombre, tipo e id de la ubicación que la contiene",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  renameLocationAction: {
    input: "id de ubicación y nombre nuevo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  moveLocationAction: {
    input: "id de ubicación e id del destino",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  archiveLocationAction: {
    input: "id de ubicación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  restoreLocationAction: {
    input: "id de ubicación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  changePresentationFactorAction: {
    input:
      "id de producto (solo para refrescar), id de presentación y contenido nuevo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la presentación se busca solo en esa empresa",
    coveredBy: "tests/platform/presentation-versions.int.test.ts",
  },
  createPresentationAction: {
    input: "id de producto, nombre de la presentación y contenido",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/presentations.int.test.ts",
  },
  archiveProductAction: {
    input: "id de producto y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-archive.int.test.ts",
  },
  reactivateProductAction: {
    input: "id de producto",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-archive.int.test.ts",
  },
  updateProductAction: {
    input: "id de producto y los campos de la ficha (sin cantidades)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-update.int.test.ts",
  },
  createProductAction: {
    input: "clave, nombre, descripción, categoría, marca y código de barras",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el servicio comprueba rol, módulo y cupo",
    coveredBy: "tests/platform/products.int.test.ts",
  },
  provisionAction: {
    input:
      "id de empresa (cualquiera: es personal de plataforma), cupos, módulos, vigencia y motivo",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/provisioning.int.test.ts",
  },
  recordPaymentAction: {
    input:
      "id de empresa (cualquiera: es personal de plataforma), importe, día, clave de rastreo, meses y notas",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/payments.int.test.ts",
  },
  reversePaymentAction: {
    input:
      "id de empresa e id de pago (el pago se busca dentro de esa empresa) y motivo",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/payments.int.test.ts",
  },
  checkoutAction: {
    input:
      "nivel, meses, si agrega Compras, código, proveedor e intención (aplicar código o pagar); nunca importes",
    identity:
      "sesión y empresa activa (getAccess); el servicio exige al titular (assertOwnerAction), precia en el servidor y el correo del recibo sale de la sesión",
    coveredBy: "tests/platform/checkout.int.test.ts",
  },
  createPromoCodeAction: {
    input: "texto del código, % de descuento, usos máximos, último día y nota",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/checkout.int.test.ts",
  },
  disablePromoCodeAction: {
    input: "id de código",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/checkout.int.test.ts",
  },
  inviteAction: {
    input: "correo y roles",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  resendInvitationAction: {
    input: "id de invitación",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  cancelInvitationAction: {
    input: "id de invitación",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  assignRolesAction: {
    input: "id de usuario y roles",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team.int.test.ts",
  },
  disableMemberAction: {
    input: "id de usuario y motivo",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team-disable.int.test.ts",
  },
  reactivateMemberAction: {
    input: "id de usuario",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team-disable.int.test.ts",
  },
  acceptInvitationAction: {
    input: "token de la invitación",
    identity:
      "sesión (requireSession); el correo de la cuenta debe ser el invitado",
    coveredBy: "tests/platform/invitation-accept.int.test.ts",
  },
  joinAsNewUserAction: {
    input:
      "token de la invitación, nombre, contraseña y aceptación de documentos",
    identity: "el token (un solo uso, vence); el correo sale de la invitación",
    coveredBy: "tests/platform/invitation-accept.int.test.ts",
  },
  invitationSignOutAction: {
    input: "token (solo para volver a la misma pantalla)",
    identity: "sesión propia",
    coveredBy: "tests/platform/session.int.test.ts",
  },
  signInAction: {
    input: "correo y contraseña",
    identity: "ninguna sesión previa",
    coveredBy: "tests/platform/throttle.int.test.ts, session.int.test.ts",
  },
  acceptLegalAction: {
    input: "casilla de aceptación (las versiones salen del código)",
    identity: "sesión (requireSession); la persona sale de la sesión",
    coveredBy: "tests/platform/legal-acceptance.int.test.ts",
  },
  registerAction: {
    input: "nombre, correo, contraseña y aceptación de documentos",
    identity: "ninguna",
    coveredBy: "tests/platform/register.int.test.ts",
  },
  resendAction: {
    input: "correo",
    identity: "ninguna (respuesta neutral)",
    coveredBy: "tests/platform/register.int.test.ts",
  },
  recoverAction: {
    input: "correo",
    identity: "ninguna (respuesta neutral)",
    coveredBy: "tests/platform/recovery.int.test.ts",
  },
  resetAction: {
    input: "token del correo y contraseña nueva",
    identity: "el token (un solo uso, vence)",
    coveredBy: "tests/platform/recovery.int.test.ts",
  },
  verifyCodeAction: {
    input: "código y método",
    identity: "cookie firmada del desafío MFA",
    coveredBy:
      "tests/platform/mfa-challenge.int.test.ts, mfa-recovery.int.test.ts",
  },
  createOrganizationAction: {
    input: "nombre y zona horaria",
    identity: "sesión (requireSession)",
    coveredBy: "tests/platform/organizations.int.test.ts",
  },
  signOutAction: {
    input: "nada",
    identity: "sesión propia",
    coveredBy: "tests/platform/session.int.test.ts",
  },
  grantSupportAccessAction: {
    input: "nada",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo el titular (assertOwnerAction)",
    coveredBy: "tests/platform/support-access.int.test.ts",
  },
  revokeSupportAccessAction: {
    input: "nada",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo el titular (assertOwnerAction)",
    coveredBy: "tests/platform/support-access.int.test.ts",
  },
  enterSupportAction: {
    input: "id de empresa",
    identity:
      "sesión de personal de plataforma (requirePlatformStaff); entra solo si el titular de esa empresa tiene abierto el acceso, y solo a leer",
    coveredBy: "tests/platform/support-access.int.test.ts",
  },
  leaveSupportAction: {
    input: "nada",
    identity:
      "sesión propia; solo deja la empresa donde la persona no es miembro",
    coveredBy: "tests/platform/support-access.int.test.ts",
  },
  switchOrganizationAction: {
    input: "id de empresa",
    identity: "sesión; membresía activa revisada en servidor",
    coveredBy: "tests/isolation/two-companies.int.test.ts",
  },
  revokeSessionAction: {
    input: "id de sesión",
    identity: "sesión; solo sesiones del mismo usuario",
    coveredBy: "tests/isolation/two-companies.int.test.ts",
  },
  revokeOtherSessionsAction: {
    input: "nada",
    identity: "sesión propia",
    coveredBy: "tests/platform/sessions.int.test.ts",
  },
  mfaSetupAction: {
    input: "contraseña o código",
    identity: "sesión propia (allowMissingMfa solo aquí)",
    coveredBy: "tests/platform/mfa.int.test.ts",
  },
  regenerateBackupCodesAction: {
    input: "contraseña",
    identity: "sesión propia",
    coveredBy: "tests/platform/mfa-recovery.int.test.ts",
  },
  disableMfaAction: {
    input: "contraseña y código",
    identity: "sesión propia; prohibido si la MFA es obligatoria",
    coveredBy: "tests/platform/mfa-recovery.int.test.ts",
  },
};

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return name === "actions.ts" ? [full] : [];
  });
}

function exportedActions(): string[] {
  return actionFiles(path.join(process.cwd(), "src/app"))
    .flatMap((file) => [
      ...readFileSync(file, "utf8").matchAll(
        /^export (?:async function|const) (\w+)/gm,
      ),
    ])
    .map(([, name]) => name!)
    .sort();
}

describe("server actions", () => {
  it("every action has an isolation review", () => {
    expect(exportedActions()).toEqual(Object.keys(REVIEWED).sort());
  });

  it("every review points to existing tests", () => {
    for (const [action, review] of Object.entries(REVIEWED)) {
      for (const ref of review.coveredBy.split(",")) {
        const name = path.basename(ref.trim());
        const found = [
          path.join(process.cwd(), "tests/platform", name),
          path.join(process.cwd(), "tests/isolation", name),
          path.join(process.cwd(), ref.trim()),
        ].some((candidate) => {
          try {
            return statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
        expect(found, `${action}: ${ref}`).toBe(true);
      }
    }
  });
});
