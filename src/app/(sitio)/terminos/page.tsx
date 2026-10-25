import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/platform/legal";

import { SITE } from "../content";
import { LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  description: "Condiciones de uso del servicio Almacén.",
};

const link = "font-medium text-primary underline-offset-4 hover:underline";

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title={LEGAL_DOCUMENTS.terms.title}
      version={LEGAL_DOCUMENTS.terms.version}
      intro={
        <p>
          Estos términos regulan el uso de {SITE.name}, un servicio en línea
          para administrar inventario y compras. Al crear una cuenta los aceptas
          a nombre propio y de la empresa que registras.
        </p>
      }
      sections={[
        {
          id: "servicio",
          title: "El servicio",
          body: (
            <p>
              {SITE.name} se ofrece por suscripción mensual. Inventario es el
              módulo base; otros módulos se contratan por separado. Lo que
              incluye cada plan se describe en la página de{" "}
              <Link className={link} href="/precios">
                precios
              </Link>
              .
            </p>
          ),
        },
        {
          id: "cuenta",
          title: "Tu cuenta",
          body: (
            <ul>
              <li>Debes dar datos verdaderos y mantenerlos al día.</li>
              <li>
                Eres responsable de tu contraseña y de tu verificación en dos
                pasos. Avísanos de inmediato si sospechas un acceso indebido.
              </li>
              <li>
                El titular de la empresa decide quién entra y con qué rol, y
                responde por el uso que su equipo haga del servicio.
              </li>
            </ul>
          ),
        },
        {
          id: "uso",
          title: "Uso aceptable",
          body: (
            <>
              <p>No está permitido:</p>
              <ul>
                <li>Intentar acceder a información de otras empresas.</li>
                <li>
                  Probar la seguridad, saturar o automatizar el servicio sin
                  nuestro permiso por escrito.
                </li>
                <li>Usarlo para actividades ilícitas.</li>
              </ul>
              <p>
                Podemos suspender una cuenta que incumpla estas reglas, avisando
                al titular cuando sea posible.
              </p>
            </>
          ),
        },
        {
          id: "datos",
          title: "Tus datos",
          body: (
            <p>
              La información que capturas es de tu empresa. Puedes exportarla en
              cualquier momento. Tratamos los datos personales conforme al{" "}
              <Link className={link} href="/privacidad">
                aviso de privacidad
              </Link>
              .
            </p>
          ),
        },
        {
          id: "pagos",
          title: "Precios y pagos",
          body: (
            <ul>
              <li>Los precios están en pesos mexicanos y no incluyen IVA.</li>
              <li>
                El precio que contratas se mantiene mientras conserves tu plan;
                un cambio de precio aplica a contrataciones nuevas o te lo
                avisamos con anticipación.
              </li>
              <li>
                Si un pago no se realiza, la cuenta pasa a modo consulta: ves y
                exportas todo, pero no registras cambios.
              </li>
            </ul>
          ),
        },
        {
          id: "cancelacion",
          title: "Cancelación",
          body: (
            <p>
              Puedes cancelar cuando quieras, sin penalización; el servicio
              sigue activo hasta el final del periodo pagado. Después, tu
              información queda disponible en modo consulta durante el periodo
              de conservación para que la descargues.
            </p>
          ),
        },
        {
          id: "disponibilidad",
          title: "Disponibilidad y responsabilidad",
          body: (
            <p>
              Trabajamos para que el servicio esté disponible y respaldado, pero
              puede haber interrupciones por mantenimiento o causas fuera de
              nuestro control. {SITE.name} es una herramienta de registro: las
              decisiones de compra, venta y contabilidad son de tu empresa.
            </p>
          ),
        },
        {
          id: "propiedad",
          title: "Propiedad intelectual",
          body: (
            <p>
              El software, la marca y el diseño de {SITE.name} son de{" "}
              {SITE.legalName}. La suscripción te da derecho a usarlo, no a
              copiarlo ni revenderlo.
            </p>
          ),
        },
        {
          id: "cambios",
          title: "Cambios y legislación",
          body: (
            <p>
              Podemos actualizar estos términos; los cambios importantes se
              avisan por correo antes de aplicar. Se rigen por las leyes de los
              Estados Unidos Mexicanos. Dudas: {SITE.contactEmail}.
            </p>
          ),
        },
      ]}
    />
  );
}
