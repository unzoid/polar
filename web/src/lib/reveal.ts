/**
 * Scroll reveal: `ref={reveal}` on an element with the `reveal` class.
 * Marks it `data-in` once it is 15% into the viewport, then stops watching.
 */
const observer =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute("data-in", "");
            observer!.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -15% 0px" },
      );

export function reveal(el: Element) {
  if (observer) observer.observe(el);
  else el.setAttribute("data-in", "");
}
