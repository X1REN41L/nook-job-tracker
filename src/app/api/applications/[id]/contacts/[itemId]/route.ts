import { childItemRoute } from "@/lib/application-children";

const handlers = childItemRoute("contacts");
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
