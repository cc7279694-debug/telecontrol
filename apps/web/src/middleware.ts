import { updateSession } from "./lib/supabase/middleware";

export { updateSession as middleware };

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
  ],
};
