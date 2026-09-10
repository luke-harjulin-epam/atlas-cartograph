export function mountMenuInfo(root) {
  const popup = root.querySelector("#menu-info");
  const title = root.querySelector("#menu-info-title");
  const body = root.querySelector("#menu-info-body");
  const closeButton = root.querySelector("#menu-info-close");
  let trigger = null;
  let source = null;
  let open = false;
  const observer = new MutationObserver(render);

  function render() {
    if (!source) return;
    if (trigger.closest('[inert], .hidden, [aria-hidden="true"]')) {
      close();
      return;
    }
    const text = [...source.children].map(element => {
      if (element.tagName === "OL") {
        return [...element.children].map((item, index) => `${index + 1}. ${item.textContent.trim()}`).join("\n\n");
      }
      return element.textContent.trim();
    }).filter(Boolean).join("\n\n");
    if (body.textContent !== text) body.textContent = text;
  }

  function clear() {
    observer.disconnect();
    trigger?.setAttribute("aria-expanded", "false");
    trigger = null;
    source = null;
    open = false;
    body.textContent = "";
  }

  function close(restoreFocus = false) {
    const previous = trigger;
    if (open) popup.hidePopover();
    clear();
    if (restoreFocus && previous && !previous.closest('[inert], .hidden, [aria-hidden="true"]')) previous.focus({ preventScroll: true });
  }

  root.addEventListener("click", event => {
    const button = event.target.closest("[data-info]");
    if (!button) return;
    event.preventDefault();
    if (button === trigger) {
      close(true);
      return;
    }
    const nextSource = root.querySelector(`#${button.getAttribute("data-info")}`);
    if (!nextSource) throw new Error("Missing menu information source.");
    observer.disconnect();
    trigger?.setAttribute("aria-expanded", "false");
    trigger = button;
    source = nextSource;
    title.textContent = button.getAttribute("data-info-title");
    trigger.setAttribute("aria-expanded", "true");
    render();
    observer.observe(source, { childList: true, characterData: true, subtree: true });
    for (let parent = trigger.parentElement; parent && parent !== root; parent = parent.parentElement) {
      observer.observe(parent, { attributes: true, attributeFilter: ["class", "inert", "aria-hidden"] });
    }
    if (!open) popup.showPopover();
    open = true;
    closeButton.focus({ preventScroll: true });
  });
  closeButton.addEventListener("click", () => close(true));
  popup.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  popup.addEventListener("toggle", event => {
    if (event.newState === "closed") clear();
  });
  root.addEventListener("toggle", event => {
    if (trigger && event.target.tagName === "DETAILS" && !event.target.open && event.target.contains(trigger)) close();
  }, true);
  return {
    close,
    closeWithin(container) { if (trigger && container.contains(trigger)) close(); },
  };
}
