"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { generateSuggestedOrders } from "@/modules/purchasing";
import { requireOrganizationContext } from "@/platform/tenancy";

export type SuggestState = { error?: string; answers: number };

/**
 * Creates the drafts suggested for some products (CMP-14). The browser
 * only says which products; what to order, from whom and how much is
 * worked out again in the service, inside the company of the session.
 */
export async function generateSuggestedOrdersAction(
  prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const { user, organization } = await requireOrganizationContext();
  const productIds = formData
    .getAll("productId")
    .slice(0, 1_000)
    .map((value) => String(value).slice(0, 36));
  let result;
  try {
    result = await generateSuggestedOrders(
      { organizationId: organization.id, userId: user.id },
      { productIds },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { error: error.message, answers: prev.answers + 1 };
    }
    throw error;
  }
  if (!result.ok) return { error: result.error, answers: prev.answers + 1 };
  revalidatePath("/compras");
  const [first] = result.orders;
  redirect(
    result.orders.length === 1 && first
      ? `/compras/ordenes/${first.orderId}`
      : "/compras?estado=DRAFT",
  );
}
