import { registerHooks } from "node:module";
import { resolve } from "./unit-loader.mjs";

registerHooks({ resolve });
