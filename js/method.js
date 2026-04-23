import { el, clear } from "./color.js";

/**
 * Two pipelines diagram. Chromeless — the chapter heading is in the article.
 */
export function renderMethod(container) {
  clear(container);

  const color = [
    "Frames & posters",
    "K-means palette extraction",
    "Color · brightness · warmth",
    "Dominant color per film",
  ];
  const sentiment = [
    "Overview text",
    "Language detect → translate",
    "RoBERTa inference",
    "Sentiment score (-1 → +1)",
  ];

  const pipeline = (title, steps) =>
    el(
      "article",
      {},
      el("p", { class: "label" }, title),
      el(
        "div",
        { class: "pipeline-steps" },
        ...steps.map((step) =>
          el("div", { class: "pipeline-step" }, el("span", { class: "dot" }), el("span", {}, step))
        )
      )
    );

  container.append(
    el(
      "div",
      { class: "method-pipelines" },
      pipeline("Color pipeline", color),
      pipeline("Sentiment pipeline", sentiment)
    )
  );
}
