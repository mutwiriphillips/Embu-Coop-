"use client";

import { useEffect } from "react";
import { fetchCountiesWithRetry } from "../lib/useCounties";

// On the free hosting tier the API sleeps when idle and takes up to a minute
// to wake. Visitors reach the landing page first, so waking the server here
// (and saving the county list in the browser) means the registration forms
// that follow are usually ready at once. Renders nothing; failures are ignored.
export default function WarmUp() {
  useEffect(() => {
    fetchCountiesWithRetry({ attempts: 3 }).catch(() => {});
  }, []);
  return null;
}
