"use server";

import { redirect } from "next/navigation";

import { signOut } from "@/platform/auth";

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/ingresar");
}
