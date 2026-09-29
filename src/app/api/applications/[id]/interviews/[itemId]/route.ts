import { childItemRoute } from "@/lib/application-children";

const handlers = childItemRoute("interviews");
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
