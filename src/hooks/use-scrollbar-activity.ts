import { useEffect, useRef } from "react";

export function useScrollbarActivity<T extends HTMLElement>() {
  const scrollRef = useRef<T>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let timeoutId: number | undefined;
    const showWhileScrolling = () => {
      element.classList.add("is-scrolling");
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        element.classList.remove("is-scrolling");
      }, 700);
    };

    element.addEventListener("scroll", showWhileScrolling, { passive: true });
    return () => {
      element.removeEventListener("scroll", showWhileScrolling);
      window.clearTimeout(timeoutId);
      element.classList.remove("is-scrolling");
    };
  }, []);

  return scrollRef;
}
