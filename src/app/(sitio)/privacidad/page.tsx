import type { Metadata } from "next";

import { LEGAL_DOCUMENTS } from "@/platform/legal";

import { SITE } from "../content";
import { LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description: "Cómo tratamos y protegemos tus datos personales.",
};

const mail = (
  <a
    className="font-medium text-primary underline-offset-4 hover:underline"
    href={`mailto:${SITE.contactEmail}`}
  >
    {SITE.contactEmail}
  </a>
);

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Legal"
      title={LEGAL_DOCUMENTS.privacy.title}
      version={LEGAL_DOCUMENTS.privacy.version}
      intro={
        <p>
          Este aviso explica qué datos personales trata {SITE.name}, para qué y
          cómo puedes ejercer tus derechos, conforme a la Ley Federal de
          Protección de Datos Personales en Posesión de los Particulares.
        </p>
      }
      sections={[
        {
          id: "responsable",
          title: "Responsable",
          body: (
            <p>
              <strong>{SITE.legalName}</strong> es responsable del tratamiento
              de los datos de las personas que crean una cuenta. Contacto para
              temas de privacidad: {mail}.
            </p>
          ),
        },
        {
          id: "datos",
          title: "Datos que tratamos",
          body: (
            <ul>
              <li>
                <strong>Cuenta:</strong> nombre, correo electrónico y contraseña
                (guardada solo como huella cifrada, nunca en texto).
              </li>
              <li>
                <strong>Seguridad:</strong> dirección IP, navegador, fecha de
                inicio de sesión, intentos fallidos y la configuración de tu
                verificación en dos pasos.
              </li>
              <li>
                <strong>Empresa:</strong> nombre del negocio y las personas que
                invitas a tu equipo, con su rol.
              </li>
              <li>
                <strong>Contratación:</strong> plan, módulos, meses pagados, ID
                de transacción y el proveedor con el que pagaste. Los datos de
                tu tarjeta los recibe ese proveedor, nunca nosotros.
              </li>
            </ul>
          ),
        },
        {
          id: "datos-de-clientes",
          title: "Información que capturas en el sistema",
          body: (
            <p>
              Los productos, existencias, proveedores y contactos que registras
              pertenecen a tu empresa. Respecto de los datos personales que
              contengan (por ejemplo, el nombre o correo de un proveedor), tu
              empresa es la responsable y {SITE.name} actúa como encargado: solo
              los tratamos para prestarte el servicio y no los usamos para otros
              fines.
            </p>
          ),
        },
        {
          id: "soporte",
          title: "Acceso de soporte",
          body: (
            <p>
              Nuestro equipo no entra a la información de tu empresa salvo que
              el titular lo permita desde Configuración, por 24 horas y solo
              para consultar. El titular puede quitar ese acceso en cualquier
              momento, y cada entrada y salida queda en la bitácora de la
              empresa.
            </p>
          ),
        },
        {
          id: "finalidades",
          title: "Para qué los usamos",
          body: (
            <>
              <p>Finalidades necesarias para el servicio:</p>
              <ul>
                <li>Crear y administrar tu cuenta y la de tu empresa.</li>
                <li>
                  Verificar tu identidad, proteger el acceso y prevenir abusos
                  (límites de intentos, avisos de seguridad).
                </li>
                <li>
                  Enviarte correos del servicio: confirmación, recuperación de
                  contraseña, invitaciones y avisos de cambios importantes.
                </li>
                <li>Cobrar, facturar y darte soporte.</li>
                <li>Cumplir obligaciones legales.</li>
              </ul>
              <p>
                No vendemos tus datos ni los usamos para publicidad de terceros.
              </p>
            </>
          ),
        },
        {
          id: "cookies",
          title: "Cookies y almacenamiento local",
          body: (
            <ul>
              <li>
                <strong>Sesión:</strong> una cookie necesaria para mantenerte
                dentro de tu cuenta. Se borra al cerrar sesión o al vencer.
              </li>
              <li>
                <strong>Confirmación de correo:</strong> una cookie temporal
                mientras confirmas tu dirección.
              </li>
              <li>
                <strong>Preferencias:</strong> tu elección de modo claro u
                oscuro se guarda solo en tu navegador.
              </li>
            </ul>
          ),
        },
        {
          id: "transferencias",
          title: "Con quién los compartimos",
          body: (
            <>
              <p>
                Solo con proveedores que nos ayudan a operar el servicio, para
                esos fines, y con autoridades cuando la ley lo exija:
              </p>
              <ul>
                <li>Hospedaje: Amazon Web Services.</li>
                <li>Envío de correo: Google (Gmail).</li>
                <li>
                  Cobro: Stripe, PayPal o Mercado Pago, según la forma de pago
                  que elijas.
                </li>
              </ul>
              <p>
                Algunos de estos proveedores guardan información fuera de
                México.
              </p>
            </>
          ),
        },
        {
          id: "arco",
          title: "Tus derechos (ARCO)",
          body: (
            <>
              <p>
                Puedes acceder a tus datos, rectificarlos, cancelarlos u
                oponerte a su tratamiento, así como revocar tu consentimiento,
                escribiendo a {mail} desde el correo de tu cuenta. Indica tu
                nombre, el derecho que quieres ejercer y, si aplica, qué dato
                corregir.
              </p>
              <p>
                Te responderemos dentro de los plazos que marca la ley. Algunos
                datos deben conservarse por obligaciones legales o para la
                seguridad de la cuenta (por ejemplo, la bitácora).
              </p>
            </>
          ),
        },
        {
          id: "seguridad",
          title: "Cómo los protegemos",
          body: (
            <ul>
              <li>Conexión cifrada y contraseñas con huella resistente.</li>
              <li>
                Verificación en dos pasos, obligatoria para titulares y
                administradores.
              </li>
              <li>Separación estricta entre empresas y permisos por rol.</li>
              <li>Bitácora de cambios sensibles que no se puede alterar.</li>
              <li>Respaldos cifrados y revisiones de seguridad periódicas.</li>
            </ul>
          ),
        },
        {
          id: "cambios",
          title: "Cambios a este aviso",
          body: (
            <p>
              Publicaremos cualquier cambio en esta página con su fecha. Si el
              cambio es importante, te avisaremos por correo antes de que
              aplique.
            </p>
          ),
        },
      ]}
    />
  );
}
