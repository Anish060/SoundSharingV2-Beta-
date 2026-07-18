import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export const PRODUCTION_CONVEX_URL = "https://elated-scorpion-697.convex.cloud";

export function getConvexClient(url = PRODUCTION_CONVEX_URL): ConvexClient {
  return new ConvexClient(url);
}

export { api };
