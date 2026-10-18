// Visual feedback stays independent of cart persistence and never blocks input.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const active = new Set();
const flights = new Set();
const feedbackTimers = new WeakMap();
const decorativeNodes = new Set();
function decorate(element) {
  element.setAttribute("aria-hidden", "true");
  element.dataset.uiEffect = "";
  decorativeNodes.add(element);
  return () => {
    decorativeNodes.delete(element);
    element.remove();
  };
}
function animate(element, frames, options, complete = () => {}) {
  if (!element.animate) {
    complete();
    return;
  }
  const animation = element.animate(frames, options);
  active.add(animation);
  animation.finished
    .then(complete, () => {})
    .finally(() => active.delete(animation));
  return animation;
}
function visible(element) {
  if (!element) return false;
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
}
function cartTarget() {
  const mobile = document.querySelector('.mobile-nav [data-tab="cart"]');
  return visible(mobile) ? mobile : document.querySelector(".cart-trigger");
}
function acknowledge(button) {
  if (!button?.matches(".add-button")) return;
  clearTimeout(feedbackTimers.get(button));
  button.classList.add("added-feedback");
  feedbackTimers.set(
    button,
    setTimeout(() => button.classList.remove("added-feedback"), 700),
  );
}
function celebrate(target) {
  if (!target?.isConnected || reducedMotion.matches) return;
  // Only the number moves, so the cart button remains easy to click.
  const badge = target.querySelector("#cart-count, #mobile-cart-count");
  if (badge)
    animate(
      badge,
      [
        { transform: "scale(1)" },
        { transform: "scale(1.35) translateY(-2px)", offset: 0.45 },
        { transform: "scale(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  animate(
    target,
    [
      { boxShadow: "0 0 0 0 #a7d5a700" },
      { boxShadow: "0 0 0 5px #a7d5a733", offset: 0.35 },
      { boxShadow: "0 0 0 10px #a7d5a700" },
    ],
    { duration: 520, easing: "ease-out" },
  );
  const r = target.getBoundingClientRect(),
    x = r.left + r.width / 2,
    y = r.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const spark = document.createElement("span");
    spark.className = "cart-spark";
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.background = ["#b6d8ba", "#d9ba81", "#efecdf"][i % 3];
    document.body.append(spark);
    const remove = decorate(spark),
      angle = (i * Math.PI) / 3;
    animate(
      spark,
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * 27}px), calc(-50% + ${Math.sin(angle) * 22}px)) scale(0)`,
          opacity: 0,
        },
      ],
      { duration: 420, easing: "ease-out" },
      remove,
    );
  }
}
export function addedToCart(product, { source, button } = {}) {
  try {
    acknowledge(button);
    if (reducedMotion.matches || document.hidden) return;
    const target = cartTarget();
    if (!visible(target)) return;
    if (!source?.isConnected || !visible(source)) source = button;
    if (!visible(source) || !Element.prototype.animate) {
      celebrate(target);
      return;
    }
    // Limit simultaneous flights when the customer taps repeatedly.
    if (flights.size >= 4) flights.values().next().value();
    const from = source.getBoundingClientRect(),
      to = target.getBoundingClientRect();
    const width = product.type === "drink" ? 54 : 78,
      height = product.type === "drink" ? 90 : 78;
    const startX = from.left + from.width / 2 - width / 2,
      startY = from.top + from.height / 2 - height / 2;
    const endX = to.left + to.width / 2 - width / 2,
      endY = to.top + to.height / 2 - height / 2;
    const flyer = document.createElement("img");
    flyer.className = "cart-flyer";
    flyer.alt = "";
    flyer.src =
      source.tagName === "IMG"
        ? source.currentSrc || source.src || product.thumbnail || product.image
        : product.thumbnail || product.image;
    flyer.width = width;
    flyer.height = height;
    flyer.style.width = `${width}px`;
    flyer.style.height = `${height}px`;
    document.body.append(flyer);
    const remove = decorate(flyer);
    let animation;
    const cleanup = () => {
      flights.delete(cleanup);
      animation?.cancel();
      remove();
    };
    flights.add(cleanup);
    animation = animate(
      flyer,
      [
        {
          transform: `translate3d(${startX}px,${startY}px,0) scale(1) rotate(0deg)`,
          opacity: 0.95,
        },
        {
          transform: `translate3d(${(startX + endX) / 2}px,${Math.max(14, Math.min(startY, endY) - 90)}px,0) scale(.8) rotate(-16deg)`,
          opacity: 0.9,
          offset: 0.5,
        },
        {
          transform: `translate3d(${endX}px,${endY}px,0) scale(.15) rotate(12deg)`,
          opacity: 0,
        },
      ],
      { duration: 650, easing: "cubic-bezier(.3,.6,.5,1)" },
      () => {
        cleanup();
        celebrate(target);
      },
    );
  } catch {
    /* Decorative effects must not affect a successful cart update. */
  }
}
function ripple(button, x, y) {
  if (reducedMotion.matches || button.disabled || !button.animate) return;
  const bounds = button.getBoundingClientRect(),
    diameter = Math.max(bounds.width, bounds.height) * 1.7;
  button.classList.add("effect-ripple-host");
  // One ripple per button keeps repeated taps inexpensive.
  const previous = button.querySelector(".button-ripple");
  if (previous) {
    decorativeNodes.delete(previous);
    previous.remove();
  }
  const clip = document.createElement("span"),
    ink = document.createElement("span");
  clip.className = "button-ripple";
  ink.className = "ripple-ink";
  ink.style.width = ink.style.height = `${diameter}px`;
  ink.style.left = `${x - bounds.left - diameter / 2}px`;
  ink.style.top = `${y - bounds.top - diameter / 2}px`;
  clip.append(ink);
  button.append(clip);
  const remove = decorate(clip);
  animate(
    ink,
    [
      { transform: "scale(0)", opacity: 0.3 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: 450, easing: "ease-out" },
    remove,
  );
}
export function installInteractionEffects() {
  const onPress = (event) => {
    const button = event.target.closest(
      "button.add-button, button.primary, button.outline",
    );
    if (!button || (event.button && event.button !== 0)) return;
    const r = button.getBoundingClientRect();
    ripple(
      button,
      event.clientX ?? r.left + r.width / 2,
      event.clientY ?? r.top + r.height / 2,
    );
  };
  document.addEventListener("pointerdown", onPress, { passive: true });
  document.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    const button = event.target.closest(
      "button.add-button, button.primary, button.outline",
    );
    if (button) {
      const r = button.getBoundingClientRect();
      ripple(button, r.left + r.width / 2, r.top + r.height / 2);
    }
  });
  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches) return;
    for (const cleanup of [...flights]) cleanup();
    for (const animation of active) animation.cancel();
    for (const element of decorativeNodes) element.remove();
    decorativeNodes.clear();
  });
}
export function revealMenu(root) {
  if (reducedMotion.matches || !window.IntersectionObserver) return () => {};
  const animations = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      let sequence = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (reducedMotion.matches) continue;
        const animation = animate(
          entry.target,
          [
            { opacity: 0.35, transform: "translateY(16px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 460,
            delay: Math.min(sequence++ * 45, 180),
            easing: "cubic-bezier(.2,.75,.2,1)",
          },
        );
        if (animation) {
          animations.add(animation);
          animation.finished
            .catch(() => {})
            .finally(() => animations.delete(animation));
        }
      }
    },
    { threshold: 0.08 },
  );
  root
    .querySelectorAll(
      ".pizza-card, .drinks-card, .info-grid > div, .accepted-payments",
    )
    .forEach((el) => observer.observe(el));
  return () => {
    observer.disconnect();
    for (const animation of animations) animation.cancel();
  };
}
