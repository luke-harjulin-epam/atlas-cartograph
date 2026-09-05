export function handleContentClick(event, navigate, openExternal) {
  if (event.defaultPrevented) return false;
  const link = event.target.closest("a, .wikilink, [data-target]");
  if (!link) return false;
  const target = link.tagName === "A"
    ? link.getAttribute("href") || ""
    : link.getAttribute("data-target") || "";
  event.preventDefault();
  event.stopPropagation();
  if (/^https?:\/\//i.test(target) || target.startsWith("mailto:")) {
    openExternal(target, "_blank", "noopener,noreferrer");
  } else if (target && target !== "#") {
    navigate(target);
  }
  return true;
}
