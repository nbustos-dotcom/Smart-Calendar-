import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Client-side Router Cache reuse window. The dashboard and settings pages
    // are dynamically rendered, so `dynamic` governs them. Next's default is 0,
    // which re-renders each route on the server on every navigation and makes
    // dashboard ⇄ settings feel sluggish. A short 5s window lets a quick trip
    // to Settings and back serve INSTANTLY from the client cache, while keeping
    // data effectively fresh.
    //
    // 5s (not longer) is deliberate: it comfortably covers normal back-and-forth
    // navigation but expires almost immediately, so nothing stays visibly stale.
    // It's also safe against mutations — every write path calls revalidatePath
    // for the routes it changes (events/todos → "/", sync/courses/token →
    // "/settings" + "/"), and an explicit revalidatePath invalidates the Router
    // Cache regardless of this window, so post-mutation navigation always
    // refetches fresh rather than serving a cached copy.
    staleTimes: {
      dynamic: 5,
    },
  },
};

export default nextConfig;
