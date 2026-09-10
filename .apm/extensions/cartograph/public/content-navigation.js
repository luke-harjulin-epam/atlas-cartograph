export function handleContentClick(event, navigate, openExternal) {
  if (event.defaultPrevented) return false;
  const link = event.target.closest("a, .wikilink, [data-target]");
  if (!link) return false;
  const target = link.tagName === "A"
    ? link.getAttribute("href") || ""
    : link.getAttribute("data-target") || "";
  // Source rows are native anchors: let the browser handle Enter, modifiers,
  // context menus and the new tab rather than opening a second window here.
  if (link.tagName === "A" && link.classList.contains("external-source") && /^https?:\/\//i.test(target)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  if (/^https?:\/\//i.test(target) || target.startsWith("mailto:")) {
    openExternal(target, "_blank", "noopener,noreferrer");
  } else if (target && target !== "#") {
    navigate(target);
  }
  return true;
}
