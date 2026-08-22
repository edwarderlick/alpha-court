"use client";

import { useEffect } from "react";

/**
 * Wires up the IntersectionObserver pause/run behavior for
 * `.animate-fade-in-up` elements, lifted verbatim from the
 * `DOMContentLoaded` script in alpha_court_pro_landing_enhanced/code.html.
 * Renders nothing; just attaches the observer on mount.
 */
export function ScrollFadeIn() {
  useEffect(() => {
    const animatedElements = document.querySelectorAll(".animate-fade-in-up");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).style.animationPlayState = "running";
          }
        });
      },
      { threshold: 0.1 }
    );

    animatedElements.forEach((el) => {
      (el as HTMLElement).style.animationPlayState = "paused";
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
