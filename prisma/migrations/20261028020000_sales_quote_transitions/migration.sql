-- Los estados de una cotización solo avanzan por la tabla de
-- QUOTE_TRANSITIONS (COT-04): borrador → enviada → aceptada o rechazada.
-- Cambiar una exige cambiar la otra.
CREATE TRIGGER `sales_quote_transition` BEFORE UPDATE ON `sales_quote` FOR EACH ROW
BEGIN
    IF NEW.`status` <> OLD.`status` AND NOT (
        (OLD.`status` = 'DRAFT' AND NEW.`status` = 'SENT')
        OR (OLD.`status` = 'SENT' AND NEW.`status` IN ('ACCEPTED', 'REJECTED'))
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: that change of state is not allowed';
    END IF;
END;
