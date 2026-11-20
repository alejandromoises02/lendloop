import type { AuthConfig } from "convex/server";

const authConfig: AuthConfig = {
  providers: [
    {
      // Clerk JWT template named "convex". Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
