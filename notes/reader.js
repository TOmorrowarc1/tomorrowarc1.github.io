const messages = {
  loading: ["Loading note…", "正在加载笔记…"],
  error: ["Could not load this note. Close and reopen it to retry.", "无法加载这篇笔记。请关闭后重新打开。"],
};

function showStatus(status, state) {
  const [english, chinese] = messages[state];
  status.dataset.en = english;
  status.dataset.zh = chinese;
  status.textContent = document.documentElement.lang.startsWith("zh") ? chinese : english;
  status.hidden = false;
}

function formatNote(container, markdown, sourceUrl) {
  const content = document.createElement("template");
  content.innerHTML = markdown;
  if (content.content.firstElementChild?.tagName === "H1") {
    content.content.firstElementChild.remove();
  }

  for (const heading of content.content.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Math.min(6, Math.max(3, Number(heading.tagName[1]) + 1));
    const replacement = document.createElement(`h${level}`);
    replacement.append(...heading.childNodes);
    heading.replaceWith(replacement);
  }

  for (const element of content.content.querySelectorAll("a[href], img[src]")) {
    const attribute = element.tagName === "IMG" ? "src" : "href";
    element.setAttribute(attribute, new URL(element.getAttribute(attribute), sourceUrl).href);
  }

  const article = document.createElement("article");
  article.className = "note-article";
  article.lang = "en";
  article.append(content.content);
  container.append(article);
}

for (const note of document.querySelectorAll("#notes .note")) {
  const container = note.querySelector(".note-content");
  const source = container.querySelector(".note-source");
  const status = document.createElement("p");
  status.className = "note-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  container.prepend(status);

  let state = "idle";
  note.addEventListener("toggle", async () => {
    if (!note.open || state !== "idle") return;
    state = "loading";
    showStatus(status, "loading");

    try {
      const [response, { renderMarkdown }] = await Promise.all([
        fetch(source.href),
        import("./vendor/markdown.js"),
      ]);
      if (!response.ok) throw new Error(`Markdown request failed (${response.status})`);
      formatNote(container, renderMarkdown(await response.text()), response.url || source.href);
      state = "loaded";
      status.hidden = true;
      source.hidden = true;
    } catch {
      state = "idle";
      showStatus(status, "error");
    }
  });
}
